// Проверка, что ссылка открывается (для обслуживания справочника: npm run check-links).
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
    try { await res.body?.cancel(); } catch { /* тело не нужно */ }
    return res;
  } finally {
    clearTimeout(timer);
  }
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
    // Сайт рвёт соединение в ответ на запрос робота: это блокировка автопроверки, а не мёртвая ссылка.
    if (e.cause?.code === 'UND_ERR_SOCKET' || e.cause?.code === 'ECONNRESET') {
      return { ok: true, manual: true, status: null, text: 'соединение сброшено сайтом: автопроверка заблокирована, откройте вручную' };
    }
    const reason = e.name === 'AbortError' ? 'нет ответа за отведённое время' : (e.cause?.code || e.message || 'ошибка соединения');
    return { ok: false, status: null, text: `не открывается: ${reason}` };
  }
}

/** @returns {Promise<{ok:boolean, manual?:boolean, status:number|null, text:string}>} */
export async function checkUrl(url, { timeoutMs = 12000 } = {}) {
  const first = await checkOnce(url, timeoutMs);
  // Один повтор при сетевой ошибке.
  if (first.status == null && !first.manual && /^https?:\/\//i.test(url)) return checkOnce(url, timeoutMs);
  return first;
}
