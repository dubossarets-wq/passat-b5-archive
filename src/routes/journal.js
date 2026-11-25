import { getDb, tx, lastId } from '../db.js';
import { h, raw, fmtDate, fmtKm, fmtMoney, int, num, txt, today } from '../lib/html.js';
import { page, pageTitle, backLink } from '../views/layout.js';
import { currentOdometer, currency, syncOdometer } from '../lib/vehicle.js';
import { field, textInput, textArea, systemSelect, fileGrid, confirmForm, emptyState, pager } from '../lib/ui.js';
import { flash, go, readForm, discardForm, filesOfField, arr } from '../lib/web.js';
import { commitUpload, filesOf, deleteOwnerFiles } from '../lib/files.js';
import { indexOne, removeIndex, search } from '../lib/search.js';

const PAGE_SIZE = 40;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const totalCost = (r) => (r.cost_work == null && r.cost_parts == null ? null : (r.cost_work ?? 0) + (r.cost_parts ?? 0));

function partRows(rows) {
  const list = rows.length ? rows : [{}];
  return h`<fieldset><legend>Детали</legend><div id="partrows">${list.map((p) => h`<div class="partrow">
<input type="hidden" name="part_id" value="${p.part_id ?? ''}">
${field('Название', textInput('part_name', { value: p.name, placeholder: 'например, масляный фильтр' }))}
<div class="row">
${field('Производитель', textInput('part_brand', { value: p.brand }))}
${field('Номер', textInput('part_number', { value: p.number }))}
</div>
<div class="row">
${field('Количество', textInput('part_qty', { value: p.qty, inputmode: 'decimal' }))}
${field('Цена за штуку', textInput('part_price', { value: p.price, inputmode: 'decimal' }))}
</div></div>`)}</div>
<p><button class="btn ghost small" type="button" data-add-part>+ ещё деталь</button></p></fieldset>`;
}

function recordForm(db, { rec = {}, parts = [], itemIds = [], action, quick = false, existingFiles = [] }) {
  const items = db.prepare('SELECT id, name FROM maintenance_items WHERE active = 1 ORDER BY sort, name').all();
  const cur = currentOdometer(db);
  const km = rec.odometer_km ?? (rec.id ? '' : cur?.km ?? '');
  const filesField = h`${field('Фото', raw('<input id="f-photos" type="file" name="photos" accept="image/*" capture="environment">'), 'Откроется камера. Можно добавить несколько снимков, выбрав их из галереи ниже.')}
${field('Ещё фото и чеки', raw('<input id="f-receipts" type="file" name="receipts" accept="image/*,application/pdf" multiple>'))}`;
  return h`<form method="post" action="${action}" enctype="multipart/form-data">
${quick ? h`<input type="hidden" name="quick" value="1">` : ''}
<div class="row">
${field('Дата', textInput('date', { type: 'date', value: rec.date || today(), required: true }))}
${field('Пробег, км', textInput('odometer_km', { value: km, inputmode: 'numeric' }))}
</div>
${field('Что сделано', textInput('title', { value: rec.title, required: true, placeholder: 'например, замена масла и фильтра' }))}
${field('Система', systemSelect(db, 'system_id', rec.system_id))}
${quick ? filesField : ''}
${quick ? '' : field('Подробности', textArea('description', rec.description, 4))}
${quick ? '' : h`<div class="row">
${field('Кто делал', textInput('performed_by', { value: rec.performed_by, list: 'who', placeholder: 'сам / название СТО' }))}
<datalist id="who"><option value="Сам"><option value="СТО"></datalist>
<div></div></div>
<div class="row">
${field(`Стоимость работ, ${currency(db)}`, textInput('cost_work', { value: rec.cost_work, inputmode: 'decimal' }))}
${field(`Стоимость деталей, ${currency(db)}`, textInput('cost_parts', { value: rec.cost_parts, inputmode: 'decimal' }))}
</div>`}
${items.length ? h`<fieldset class="checks"><legend>Закрывает позиции регламента</legend>${items.map((i) => h`<label><input type="checkbox" name="item" value="${i.id}"${itemIds.includes(i.id) ? raw(' checked') : ''}> ${i.name}</label>`)}</fieldset>` : ''}
${quick ? '' : partRows(parts)}
${quick ? '' : filesField}
${existingFiles.length ? h`<p class="muted">Уже прикреплено:</p>${fileGrid(existingFiles, { deletable: true, back: `/journal/${rec.id}/edit` })}` : ''}
<button class="btn block" type="submit">Сохранить</button>
</form>`;
}

// Сохранение записи (создание или правка). Возвращает id.
function saveRecord(db, f, id = null) {
  const date = String(f.date ?? '').trim();
  const title = txt(f.title);
  if (!DATE_RE.test(date)) throw Object.assign(new Error('Укажите дату'), { statusCode: 400 });
  if (!title) throw Object.assign(new Error('Укажите, что сделано'), { statusCode: 400 });
  const vals = [
    date, int(f.odometer_km), title, int(f.system_id), txt(f.description), txt(f.performed_by), num(f.cost_work), num(f.cost_parts),
  ];
  let recId = id;
  if (id) {
    db.prepare(
      `UPDATE records SET date = ?, odometer_km = ?, title = ?, system_id = ?, description = ?, performed_by = ?,
       cost_work = ?, cost_parts = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(...vals, id);
  } else {
    recId = lastId(db.prepare(
      `INSERT INTO records (date, odometer_km, title, system_id, description, performed_by, cost_work, cost_parts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(...vals));
  }
  // Позиции регламента
  db.prepare('DELETE FROM record_items WHERE record_id = ?').run(recId);
  for (const itemId of arr(f.item).map(Number).filter(Number.isInteger)) {
    db.prepare('INSERT OR IGNORE INTO record_items (record_id, maintenance_item_id) VALUES (?, ?)').run(recId, itemId);
  }
  // Детали (форма пересобирает список целиком, но в быстрой форме деталей нет — не трогаем)
  if (f.quick !== '1') {
    db.prepare('DELETE FROM record_parts WHERE record_id = ?').run(recId);
    const names = arr(f.part_name);
    const ids = arr(f.part_id);
    const brands = arr(f.part_brand);
    const numbers = arr(f.part_number);
    const qtys = arr(f.part_qty);
    const prices = arr(f.part_price);
    names.forEach((name, i) => {
      if (!txt(name)) return;
      db.prepare('INSERT INTO record_parts (record_id, part_id, name, qty, price, brand, number) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(recId, int(ids[i]), txt(name), num(qtys[i]), num(prices[i]), txt(brands[i]), txt(numbers[i]));
    });
  }
  syncOdometer(db, recId);
  return recId;
}

export default function register(app) {
  app.get('/journal', async (req, reply) => {
    const db = getDb();
    const { q = '', system = '', year = '' } = req.query;
    const pg = Math.max(1, Number(req.query.page) || 1);
    const where = [];
    const params = [];
    if (system) { where.push('r.system_id = ?'); params.push(Number(system)); }
    if (/^\d{4}$/.test(year)) { where.push("substr(r.date, 1, 4) = ?"); params.push(year); }
    if (q.trim()) {
      const ids = search(db, q, { kinds: ['record'], limit: 500 }).map((x) => x.id);
      where.push(`r.id IN (${ids.length ? ids.join(',') : '0'})`);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = db.prepare(
      `SELECT r.*, s.name AS system_name FROM records r LEFT JOIN systems s ON s.id = r.system_id ${w}
       ORDER BY r.date DESC, r.id DESC LIMIT ? OFFSET ?`,
    ).all(...params, PAGE_SIZE + 1, (pg - 1) * PAGE_SIZE);
    const hasMore = rows.length > PAGE_SIZE;
    const shown = rows.slice(0, PAGE_SIZE);
    const sums = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(COALESCE(cost_work,0) + COALESCE(cost_parts,0)), 0) AS total FROM records r ${w}`).get(...params);
    const years = db.prepare("SELECT DISTINCT substr(date, 1, 4) AS y FROM records ORDER BY y DESC").all().map((x) => x.y);
    const cur = currency(db);
    const base = `/journal?${new URLSearchParams({ q, system, year }).toString()}`;

    return reply.html(page({
      title: 'Журнал работ',
      active: 'menu',
      flash: flash(req),
      body: h`${pageTitle('Журнал работ', h`<a class="btn small" href="/journal/new">+ Запись</a>`)}
<form method="get" action="/journal" class="filter">
${textInput('q', { value: q, placeholder: 'Поиск по журналу' })}
<div class="row"><select name="system" data-autosubmit aria-label="Система"><option value="">Все системы</option>${db.prepare('SELECT id, name FROM systems ORDER BY sort').all().map((s) => h`<option value="${s.id}"${String(s.id) === String(system) ? raw(' selected') : ''}>${s.name}</option>`)}</select>
<select name="year" data-autosubmit aria-label="Год"><option value="">Все годы</option>${years.map((y) => h`<option${y === year ? raw(' selected') : ''}>${y}</option>`)}</select></div>
<button class="btn ghost" type="submit">Найти</button>
</form>
<p class="muted">Записей: ${sums.n}${sums.total ? ` · на сумму ${fmtMoney(sums.total, cur)}` : ''}</p>
${shown.length ? h`<ul class="list">${shown.map((r) => h`<li><a class="item" href="/journal/${r.id}"><span class="t">${r.title}</span>
<span class="s">${fmtDate(r.date)}${r.odometer_km != null ? ` · ${fmtKm(r.odometer_km)}` : ''}${r.system_name ? ` · ${r.system_name}` : ''}${totalCost(r) ? ` · ${fmtMoney(totalCost(r), cur)}` : ''}</span></a></li>`)}</ul>` : emptyState('Записей не найдено.', h`<p><a class="btn" href="/journal/new">Добавить первую запись</a></p>`)}
${pager(base, pg, hasMore)}`,
    }));
  });

  app.get('/journal/quick', async (req, reply) => {
    const db = getDb();
    return reply.html(page({
      title: 'Быстрая запись',
      active: 'quick',
      flash: flash(req),
      body: h`${pageTitle('Быстрая запись')}${recordForm(db, { action: '/journal', quick: true })}
<p style="margin-top:16px"><a href="/journal/new">Нужна подробная запись</a></p>`,
    }));
  });

  app.get('/journal/new', async (req, reply) => {
    const db = getDb();
    const rec = { date: today() };
    const itemIds = [];
    const parts = [];
    const item = req.query.item ? db.prepare('SELECT * FROM maintenance_items WHERE id = ?').get(Number(req.query.item)) : null;
    if (item) {
      rec.title = item.name;
      rec.system_id = item.system_id;
      itemIds.push(item.id);
    }
    const part = req.query.part ? db.prepare('SELECT * FROM parts WHERE id = ?').get(Number(req.query.part)) : null;
    if (part) {
      parts.push({ part_id: part.id, name: part.name, number: part.oem });
      rec.system_id ??= part.system_id;
      rec.title ??= `Замена: ${part.name}`;
    }
    return reply.html(page({
      title: 'Новая запись',
      active: 'menu',
      body: h`${backLink('/journal', 'Журнал')}${pageTitle('Новая запись')}
${item ? h`<p class="muted">Позиция регламента отмечена. Укажите, когда и при каком пробеге это было сделано.</p>` : ''}
${recordForm(db, { rec, itemIds, parts, action: '/journal' })}`,
    }));
  });

  app.post('/journal', async (req, reply) => {
    const db = getDb();
    const form = await readForm(req);
    try {
      let id;
      tx(db, () => {
        id = saveRecord(db, form.fields);
        for (const { field: fld, rec } of form.files) {
          commitUpload(db, rec, { ownerKind: 'record', ownerId: id, kind: fld === 'receipts' ? 'receipt' : 'photo' });
        }
        indexOne(db, 'record', id);
      });
      return go(reply, `/journal/${id}`, 'Запись добавлена');
    } catch (e) {
      discardForm(form);
      if (e.statusCode === 400) return go(reply, '/journal/new', e.message);
      throw e;
    }
  });

  app.get('/journal/:id', async (req, reply) => {
    const db = getDb();
    const id = Number(req.params.id);
    const r = db.prepare('SELECT r.*, s.name AS system_name FROM records r LEFT JOIN systems s ON s.id = r.system_id WHERE r.id = ?').get(id);
    if (!r) return reply.callNotFound();
    const parts = db.prepare('SELECT * FROM record_parts WHERE record_id = ?').all(id);
    const items = db.prepare('SELECT m.id, m.name FROM record_items ri JOIN maintenance_items m ON m.id = ri.maintenance_item_id WHERE ri.record_id = ?').all(id);
    const files = filesOf(db, 'record', id);
    const photos = files.filter((f) => f.kind !== 'receipt' && /^image\//.test(f.mime));
    const receipts = files.filter((f) => !photos.includes(f));
    const cur = currency(db);
    const total = totalCost(r);
    return reply.html(page({
      title: r.title,
      active: 'menu',
      flash: flash(req),
      body: h`${backLink('/journal', 'Журнал')}${pageTitle(r.title)}
<dl class="kv">
<dt>Дата</dt><dd>${fmtDate(r.date)}</dd>
<dt>Пробег</dt><dd>${r.odometer_km != null ? fmtKm(r.odometer_km) : '—'}</dd>
<dt>Система</dt><dd>${r.system_name || '—'}</dd>
<dt>Кто делал</dt><dd>${r.performed_by || '—'}</dd>
<dt>Стоимость</dt><dd>${total != null ? h`${fmtMoney(total, cur)}${r.cost_work != null && r.cost_parts != null ? h` <span class="muted">(работы ${fmtMoney(r.cost_work, cur)}, детали ${fmtMoney(r.cost_parts, cur)})</span>` : ''}` : '—'}</dd>
</dl>
${r.description ? h`<p style="white-space:pre-wrap">${r.description}</p>` : ''}
${items.length ? h`<p>Закрыто по регламенту: ${items.map((i, n) => h`${n ? ', ' : ''}<a href="/maintenance/${i.id}">${i.name}</a>`)}</p>` : ''}
${parts.length ? h`<h2>Детали</h2><div class="table-wrap"><table><thead><tr><th>Название</th><th>Производитель</th><th>Номер</th><th>Кол-во</th><th>Цена</th></tr></thead><tbody>
${parts.map((p) => h`<tr><td>${p.part_id ? h`<a href="/parts/${p.part_id}">${p.name}</a>` : p.name}</td><td>${p.brand || ''}</td><td>${p.number || ''}</td><td class="num">${p.qty ?? ''}</td><td class="num">${p.price != null ? fmtMoney(p.price, cur) : ''}</td></tr>`)}
</tbody></table></div>` : ''}
${photos.length ? h`<h2>Фото</h2>${fileGrid(photos)}` : ''}
${receipts.length ? h`<h2>Чеки и документы</h2>${fileGrid(receipts)}` : ''}
<div class="actions"><a class="btn" href="/journal/${id}/edit">Изменить</a>${confirmForm(`/journal/${id}/delete`, 'Удалить', 'Удалить запись вместе с файлами?')}</div>`,
    }));
  });

  app.get('/journal/:id/edit', async (req, reply) => {
    const db = getDb();
    const id = Number(req.params.id);
    const rec = db.prepare('SELECT * FROM records WHERE id = ?').get(id);
    if (!rec) return reply.callNotFound();
    const parts = db.prepare('SELECT * FROM record_parts WHERE record_id = ?').all(id);
    const itemIds = db.prepare('SELECT maintenance_item_id AS id FROM record_items WHERE record_id = ?').all(id).map((x) => x.id);
    return reply.html(page({
      title: 'Изменить запись',
      active: 'menu',
      flash: flash(req),
      body: h`${backLink(`/journal/${id}`, 'К записи')}${pageTitle('Изменить запись')}
${recordForm(db, { rec, parts, itemIds, action: `/journal/${id}`, existingFiles: filesOf(db, 'record', id) })}`,
    }));
  });

  app.post('/journal/:id', async (req, reply) => {
    const db = getDb();
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM records WHERE id = ?').get(id)) return reply.callNotFound();
    const form = await readForm(req);
    try {
      tx(db, () => {
        saveRecord(db, form.fields, id);
        for (const { field: fld, rec } of form.files) {
          commitUpload(db, rec, { ownerKind: 'record', ownerId: id, kind: fld === 'receipts' ? 'receipt' : 'photo' });
        }
        indexOne(db, 'record', id);
      });
      return go(reply, `/journal/${id}`, 'Сохранено');
    } catch (e) {
      discardForm(form);
      if (e.statusCode === 400) return go(reply, `/journal/${id}/edit`, e.message);
      throw e;
    }
  });

  app.post('/journal/:id/delete', async (req, reply) => {
    const db = getDb();
    const id = Number(req.params.id);
    tx(db, () => {
      deleteOwnerFiles(db, 'record', id);
      db.prepare('DELETE FROM odometer WHERE record_id = ?').run(id);
      db.prepare('DELETE FROM records WHERE id = ?').run(id);
      removeIndex(db, 'record', id);
    });
    return go(reply, '/journal', 'Запись удалена');
  });
}
