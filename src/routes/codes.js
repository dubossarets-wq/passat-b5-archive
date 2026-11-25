import { getDb, tx, lastId } from '../db.js';
import { h, raw, fmtDate, fmtKm, int, txt, today } from '../lib/html.js';
import { page, pageTitle, backLink } from '../views/layout.js';
import { field, textInput, textArea, selectInput, systemSelect, statusBadge, verifyForm, sourcesBlock, confirmForm, emptyState, pager } from '../lib/ui.js';
import { flash, go, arr } from '../lib/web.js';
import { currentOdometer } from '../lib/vehicle.js';
import { loadSpecMap, textWithSpecs } from '../lib/specs.js';
import { indexOne, removeIndex, search, jsonList } from '../lib/search.js';

const PAGE_SIZE = 50;
const ECUS = ['Двигатель (01)', 'Автоматическая КПП (02)', 'ABS (03)', 'Подушки безопасности (15)', 'Приборная панель (17)', 'Блок комфорта (46)', 'Климат (08)', 'Другой блок'];
const TOOLS = ['VCDS', 'ELM327', 'Сканер на СТО', 'Другой'];
const STATES = [['', 'Не указано'], ['постоянная', 'Постоянная'], ['спорадическая', 'Спорадическая']];

const normCode = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, '');
const lines = (s) => String(s ?? '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

function findCode(db, code) {
  return db.prepare('SELECT id FROM dtc_codes WHERE code = ? OR vag = ? ORDER BY code = ? DESC LIMIT 1').get(code, code, code)?.id ?? null;
}

function eventForm(db, { e = {}, code = '', action, submit = 'Сохранить' }) {
  const cur = currentOdometer(db);
  const records = db.prepare('SELECT id, date, title FROM records ORDER BY date DESC, id DESC LIMIT 30').all()
    .map((r) => [r.id, `${fmtDate(r.date)} · ${r.title}`]);
  return h`<form method="post" action="${action}">
${field('Код', textInput('code', { value: e.code ?? code, required: true, attrs: ' autocapitalize="characters"' }), 'P0102 или пятизначный VAG-код, например 16486')}
<div class="row">
${field('Дата', textInput('date', { type: 'date', value: e.date || today(), required: true }))}
${field('Пробег, км', textInput('odometer_km', { value: e.odometer_km ?? (e.id ? '' : cur?.km ?? ''), inputmode: 'numeric' }))}
</div>
<div class="row">
${field('Чем считан', textInput('tool', { value: e.tool, list: 'tools' }))}
${field('Блок', textInput('ecu', { value: e.ecu, list: 'ecus' }))}
</div>
<datalist id="tools">${TOOLS.map((t) => h`<option value="${t}">`)}</datalist>
<datalist id="ecus">${ECUS.map((t) => h`<option value="${t}">`)}</datalist>
${field('Состояние', selectInput('state', STATES, e.state ?? ''))}
<div class="checks"><label><input type="checkbox" name="cleared" value="1"${e.cleared ? raw(' checked') : ''}> Код сброшен</label></div>
${field('Стоп-кадр', textArea('freeze_frame', e.freeze_frame, 3), 'Обороты, температура, нагрузка и т. п. в момент ошибки — как показал сканер')}
${field('Что помогло', textArea('outcome', e.outcome, 3))}
${field('Связанная запись журнала', selectInput('record_id', records, e.record_id, { empty: 'Нет' }))}
<button class="btn block" type="submit">${submit}</button></form>`;
}

function saveEvent(db, f, id = null) {
  const code = normCode(f.code);
  const date = String(f.date ?? '');
  if (!code) throw Object.assign(new Error('Укажите код'), { statusCode: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Object.assign(new Error('Укажите дату'), { statusCode: 400 });
  const vals = [code, findCode(db, code), date, int(f.odometer_km), txt(f.tool), txt(f.ecu), txt(f.state), txt(f.freeze_frame),
    f.cleared ? 1 : 0, txt(f.outcome), int(f.record_id)];
  if (id) {
    db.prepare(
      `UPDATE dtc_events SET code = ?, code_id = ?, date = ?, odometer_km = ?, tool = ?, ecu = ?, state = ?, freeze_frame = ?,
       cleared = ?, outcome = ?, record_id = ? WHERE id = ?`,
    ).run(...vals, id);
    return id;
  }
  return lastId(db.prepare(
    `INSERT INTO dtc_events (code, code_id, date, odometer_km, tool, ecu, state, freeze_frame, cleared, outcome, record_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(...vals));
}

function eventRow(e) {
  return h`<li><a class="item" href="/events/${e.id}"><span class="t">${e.code}${e.title ? h` · ${e.title}` : ''}</span>
<span class="s">${fmtDate(e.date)}${e.odometer_km != null ? ` · ${fmtKm(e.odometer_km)}` : ''}${e.tool ? ` · ${e.tool}` : ''}${e.ecu ? ` · ${e.ecu}` : ''} · ${e.cleared ? 'сброшен' : 'не сброшен'}</span>
${e.outcome ? h`<span class="snip">Помогло: ${e.outcome}</span>` : ''}</a></li>`;
}

function codeForm(db, c = {}, action) {
  return h`<form method="post" action="${action}">
<div class="row">${field('Код (P0102 или VAG)', textInput('code', { value: c.code, required: true }))}${field('VAG-код', textInput('vag', { value: c.vag, inputmode: 'numeric' }))}</div>
${field('Название', textInput('title', { value: c.title, required: true }))}
${field('Система', systemSelect(db, 'system_id', c.system_id))}
${field('Описание своими словами', textArea('description', c.description, 4))}
${field('Частые причины (по одной в строке)', textArea('causes', jsonList(c.causes).join('\n'), 5))}
${field('Что проверить (по одному шагу в строке)', textArea('checks', jsonList(c.checks).join('\n'), 5))}
${field('К чему относится', textInput('applies_to', { value: c.applies_to, placeholder: 'ARG, OBD-II общее, …' }))}
<button class="btn block" type="submit">Сохранить</button></form>`;
}

export default function register(app) {
  app.get('/codes', async (req, reply) => {
    const db = getDb();
    const { q = '', type = '', system = '' } = req.query;
    const pg = Math.max(1, Number(req.query.page) || 1);
    const where = [];
    const params = [];
    if (type === 'obd') where.push("c.code GLOB '[PBCU][0-9]*'");
    if (type === 'vag') where.push("(c.vag IS NOT NULL OR c.code GLOB '[0-9]*')");
    if (system) { where.push('c.system_id = ?'); params.push(Number(system)); }
    let hits = null;
    if (q.trim()) {
      hits = new Map(search(db, q, { kinds: ['code'], limit: 500 }).map((x) => [x.id, x]));
      where.push(`c.id IN (${hits.size ? [...hits.keys()].join(',') : '0'})`);
    }
    const rows = db.prepare(
      `SELECT c.*, s.name AS system_name, (SELECT COUNT(*) FROM dtc_events e WHERE e.code_id = c.id) AS nev
       FROM dtc_codes c LEFT JOIN systems s ON s.id = c.system_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY c.code LIMIT ? OFFSET ?`,
    ).all(...params, PAGE_SIZE + 1, (pg - 1) * PAGE_SIZE);
    const more = rows.length > PAGE_SIZE;
    const total = db.prepare('SELECT COUNT(*) AS n FROM dtc_codes').get().n;
    const base = `/codes?${new URLSearchParams({ q, type, system }).toString()}`;
    const chip = (v, label) => h`<a href="/codes?${new URLSearchParams({ q, type: v, system }).toString()}" class="${type === v ? 'on' : ''}">${label}</a>`;
    return reply.html(page({
      title: 'Коды ошибок',
      active: 'menu',
      flash: flash(req),
      body: h`${pageTitle('Коды ошибок', h`<a class="btn small" href="/codes/new">+ Код</a>`)}
<form method="get" action="/codes" class="filter">
${textInput('q', { value: q, placeholder: 'Код (P0102, 16486) или слово: расходомер, лямбда' })}
<input type="hidden" name="type" value="${type}">
<button class="btn ghost" type="submit">Найти</button>
</form>
<div class="chips">${chip('', 'Все')}${chip('obd', 'OBD-II (P, B, C, U)')}${chip('vag', 'VAG пятизначные')}<a href="/events">История на моей машине</a></div>
<p class="muted">В справочнике кодов: ${total}. Все описания — черновики со статусом «не проверено».</p>
${rows.length ? h`<ul class="list">${rows.slice(0, PAGE_SIZE).map((c) => h`<li><a class="item" href="/codes/${c.id}"><span class="t">${c.code}${c.vag && c.vag !== c.code ? h` <span class="muted">/ VAG ${c.vag}</span>` : ''} · ${c.title}</span>
<span class="s">${c.system_name || ''}${c.nev ? ` · у меня было: ${c.nev}` : ''}</span>
${hits?.get(c.id) ? h`<span class="snip">${hits.get(c.id).snippet}</span>` : ''}</a></li>`)}</ul>` : emptyState('Ничего не найдено.', h`<p><a class="btn ghost" href="/codes/new">Добавить код самому</a></p>`)}
${pager(base, pg, more)}`,
    }));
  });

  app.get('/codes/new', async (req, reply) => reply.html(page({
    title: 'Новый код',
    active: 'menu',
    flash: flash(req),
    body: h`${backLink('/codes', 'Коды')}${pageTitle('Добавить код')}${codeForm(getDb(), { code: req.query.code ?? '' }, '/codes')}`,
  })));

  const saveCode = (db, b, id = null) => {
    const code = normCode(b.code);
    if (!code || !txt(b.title)) throw Object.assign(new Error('Нужны код и название'), { statusCode: 400 });
    const vals = [code, txt(b.vag), Number(b.system_id) || null, txt(b.title), txt(b.description),
      JSON.stringify(lines(b.causes)), JSON.stringify(lines(b.checks)), txt(b.applies_to)];
    if (id) {
      db.prepare('UPDATE dtc_codes SET code = ?, vag = ?, system_id = ?, title = ?, description = ?, causes = ?, checks = ?, applies_to = ? WHERE id = ?').run(...vals, id);
      return id;
    }
    return lastId(db.prepare(
      "INSERT INTO dtc_codes (code, vag, system_id, title, description, causes, checks, applies_to, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unverified')",
    ).run(...vals));
  };

  app.post('/codes', async (req, reply) => {
    const db = getDb();
    try {
      let id;
      tx(db, () => {
        id = saveCode(db, req.body ?? {});
        db.prepare('UPDATE dtc_events SET code_id = ? WHERE code_id IS NULL AND (code = (SELECT code FROM dtc_codes WHERE id = ?) OR code = (SELECT vag FROM dtc_codes WHERE id = ?))').run(id, id, id);
        indexOne(db, 'code', id);
      });
      return go(reply, `/codes/${id}`, 'Код добавлен');
    } catch (e) {
      if (e.statusCode === 400) return go(reply, '/codes/new', e.message);
      if (/UNIQUE/.test(e.message)) return go(reply, '/codes', 'Такой код уже есть в справочнике');
      throw e;
    }
  });

  app.get('/codes/:id', async (req, reply) => {
    const db = getDb();
    const id = Number(req.params.id);
    const c = db.prepare('SELECT c.*, s.name AS system_name FROM dtc_codes c LEFT JOIN systems s ON s.id = c.system_id WHERE c.id = ?').get(id);
    if (!c) return reply.callNotFound();
    const specs = loadSpecMap(db);
    const sources = db.prepare("SELECT * FROM sources WHERE owner_kind = 'code' AND owner_id = ?").all(id);
    const events = db.prepare(
      'SELECT e.*, ? AS title FROM dtc_events e WHERE e.code_id = ? OR e.code = ? OR (? IS NOT NULL AND e.code = ?) ORDER BY e.date DESC, e.id DESC',
    ).all('', id, c.code, c.vag, c.vag);
    const causes = jsonList(c.causes);
    const checks = jsonList(c.checks);
    const back = `/codes/${id}`;
    return reply.html(page({
      title: c.code,
      active: 'menu',
      flash: flash(req),
      body: h`${backLink('/codes', 'Коды')}${pageTitle(`${c.code}${c.vag && c.vag !== c.code ? ` / VAG ${c.vag}` : ''}`)}
<p><b>${c.title}</b></p>
<p>${statusBadge(c.status)} <span class="muted">${c.system_name || ''}${c.applies_to ? ` · относится к: ${c.applies_to}` : ''}</span></p>
${c.description ? h`<p>${textWithSpecs(c.description, specs)}</p>` : ''}
${causes.length ? h`<h2>Частые причины</h2><ul class="plain">${causes.map((x) => h`<li>${textWithSpecs(x, specs)}</li>`)}</ul>` : ''}
${checks.length ? h`<h2>Что проверить</h2><ol class="plain">${checks.map((x) => h`<li>${textWithSpecs(x, specs)}</li>`)}</ol>` : ''}
${sourcesBlock(sources)}
<div class="actions">${verifyForm('code', id, c.status, back)}<a class="btn ghost" href="/codes/${id}/edit">Изменить</a></div>

<h2>На моей машине</h2>
${events.length ? h`<ul class="list">${events.map(eventRow)}</ul>` : h`<p class="empty">Этот код ещё не считывался.</p>`}
<details${req.query.add ? raw(' open') : ''}><summary class="btn">Добавить событие</summary>
<div style="margin-top:12px">${eventForm(db, { code: c.vag && c.code === c.vag ? c.vag : c.code, action: '/events', submit: 'Записать событие' })}</div></details>
<h2>Источники по умолчанию</h2>
<form method="post" action="/sources">
<input type="hidden" name="owner_kind" value="code"><input type="hidden" name="owner_id" value="${id}"><input type="hidden" name="back" value="${back}">
${field('Ссылка', textInput('url', { type: 'url', required: true }))}${field('Название', textInput('title'))}${field('К чему относится', textInput('applies_to'))}${field('Что взято', textInput('note'))}
<button class="btn ghost block" type="submit">Добавить источник</button></form>
<div class="actions">${confirmForm(`/codes/${id}/delete`, 'Удалить код', 'Удалить код из справочника? История событий останется.')}</div>`,
    }));
  });

  app.get('/codes/:id/edit', async (req, reply) => {
    const db = getDb();
    const c = db.prepare('SELECT * FROM dtc_codes WHERE id = ?').get(Number(req.params.id));
    if (!c) return reply.callNotFound();
    return reply.html(page({
      title: 'Изменить код',
      active: 'menu',
      flash: flash(req),
      body: h`${backLink(`/codes/${c.id}`, 'К коду')}${pageTitle('Изменить код')}<p class="muted">Критичные цифры (моменты затяжки, давления, напряжения) сюда не вписывайте: пишите {{spec:ключ}} из раздела «Критичные параметры» или «уточнить по официальной документации».</p>${codeForm(db, c, `/codes/${c.id}`)}`,
    }));
  });

  app.post('/codes/:id', async (req, reply) => {
    const db = getDb();
    const id = Number(req.params.id);
    try {
      tx(db, () => {
        saveCode(db, req.body ?? {}, id);
        indexOne(db, 'code', id);
      });
      return go(reply, `/codes/${id}`, 'Сохранено');
    } catch (e) {
      if (e.statusCode === 400) return go(reply, `/codes/${id}/edit`, e.message);
      if (/UNIQUE/.test(e.message)) return go(reply, `/codes/${id}/edit`, 'Такой код уже есть');
      throw e;
    }
  });

  app.post('/codes/:id/delete', async (req, reply) => {
    const db = getDb();
    const id = Number(req.params.id);
    tx(db, () => {
      db.prepare("DELETE FROM sources WHERE owner_kind = 'code' AND owner_id = ?").run(id);
      db.prepare('DELETE FROM dtc_codes WHERE id = ?').run(id);
      removeIndex(db, 'code', id);
    });
    return go(reply, '/codes', 'Код удалён');
  });

  // ---------- история на машине ----------
  app.get('/events', async (req, reply) => {
    const db = getDb();
    const q = normCode(req.query.q ?? '');
    const rows = db.prepare(
      `SELECT e.*, c.title FROM dtc_events e LEFT JOIN dtc_codes c ON c.id = e.code_id
       ${q ? 'WHERE e.code LIKE ?' : ''} ORDER BY e.date DESC, e.id DESC LIMIT 200`,
    ).all(...(q ? [`%${q}%`] : []));
    return reply.html(page({
      title: 'История ошибок',
      active: 'menu',
      flash: flash(req),
      body: h`${backLink('/codes', 'Коды')}${pageTitle('История ошибок', h`<a class="btn small" href="/events/new">+ Событие</a>`)}
<form method="get" action="/events" class="filter">${textInput('q', { value: req.query.q ?? '', placeholder: 'Фильтр по коду' })}<button class="btn ghost" type="submit">Показать</button></form>
${rows.length ? h`<ul class="list">${rows.map(eventRow)}</ul>` : emptyState('Событий пока нет. Когда считаете коды сканером, записывайте их здесь.')}`,
    }));
  });

  app.get('/events/new', async (req, reply) => reply.html(page({
    title: 'Новое событие',
    active: 'menu',
    flash: flash(req),
    body: h`${backLink('/events', 'История')}${pageTitle('Записать ошибку')}${eventForm(getDb(), { code: req.query.code ?? '', action: '/events', submit: 'Записать' })}`,
  })));

  app.post('/events', async (req, reply) => {
    const db = getDb();
    try {
      const id = saveEvent(db, req.body ?? {});
      const e = db.prepare('SELECT code_id FROM dtc_events WHERE id = ?').get(id);
      return go(reply, e.code_id ? `/codes/${e.code_id}` : '/events', 'Событие записано');
    } catch (e) {
      if (e.statusCode === 400) return go(reply, '/events/new', e.message);
      throw e;
    }
  });

  app.get('/events/:id', async (req, reply) => {
    const db = getDb();
    const e = db.prepare('SELECT * FROM dtc_events WHERE id = ?').get(Number(req.params.id));
    if (!e) return reply.callNotFound();
    return reply.html(page({
      title: `Событие ${e.code}`,
      active: 'menu',
      flash: flash(req),
      body: h`${backLink(e.code_id ? `/codes/${e.code_id}` : '/events', 'Назад')}${pageTitle(`Событие ${e.code}`)}
${eventForm(db, { e, action: `/events/${e.id}` })}
<div class="actions">${confirmForm(`/events/${e.id}/delete`, 'Удалить событие', 'Удалить событие?')}</div>`,
    }));
  });

  app.post('/events/:id', async (req, reply) => {
    const db = getDb();
    const id = Number(req.params.id);
    try {
      saveEvent(db, req.body ?? {}, id);
      return go(reply, `/events/${id}`, 'Сохранено');
    } catch (e) {
      if (e.statusCode === 400) return go(reply, `/events/${id}`, e.message);
      throw e;
    }
  });

  app.post('/events/:id/delete', async (req, reply) => {
    getDb().prepare('DELETE FROM dtc_events WHERE id = ?').run(Number(req.params.id));
    return go(reply, '/events', 'Событие удалено');
  });
}
