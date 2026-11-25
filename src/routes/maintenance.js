import { getDb, lastId } from '../db.js';
import { h, raw, fmtDate, fmtKm, int, txt } from '../lib/html.js';
import { page, pageTitle, backLink } from '../views/layout.js';
import { getReminders } from '../lib/vehicle.js';
import { field, textInput, textArea, systemSelect, statusBadge, verifyForm, sourcesBlock, confirmForm, reminderBadge } from '../lib/ui.js';
import { flash, go } from '../lib/web.js';
import { dueText } from './home.js';

const NUM = new Intl.NumberFormat('ru-RU');
const fmt = (n) => NUM.format(n).replace(/ /g, ' ');

export function intervalText(m) {
  const parts = [];
  if (m.interval_km) parts.push(`${fmt(m.interval_km)} км`);
  if (m.interval_months) parts.push(`${m.interval_months} мес.`);
  return parts.length ? `каждые ${parts.join(' или ')} (что наступит раньше)` : 'интервал не задан';
}

export function reminderLine(r) {
  return h`${reminderBadge(r.status)}${r.status === 'nodata' || r.status === 'nointerval' ? '' : h` · ${dueText(r)}`}`;
}

export default function register(app) {
  app.get('/maintenance', async (req, reply) => {
    const db = getDb();
    const rem = getReminders(db, { onlyActive: false });
    const active = rem.list.filter((r) => r.item.active);
    const off = rem.list.filter((r) => !r.item.active);
    const card = (r) => h`<div class="card">
<div class="rem"><a href="/maintenance/${r.item.id}"><b>${r.item.name}</b></a>${reminderBadge(r.status)}</div>
<p class="muted">${intervalText(r.item)}${r.item.interval_km || r.item.interval_months ? h` ${statusBadge(r.item.status)}` : ''}</p>
${r.last ? h`<p>Последняя замена: <a href="/journal/${r.last.id}">${fmtDate(r.last.date)}${r.last.km != null ? `, ${fmtKm(r.last.km)}` : ''}</a></p>` : h`<p class="muted">Записи о замене нет.</p>`}
${r.status === 'overdue' || r.status === 'soon' || r.status === 'ok' ? h`<p>${dueText(r)}</p>` : ''}
<div class="actions"><a class="btn small" href="/journal/new?item=${r.item.id}">Выполнено</a><a class="btn small ghost" href="/maintenance/${r.item.id}">Изменить</a></div>
</div>`;
    return reply.html(page({
      title: 'Регламент',
      active: 'menu',
      flash: flash(req),
      body: h`${backLink('/menu', 'Меню')}${pageTitle('Регламент и напоминания')}
<p class="muted">Считается от последней записи журнала, где отмечена эта позиция. Пробег сейчас: ${rem.currentKm != null ? fmtKm(rem.currentKm) : 'не указан'}. «Скоро» — за ${fmt(rem.soonKm)} км или ${rem.soonDays} дн. (меняется в <a href="/settings">настройках</a>).</p>
<div class="cards">${active.map(card)}</div>
${off.length ? h`<h2>Отключено</h2><div class="cards">${off.map(card)}</div>` : ''}
<details><summary class="btn ghost">Добавить свою позицию</summary>
<form method="post" action="/maintenance" style="margin-top:12px">
${field('Название', textInput('name', { required: true }))}
${field('Система', systemSelect(db, 'system_id', null))}
<div class="row">${field('Интервал, км', textInput('interval_km', { inputmode: 'numeric' }))}${field('Интервал, месяцев', textInput('interval_months', { inputmode: 'numeric' }))}</div>
<button class="btn block" type="submit">Добавить</button></form></details>`,
    }));
  });

  app.post('/maintenance', async (req, reply) => {
    const db = getDb();
    const b = req.body ?? {};
    const name = txt(b.name);
    if (!name) return go(reply, '/maintenance', 'Укажите название');
    const sort = (db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM maintenance_items').get().n);
    const id = lastId(db.prepare(
      "INSERT INTO maintenance_items (name, system_id, interval_km, interval_months, status, sort) VALUES (?, ?, ?, ?, 'unverified', ?)",
    ).run(name, int(b.system_id), int(b.interval_km), int(b.interval_months), sort));
    return go(reply, `/maintenance/${id}`, 'Позиция добавлена');
  });

  app.get('/maintenance/:id', async (req, reply) => {
    const db = getDb();
    const id = Number(req.params.id);
    const m = db.prepare('SELECT * FROM maintenance_items WHERE id = ?').get(id);
    if (!m) return reply.callNotFound();
    const rem = getReminders(db, { onlyActive: false }).list.find((r) => r.item.id === id);
    const history = db.prepare(
      `SELECT r.id, r.date, r.odometer_km, r.title FROM record_items ri JOIN records r ON r.id = ri.record_id
       WHERE ri.maintenance_item_id = ? ORDER BY r.date DESC, r.id DESC LIMIT 20`,
    ).all(id);
    const sources = db.prepare("SELECT * FROM sources WHERE owner_kind = 'maintenance' AND owner_id = ?").all(id);
    const back = `/maintenance/${id}`;
    return reply.html(page({
      title: m.name,
      active: 'menu',
      flash: flash(req),
      body: h`${backLink('/maintenance', 'Регламент')}${pageTitle(m.name)}
<p>${reminderLine(rem)}</p>
<p class="muted">${intervalText(m)} ${statusBadge(m.status)}</p>
<div class="actions"><a class="btn" href="/journal/new?item=${id}">Выполнено</a>${verifyForm('maintenance', id, m.status, back)}</div>
${m.note ? h`<p style="white-space:pre-wrap">${m.note}</p>` : ''}
${sourcesBlock(sources, { title: 'Откуда взят интервал' })}
<h2>Изменить</h2>
<form method="post" action="/maintenance/${id}">
${field('Название', textInput('name', { value: m.name, required: true }))}
${field('Система', systemSelect(db, 'system_id', m.system_id))}
<div class="row">${field('Интервал, км', textInput('interval_km', { value: m.interval_km, inputmode: 'numeric' }))}${field('Интервал, месяцев', textInput('interval_months', { value: m.interval_months, inputmode: 'numeric' }))}</div>
${field('Заметка', textArea('note', m.note, 3))}
<div class="checks"><label><input type="checkbox" name="active" value="1"${m.active ? raw(' checked') : ''}> Следить за этой позицией</label></div>
<p class="muted">Если вы поменяли интервал, статус вернётся к «не проверено». Отметьте «проверено мной», когда сверите с документами.</p>
<button class="btn block" type="submit">Сохранить</button>
</form>
<h2>Добавить источник</h2>
<form method="post" action="/sources">
<input type="hidden" name="owner_kind" value="maintenance"><input type="hidden" name="owner_id" value="${id}"><input type="hidden" name="back" value="${back}">
${field('Ссылка', textInput('url', { type: 'url', required: true }))}
${field('Название', textInput('title'))}
${field('К чему относится', textInput('applies_to', { placeholder: 'ARG, Passat B5, …' }))}
${field('Что взято из источника', textInput('note'))}
<button class="btn ghost block" type="submit">Добавить источник</button></form>
<h2>История замен</h2>
${history.length ? h`<ul class="list">${history.map((r) => h`<li><a class="item" href="/journal/${r.id}"><span class="t">${fmtDate(r.date)}${r.odometer_km != null ? ` · ${fmtKm(r.odometer_km)}` : ''}</span><span class="s">${r.title}</span></a></li>`)}</ul>` : h`<p class="empty">Пока нет записей с этой позицией.</p>`}
<div class="actions">${confirmForm(`/maintenance/${id}/delete`, 'Удалить позицию', 'Удалить позицию регламента? Записи журнала останутся.')}</div>`,
    }));
  });

  app.post('/maintenance/:id', async (req, reply) => {
    const db = getDb();
    const id = Number(req.params.id);
    const m = db.prepare('SELECT * FROM maintenance_items WHERE id = ?').get(id);
    if (!m) return reply.callNotFound();
    const b = req.body ?? {};
    const km = int(b.interval_km);
    const months = int(b.interval_months);
    const changed = km !== m.interval_km || months !== m.interval_months;
    db.prepare(
      'UPDATE maintenance_items SET name = ?, system_id = ?, interval_km = ?, interval_months = ?, note = ?, active = ?, status = ? WHERE id = ?',
    ).run(txt(b.name) ?? m.name, int(b.system_id), km, months, txt(b.note), b.active ? 1 : 0, changed ? 'unverified' : m.status, id);
    return go(reply, `/maintenance/${id}`, 'Сохранено');
  });

  app.post('/maintenance/:id/delete', async (req, reply) => {
    const id = Number(req.params.id);
    const db = getDb();
    db.prepare("DELETE FROM sources WHERE owner_kind = 'maintenance' AND owner_id = ?").run(id);
    db.prepare('DELETE FROM maintenance_items WHERE id = ?').run(id);
    return go(reply, '/maintenance', 'Позиция удалена');
  });
}
