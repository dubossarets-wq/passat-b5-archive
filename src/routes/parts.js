import { getDb, tx, lastId } from '../db.js';
import { h, raw, fmtDate, fmtMoney, num, txt, today } from '../lib/html.js';
import { page, pageTitle, backLink } from '../views/layout.js';
import { field, textInput, textArea, systemSelect, selectInput, statusBadge, verifyForm, sourcesBlock, confirmForm, emptyState, pager } from '../lib/ui.js';
import { flash, go } from '../lib/web.js';
import { currency } from '../lib/vehicle.js';
import { normPart } from '../lib/stem.js';
import { indexOne, removeIndex, search } from '../lib/search.js';

const PAGE_SIZE = 40;

// Где эта деталь уже ставилась: по ссылке на каталог или по совпадению номера (с учётом аналогов).
export function installedBefore(db, part) {
  const norms = new Set([part.oem_norm, ...db.prepare('SELECT number_norm FROM part_analogs WHERE part_id = ?').all(part.id).map((a) => a.number_norm)]);
  const rows = db.prepare(
    `SELECT rp.*, r.date, r.odometer_km, r.id AS rid, r.title AS rtitle
     FROM record_parts rp JOIN records r ON r.id = rp.record_id ORDER BY r.date DESC, r.id DESC`,
  ).all();
  return rows.filter((x) => x.part_id === part.id || (x.number && norms.has(normPart(x.number))));
}

function partForm(db, p = {}, action) {
  const items = db.prepare('SELECT id, name FROM maintenance_items ORDER BY sort, name').all().map((m) => [m.id, m.name]);
  return h`<form method="post" action="${action}">
${field('Оригинальный номер VAG', textInput('oem', { value: p.oem, required: true, attrs: ' autocapitalize="characters"' }), 'Например, в виде 06A 115 561 B (пробелы не мешают поиску)')}
${field('Название', textInput('name', { value: p.name, required: true }))}
${field('Система', systemSelect(db, 'system_id', p.system_id))}
${field('Позиция регламента', selectInput('maintenance_item_id', items, p.maintenance_item_id, { empty: 'Нет' }))}
${field('Применимость и заметки', textArea('notes', p.notes, 4), 'Год выпуска, PR-коды, номер двигателя, что важно при подборе')}
<button class="btn block" type="submit">Сохранить</button></form>`;
}

export default function register(app) {
  app.get('/parts', async (req, reply) => {
    const db = getDb();
    const { q = '', system = '' } = req.query;
    const pg = Math.max(1, Number(req.query.page) || 1);
    const where = [];
    const params = [];
    if (system) { where.push('p.system_id = ?'); params.push(Number(system)); }
    if (q.trim()) {
      const ids = search(db, q, { kinds: ['part'], limit: 500 }).map((x) => x.id);
      where.push(`p.id IN (${ids.length ? ids.join(',') : '0'})`);
    }
    const rows = db.prepare(
      `SELECT p.*, s.name AS system_name,
        (SELECT group_concat(brand || ' ' || number, ' · ') FROM part_analogs a WHERE a.part_id = p.id) AS analogs
       FROM parts p LEFT JOIN systems s ON s.id = p.system_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY s.sort, p.name LIMIT ? OFFSET ?`,
    ).all(...params, PAGE_SIZE + 1, (pg - 1) * PAGE_SIZE);
    const more = rows.length > PAGE_SIZE;
    const base = `/parts?${new URLSearchParams({ q, system }).toString()}`;
    return reply.html(page({
      title: 'Запчасти',
      active: 'menu',
      flash: flash(req),
      body: h`${pageTitle('Запчасти', h`<a class="btn small" href="/parts/new">+ Деталь</a>`)}
<form method="get" action="/parts" class="filter">
${textInput('q', { value: q, placeholder: 'Номер VAG, аналог, название' })}
<select name="system" data-autosubmit aria-label="Система"><option value="">Все системы</option>${db.prepare('SELECT id, name FROM systems ORDER BY sort').all().map((s) => h`<option value="${s.id}"${String(s.id) === String(system) ? raw(' selected') : ''}>${s.name}</option>`)}</select>
<button class="btn ghost" type="submit">Найти</button>
</form>
${rows.length ? h`<ul class="list">${rows.slice(0, PAGE_SIZE).map((p) => h`<li><a class="item" href="/parts/${p.id}"><span class="t">${p.name}</span>
<span class="s">${p.oem}${p.system_name ? ` · ${p.system_name}` : ''}</span>
${p.analogs ? h`<span class="tags">аналоги: ${p.analogs}</span>` : ''}${statusBadge(p.status)}</a></li>`)}</ul>` : emptyState('Деталей не найдено.')}
${pager(base, pg, more)}`,
    }));
  });

  app.get('/parts/new', async (req, reply) => reply.html(page({
    title: 'Новая деталь',
    active: 'menu',
    flash: flash(req),
    body: h`${backLink('/parts', 'Запчасти')}${pageTitle('Новая деталь')}${partForm(getDb(), {}, '/parts')}`,
  })));

  app.post('/parts', async (req, reply) => {
    const db = getDb();
    const b = req.body ?? {};
    const oem = txt(b.oem);
    const name = txt(b.name);
    if (!oem || !name) return go(reply, '/parts/new', 'Нужны номер и название');
    let id;
    tx(db, () => {
      id = lastId(db.prepare(
        "INSERT INTO parts (oem, oem_norm, name, system_id, maintenance_item_id, notes, status) VALUES (?, ?, ?, ?, ?, ?, 'verified')",
      ).run(oem, normPart(oem), name, Number(b.system_id) || null, Number(b.maintenance_item_id) || null, txt(b.notes)));
      indexOne(db, 'part', id);
    });
    return go(reply, `/parts/${id}`, 'Деталь добавлена');
  });

  app.get('/parts/:id', async (req, reply) => {
    const db = getDb();
    const id = Number(req.params.id);
    const p = db.prepare(
      `SELECT p.*, s.name AS system_name, m.name AS item_name FROM parts p
       LEFT JOIN systems s ON s.id = p.system_id LEFT JOIN maintenance_items m ON m.id = p.maintenance_item_id WHERE p.id = ?`,
    ).get(id);
    if (!p) return reply.callNotFound();
    const cur = currency(db);
    const analogs = db.prepare('SELECT * FROM part_analogs WHERE part_id = ? ORDER BY brand').all(id);
    const purchases = db.prepare('SELECT * FROM part_purchases WHERE part_id = ? ORDER BY date DESC, id DESC').all(id);
    const sources = db.prepare("SELECT * FROM sources WHERE owner_kind = 'part' AND owner_id = ?").all(id);
    const before = installedBefore(db, p);
    const back = `/parts/${id}`;
    return reply.html(page({
      title: p.name,
      active: 'menu',
      flash: flash(req),
      body: h`${backLink('/parts', 'Запчасти')}${pageTitle(p.name)}
<p><b style="font-size:22px">${p.oem}</b> ${statusBadge(p.status)}</p>
<dl class="kv">
<dt>Система</dt><dd>${p.system_name || '—'}</dd>
<dt>Регламент</dt><dd>${p.maintenance_item_id ? h`<a href="/maintenance/${p.maintenance_item_id}">${p.item_name}</a>` : '—'}</dd>
<dt>Применимость</dt><dd style="white-space:pre-wrap">${p.notes || '—'}</dd>
</dl>
<div class="actions"><a class="btn" href="/journal/new?part=${id}">Поставил — в журнал</a>${verifyForm('part', id, p.status, back)}</div>

<h2>Что ставил в прошлый раз</h2>
${before.length ? h`<div class="table-wrap"><table><thead><tr><th>Дата</th><th>Что стоит</th><th>Цена</th></tr></thead><tbody>
${before.map((x) => h`<tr><td class="num"><a href="/journal/${x.rid}">${fmtDate(x.date)}</a>${x.odometer_km != null ? h`<br><span class="muted">${x.odometer_km} км</span>` : ''}</td>
<td>${[x.brand, x.number].filter(Boolean).join(' ') || x.name}</td><td class="num">${x.price != null ? fmtMoney(x.price, cur) : ''}</td></tr>`)}
</tbody></table></div>` : h`<p class="empty">Ещё не ставилась. Когда добавите запись журнала с этой деталью, она появится здесь.</p>`}

<h2>Аналоги</h2>
${analogs.length ? h`<div class="table-wrap"><table><thead><tr><th>Производитель</th><th>Номер</th><th></th></tr></thead><tbody>
${analogs.map((a) => h`<tr><td>${a.brand}</td><td>${a.number}${a.source_url ? h` <a href="${a.source_url}" target="_blank" rel="noopener noreferrer">источник</a>` : ''}</td>
<td>${confirmForm(`/analogs/${a.id}/delete`, 'Удалить', 'Удалить аналог?', `<input type="hidden" name="back" value="${back}">`, 'btn small danger')}</td></tr>`)}
</tbody></table></div>` : h`<p class="empty">Аналогов нет.</p>`}
<details><summary class="btn ghost">Добавить аналог</summary>
<form method="post" action="/parts/${id}/analogs" style="margin-top:12px">
${field('Производитель', textInput('brand', { required: true }))}
${field('Номер', textInput('number', { required: true }))}
${field('Ссылка на источник', textInput('source_url', { type: 'url' }))}
<button class="btn block" type="submit">Добавить</button></form></details>

<h2>Где покупал</h2>
${purchases.length ? h`<div class="table-wrap"><table><thead><tr><th>Дата</th><th>Магазин</th><th>Цена</th><th></th></tr></thead><tbody>
${purchases.map((x) => h`<tr><td class="num">${fmtDate(x.date)}</td><td>${x.url ? h`<a href="${x.url}" target="_blank" rel="noopener noreferrer">${x.shop || x.url}</a>` : x.shop || ''}${x.note ? h`<br><span class="muted">${x.note}</span>` : ''}</td>
<td class="num">${x.price != null ? fmtMoney(x.price, cur) : ''}</td>
<td>${confirmForm(`/purchases/${x.id}/delete`, 'Удалить', 'Удалить покупку?', `<input type="hidden" name="back" value="${back}">`, 'btn small danger')}</td></tr>`)}
</tbody></table></div>` : h`<p class="empty">Покупок нет.</p>`}
<details><summary class="btn ghost">Добавить покупку</summary>
<form method="post" action="/parts/${id}/purchases" style="margin-top:12px">
<div class="row">${field('Дата', textInput('date', { type: 'date', value: today() }))}${field(`Цена, ${cur}`, textInput('price', { inputmode: 'decimal' }))}</div>
${field('Магазин', textInput('shop'))}
${field('Ссылка на товар', textInput('url', { type: 'url' }))}
${field('Заметка', textInput('note'))}
<button class="btn block" type="submit">Добавить</button></form></details>

${sourcesBlock(sources, { title: 'Откуда взят номер' })}
<details><summary class="btn ghost">Добавить источник</summary>
<form method="post" action="/sources" style="margin-top:12px">
<input type="hidden" name="owner_kind" value="part"><input type="hidden" name="owner_id" value="${id}"><input type="hidden" name="back" value="${back}">
${field('Ссылка', textInput('url', { type: 'url', required: true }))}${field('Название', textInput('title'))}${field('К чему относится', textInput('applies_to'))}${field('Что взято', textInput('note'))}
<button class="btn block" type="submit">Добавить</button></form></details>
<div class="actions"><a class="btn" href="/parts/${id}/edit">Изменить</a>${confirmForm(`/parts/${id}/delete`, 'Удалить деталь', 'Удалить деталь вместе с аналогами и покупками?')}</div>`,
    }));
  });

  app.get('/parts/:id/edit', async (req, reply) => {
    const db = getDb();
    const p = db.prepare('SELECT * FROM parts WHERE id = ?').get(Number(req.params.id));
    if (!p) return reply.callNotFound();
    return reply.html(page({
      title: 'Изменить деталь',
      active: 'menu',
      flash: flash(req),
      body: h`${backLink(`/parts/${p.id}`, 'К детали')}${pageTitle('Изменить деталь')}${partForm(db, p, `/parts/${p.id}`)}`,
    }));
  });

  app.post('/parts/:id', async (req, reply) => {
    const db = getDb();
    const id = Number(req.params.id);
    const b = req.body ?? {};
    const oem = txt(b.oem);
    const name = txt(b.name);
    if (!oem || !name) return go(reply, `/parts/${id}/edit`, 'Нужны номер и название');
    tx(db, () => {
      db.prepare('UPDATE parts SET oem = ?, oem_norm = ?, name = ?, system_id = ?, maintenance_item_id = ?, notes = ? WHERE id = ?')
        .run(oem, normPart(oem), name, Number(b.system_id) || null, Number(b.maintenance_item_id) || null, txt(b.notes), id);
      indexOne(db, 'part', id);
    });
    return go(reply, `/parts/${id}`, 'Сохранено');
  });

  app.post('/parts/:id/delete', async (req, reply) => {
    const db = getDb();
    const id = Number(req.params.id);
    tx(db, () => {
      db.prepare("DELETE FROM sources WHERE owner_kind = 'part' AND owner_id = ?").run(id);
      db.prepare('DELETE FROM parts WHERE id = ?').run(id);
      removeIndex(db, 'part', id);
    });
    return go(reply, '/parts', 'Деталь удалена');
  });

  app.post('/parts/:id/analogs', async (req, reply) => {
    const db = getDb();
    const id = Number(req.params.id);
    const b = req.body ?? {};
    if (!txt(b.brand) || !txt(b.number)) return go(reply, `/parts/${id}`, 'Нужны производитель и номер');
    tx(db, () => {
      db.prepare('INSERT INTO part_analogs (part_id, brand, number, number_norm, source_url) VALUES (?, ?, ?, ?, ?)')
        .run(id, txt(b.brand), txt(b.number), normPart(b.number), txt(b.source_url));
      indexOne(db, 'part', id);
    });
    return go(reply, `/parts/${id}`, 'Аналог добавлен');
  });

  app.post('/analogs/:id/delete', async (req, reply) => {
    const db = getDb();
    const a = db.prepare('SELECT part_id FROM part_analogs WHERE id = ?').get(Number(req.params.id));
    if (a) {
      db.prepare('DELETE FROM part_analogs WHERE id = ?').run(Number(req.params.id));
      indexOne(db, 'part', a.part_id);
    }
    return go(reply, a ? `/parts/${a.part_id}` : '/parts', 'Аналог удалён');
  });

  app.post('/parts/:id/purchases', async (req, reply) => {
    const db = getDb();
    const id = Number(req.params.id);
    const b = req.body ?? {};
    db.prepare('INSERT INTO part_purchases (part_id, date, shop, price, url, note) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, txt(b.date), txt(b.shop), num(b.price), txt(b.url), txt(b.note));
    return go(reply, `/parts/${id}`, 'Покупка добавлена');
  });

  app.post('/purchases/:id/delete', async (req, reply) => {
    const db = getDb();
    const x = db.prepare('SELECT part_id FROM part_purchases WHERE id = ?').get(Number(req.params.id));
    if (x) db.prepare('DELETE FROM part_purchases WHERE id = ?').run(Number(req.params.id));
    return go(reply, x ? `/parts/${x.part_id}` : '/parts', 'Покупка удалена');
  });
}
