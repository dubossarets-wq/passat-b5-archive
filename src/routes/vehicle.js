import { getDb, tx } from '../db.js';
import { h, raw, fmtDate, fmtKm, fmtMoney, int, txt, today } from '../lib/html.js';
import { page, pageTitle, backLink } from '../views/layout.js';
import { getVehicle, currentOdometer, getReminders, currency } from '../lib/vehicle.js';
import { field, textInput, textArea, selectInput, fileGrid } from '../lib/ui.js';
import { flash, go, readForm, discardForm, filesOfField } from '../lib/web.js';
import { commitUpload, filesOf } from '../lib/files.js';
import { reminderLine } from './maintenance.js';

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

function card(v, cur) {
  const rows = [
    ['Название', v.name],
    ['VIN', v.vin],
    ['Кузов', v.body_code],
    ['Двигатель', v.engine_code],
    ['КПП', v.gearbox_code],
    ['Год выпуска', v.model_year],
    ['Дата выпуска', fmtDate(v.build_date)],
    ['Код краски', v.paint_code],
    ['PR-коды', v.pr_codes],
    ['Комплектация', v.trim],
    ['Дата покупки', fmtDate(v.purchase_date)],
    ['Пробег при покупке', v.purchase_odometer != null ? fmtKm(v.purchase_odometer) : ''],
    ['Текущий пробег', cur ? `${fmtKm(cur.km)} (на ${fmtDate(cur.date)})` : ''],
    ['Заметки', v.notes],
  ];
  return h`<dl class="kv">${rows.map(([k, val]) => h`<dt>${k}</dt><dd>${val || h`<span class="muted">—</span>`}</dd>`)}</dl>`;
}

export default function register(app) {
  app.get('/vehicle', async (req, reply) => {
    const db = getDb();
    const v = getVehicle(db);
    const cur = currentOdometer(db);
    const readings = db.prepare('SELECT id, date, km, record_id FROM odometer WHERE vehicle_id = 1 ORDER BY date DESC, id DESC LIMIT 15').all();
    return reply.html(page({
      title: 'Карточка машины',
      active: 'menu',
      flash: flash(req),
      body: h`${backLink('/menu', 'Меню')}${pageTitle('Карточка машины')}
${card(v, cur)}
${fileGrid(filesOf(db, 'vehicle', 1))}
<div class="actions"><a class="btn" href="/vehicle/edit">Изменить</a><a class="btn ghost" href="/print/vehicle">Печать карточки</a></div>
<h2>Показания пробега</h2>
${readings.length ? h`<ul class="list">${readings.map((r) => h`<li><div class="item rem"><span><b>${fmtKm(r.km)}</b> <span class="muted">${fmtDate(r.date)}${r.record_id ? h` · из <a href="/journal/${r.record_id}">записи журнала</a>` : ''}</span></span>
${r.record_id ? '' : h`<form method="post" action="/odometer/${r.id}/delete" data-confirm="Удалить показание?"><button class="btn small danger" type="submit">Удалить</button></form>`}</div></li>`)}</ul>` : h`<p class="empty">Показаний нет.</p>`}`,
    }));
  });

  app.post('/odometer/:id/delete', async (req, reply) => {
    getDb().prepare('DELETE FROM odometer WHERE id = ? AND record_id IS NULL').run(Number(req.params.id));
    return go(reply, '/vehicle', 'Показание удалено');
  });

  app.get('/vehicle/edit', async (req, reply) => {
    const db = getDb();
    const v = getVehicle(db);
    return reply.html(page({
      title: 'Карточка машины',
      active: 'menu',
      flash: flash(req),
      body: h`${backLink('/vehicle', 'Карточка')}${pageTitle('Изменить карточку')}
<p class="muted">Значения сверьте по VIN и наклейке с данными автомобиля (обычно в багажнике или в сервисной книжке).</p>
<form method="post" action="/vehicle" enctype="multipart/form-data">
${field('Название', textInput('name', { value: v.name }))}
${field('VIN', textInput('vin', { value: v.vin, attrs: ' autocapitalize="characters" maxlength="17"' }), '17 символов, латиница и цифры, без I, O, Q')}
<div class="row">
${field('Кузов', selectInput('body_code', [['3B', '3B (до рестайлинга)'], ['3BG', '3BG (рестайлинг)']], v.body_code, { empty: 'Уточнить по VIN' }))}
${field('Код двигателя', textInput('engine_code', { value: v.engine_code }))}
</div>
<div class="row">
${field('Код КПП', textInput('gearbox_code', { value: v.gearbox_code }))}
${field('Год выпуска', textInput('model_year', { value: v.model_year, inputmode: 'numeric' }))}
</div>
<div class="row">
${field('Дата выпуска', textInput('build_date', { value: v.build_date, type: 'date' }))}
${field('Код краски', textInput('paint_code', { value: v.paint_code }))}
</div>
${field('PR-коды с наклейки', textArea('pr_codes', v.pr_codes, 3), 'Через пробел или запятую')}
${field('Комплектация', textInput('trim', { value: v.trim }))}
<div class="row">
${field('Дата покупки', textInput('purchase_date', { value: v.purchase_date, type: 'date' }))}
${field('Пробег при покупке, км', textInput('purchase_odometer', { value: v.purchase_odometer, inputmode: 'numeric' }))}
</div>
${field('Заметки', textArea('notes', v.notes, 4))}
${field('Добавить фото', raw('<input id="f-photos" type="file" name="photos" accept="image/*" multiple>'))}
<button class="btn block" type="submit">Сохранить</button>
</form>`,
    }));
  });

  app.post('/vehicle', async (req, reply) => {
    const db = getDb();
    const form = await readForm(req);
    try {
      const f = form.fields;
      let vin = txt(f.vin)?.toUpperCase().replace(/\s+/g, '') ?? null;
      tx(db, () => {
        db.prepare(
          `UPDATE vehicle SET name = ?, vin = ?, body_code = ?, engine_code = ?, gearbox_code = ?, model_year = ?, build_date = ?,
           paint_code = ?, pr_codes = ?, trim = ?, purchase_date = ?, purchase_odometer = ?, notes = ? WHERE id = 1`,
        ).run(txt(f.name) ?? 'VW Passat B5', vin, txt(f.body_code), txt(f.engine_code) ?? 'ARG', txt(f.gearbox_code), txt(f.model_year),
          txt(f.build_date), txt(f.paint_code), txt(f.pr_codes), txt(f.trim), txt(f.purchase_date), int(f.purchase_odometer), txt(f.notes));
        for (const { rec } of filesOfField(form, 'photos')) commitUpload(db, rec, { ownerKind: 'vehicle', ownerId: 1, kind: 'photo' });
      });
      const warn = vin && !VIN_RE.test(vin) ? ' Внимание: VIN не похож на настоящий (нужно 17 символов, без I, O, Q).' : '';
      return go(reply, '/vehicle', `Сохранено.${warn}`);
    } catch (e) {
      discardForm(form);
      throw e;
    }
  });

  // ---------- печать ----------
  app.get('/print', async (req, reply) => reply.html(page({
    title: 'Печать',
    active: 'menu',
    body: h`${backLink('/menu', 'Меню')}${pageTitle('Печать и PDF')}
<p>Откроется страница для печати. Чтобы получить PDF, в окне печати выберите «Сохранить как PDF».</p>
<p><a class="btn" href="/print/vehicle">Карточка машины</a></p>
<h2>Журнал работ</h2>
<form method="get" action="/print/journal">
<div class="row">${field('С даты', textInput('from', { type: 'date' }))}${field('По дату', textInput('to', { type: 'date' }))}</div>
<button class="btn" type="submit">Открыть журнал для печати</button>
</form>`,
  })));

  app.get('/print/vehicle', async (req, reply) => {
    const db = getDb();
    const v = getVehicle(db);
    const cur = currentOdometer(db);
    const rem = getReminders(db);
    return reply.html(page({
      title: 'Карточка машины', bare: true, printOnly: true,
      body: h`<p class="noprint"><a href="/print">← Назад</a> <button data-print class="btn small">Печать / PDF</button></p>
${pageTitle(v.name || 'VW Passat B5')}
<p class="muted">Напечатано ${fmtDate(today())}</p>
${card(v, cur)}
<h2>Регламент на ${fmtDate(today())}</h2>
<div class="table-wrap"><table><thead><tr><th>Позиция</th><th>Состояние</th><th>Срок</th></tr></thead><tbody>
${rem.list.map((r) => h`<tr><td>${r.item.name}</td><td>${reminderLine(r)}</td><td>${r.dueKm != null ? fmtKm(r.dueKm) : ''} ${r.dueDate ? fmtDate(r.dueDate) : ''}</td></tr>`)}
</tbody></table></div>`,
    }));
  });

  app.get('/print/journal', async (req, reply) => {
    const db = getDb();
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from ?? '') ? req.query.from : '0000-01-01';
    const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to ?? '') ? req.query.to : '9999-12-31';
    const cur = currency(db);
    const v = getVehicle(db);
    const rows = db.prepare(
      `SELECT r.*, s.name AS system_name FROM records r LEFT JOIN systems s ON s.id = r.system_id
       WHERE r.date BETWEEN ? AND ? ORDER BY r.date, r.id`,
    ).all(from, to);
    let total = 0;
    const body = rows.map((r) => {
      const sum = (r.cost_work ?? 0) + (r.cost_parts ?? 0);
      total += sum;
      const parts = db.prepare('SELECT name, brand, number, qty FROM record_parts WHERE record_id = ?').all(r.id);
      return h`<tr>
<td class="num">${fmtDate(r.date)}</td><td class="num">${r.odometer_km != null ? fmtKm(r.odometer_km) : ''}</td>
<td><b>${r.title}</b>${r.system_name ? h`<br><span class="muted">${r.system_name}</span>` : ''}${r.description ? h`<br>${r.description}` : ''}
${parts.length ? h`<br><span class="muted">Детали: ${parts.map((p) => [p.name, p.brand, p.number, p.qty ? `× ${p.qty}` : ''].filter(Boolean).join(' ')).join('; ')}</span>` : ''}
${r.performed_by ? h`<br><span class="muted">Кто делал: ${r.performed_by}</span>` : ''}</td>
<td class="num">${sum ? fmtMoney(sum, cur) : ''}</td></tr>`;
    });
    return reply.html(page({
      title: 'Журнал работ', bare: true, printOnly: true,
      body: h`<p class="noprint"><a href="/print">← Назад</a> <button data-print class="btn small">Печать / PDF</button></p>
${pageTitle(`Журнал работ: ${v.name || 'VW Passat B5'}`)}
<p class="muted">${v.vin ? `VIN ${v.vin} · ` : ''}период: ${from === '0000-01-01' ? 'с начала' : fmtDate(from)} — ${to === '9999-12-31' ? 'по сегодня' : fmtDate(to)} · записей: ${rows.length}</p>
<div class="table-wrap"><table><thead><tr><th>Дата</th><th>Пробег</th><th>Что сделано</th><th>Стоимость</th></tr></thead><tbody>${body}</tbody>
<tfoot><tr><th colspan="3">Итого</th><th class="num">${fmtMoney(total, cur)}</th></tr></tfoot></table></div>`,
    }));
  });
}
