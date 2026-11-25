// Проверка, что ссылки открываются. Запросы идут только на адреса из вашего списка ссылок,
// никакие данные архива в них не передаются.
const UA = 'Mozilla/5.0 (compatible; PersonalArchiveLinkCheck/1.0)';
const MANUAL = new Set([401, 403, 429, 451, 999]);

async function request(url, method, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/pdf;q=0.9,*/*;q=0.5', ...(method === 'GET' ? { Range: 'bytes=0-1023' } : {}) },
    });
    // Тело не нужно.
    try { await res.body?.cancel(); } catch { /* ignore */ }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/** @returns {Promise<{ok:boolean, status:number|null, text:string}>} */
export async function checkUrl(url, { timeoutMs = 12000 } = {}) {
  const first = await checkOnce(url, timeoutMs);
  // Один повтор при сетевой ошибке: сайты иногда обрывают соединение.
  if (first.status == null && /^https?:\/\//i.test(url)) return checkOnce(url, timeoutMs);
  return first;
}

async function checkOnce(url, timeoutMs) {
  if (!/^https?:\/\//i.test(url)) return { ok: false, status: null, text: 'адрес должен начинаться с http:// или https://' };
  try {
    let res = await request(url, 'HEAD', timeoutMs);
    if (res.status >= 400) res = await request(url, 'GET', timeoutMs);
    const redirected = res.redirected && new URL(res.url).host !== new URL(url).host ? ` (перенаправлено на ${new URL(res.url).host})` : '';
    if (res.ok || res.status === 206) return { ok: true, status: res.status, text: `${res.status} OK${redirected}` };
    if (MANUAL.has(res.status)) {
      return { ok: true, manual: true, status: res.status, text: `${res.status}: автопроверка заблокирована сайтом, откройте вручную` };
    }
    return { ok: false, status: res.status, text: `${res.status}: страница не открывается` };
  } catch (e) {
    // Сайт рвёт соединение в ответ на запрос робота: считаем блокировкой автопроверки, а не мёртвой ссылкой.
    if (e.cause?.code === 'UND_ERR_SOCKET' || e.cause?.code === 'ECONNRESET') {
      return { ok: true, manual: true, status: null, text: 'соединение сброшено сайтом: автопроверка заблокирована, откройте вручную' };
    }
    const reason = e.name === 'AbortError' ? 'нет ответа за отведённое время' : (e.cause?.code || e.message || 'ошибка соединения');
    return { ok: false, status: null, text: `не открывается: ${reason}` };
  }
}

const job = { running: false, done: 0, total: 0, startedAt: null };
export const linkCheckState = () => ({ ...job });

/** Проверяет все ссылки в фоне и записывает результат в базу. */
export function startLinkCheck(db, { onlyId = null, concurrency = 4 } = {}) {
  if (job.running) return false;
  const links = db.prepare(`SELECT id, url FROM links ${onlyId ? 'WHERE id = ?' : ''} ORDER BY id`).all(...(onlyId ? [onlyId] : []));
  job.running = true;
  job.done = 0;
  job.total = links.length;
  job.startedAt = Date.now();
  let next = 0;
  const upd = db.prepare('UPDATE links SET checked_at = ?, check_result = ? WHERE id = ?');
  const worker = async () => {
    while (next < links.length) {
      const l = links[next++];
      const r = await checkUrl(l.url);
      upd.run(new Date().toISOString().slice(0, 10), r.text, l.id);
      job.done++;
    }
  };
  Promise.all(Array.from({ length: Math.min(concurrency, links.length) }, worker))
    .catch((e) => console.error('Проверка ссылок:', e.message))
    .finally(() => { job.running = false; });
  return true;
}
