// Критичные параметры: значение сохраняется только вместе с источником.
import { getDb } from '../db.js';
import { h, raw, fmtDate, txt, today } from '../lib/html.js';
import { page, pageTitle, backLink } from '../views/layout.js';
import { field, textInput, selectInput, statusBadge } from '../lib/ui.js';
import { flash, go } from '../lib/web.js';
import { SPEC_MISSING, specIsFilled } from '../lib/specs.js';

function sourceCell(s, docs) {
  if (!s.value) return '';
  const parts = [];
  if (s.source_document_id) {
    const d = docs.find((x) => x.id === s.source_document_id);
    parts.push(h`<a href="/docs/${s.source_document_id}">${d?.title ?? 'документ'}</a>${s.source_page ? `, стр. ${s.source_page}` : ''}`);
  }
  if (s.source_url) parts.push(h`<a href="${s.source_url}" target="_blank" rel="noopener noreferrer">ссылка</a>${s.source_page ? `, ${s.source_page}` : ''}`);
  if (!parts.length) return h`<span class="st st-overdue">нет источника, значение скрыто</span>`;
  return h`${parts.map((p, i) => h`${i ? ' · ' : ''}${p}`)} <span class="muted">${s.source_date ? `· ${fmtDate(s.source_date)}` : ''}${s.applies_to ? ` · ${s.applies_to}` : ''}</span>`;
}

export default function register(app) {
  app.get('/specs', async (req, reply) => {
    const db = getDb();
    const specs = db.prepare('SELECT s.*, sy.name AS system_name, sy.sort FROM specs s LEFT JOIN systems sy ON sy.id = s.system_id ORDER BY sy.sort, s.name').all();
    const docs = db.prepare('SELECT id, title FROM documents').all();
    const groups = new Map();
    for (const s of specs) {
      const k = s.system_name || 'Без системы';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    }
    const filled = specs.filter(specIsFilled).length;
    return reply.html(page({
      title: 'Критичные параметры',
      active: 'menu',
      flash: flash(req),
      body: h`${backLink('/menu', 'Меню')}${pageTitle('Критичные параметры')}
<p>Моменты затяжки, установка и натяжение ГРМ, допуски и объёмы жидкостей, регулировки. Приложение само ничего из этого не знает и не подставляет: значение появляется только после того, как вы укажете его вместе с официальным источником (документ из архива или официальная ссылка). Пока источника нет, везде показывается «${SPEC_MISSING}».</p>
<p class="muted">Заполнено: ${filled} из ${specs.length}.</p>
${[...groups].map(([name, list]) => h`<h2>${name}</h2>${list.map((s) => h`<div class="card" id="${s.key}">
<div class="rem"><b>${s.name}</b>${specIsFilled(s) ? statusBadge(s.status) : ''}</div>
<p>${specIsFilled(s) ? h`<b>${s.value}${s.unit ? ` ${s.unit}` : ''}</b>` : h`<span class="spec-missing">${SPEC_MISSING}</span>`}</p>
${s.value ? h`<p class="muted">${sourceCell(s, docs)}</p>` : ''}
<a class="btn small ghost" href="/specs/${s.id}">${s.value ? 'Изменить' : 'Заполнить'}</a>
</div>`)}`)}`,
    }));
  });

  app.get('/specs/:id', async (req, reply) => {
    const db = getDb();
    const s = db.prepare('SELECT * FROM specs WHERE id = ?').get(Number(req.params.id));
    if (!s) return reply.callNotFound();
    const docs = db.prepare("SELECT id, title FROM documents ORDER BY title").all().map((d) => [d.id, d.title]);
    return reply.html(page({
      title: s.name,
      active: 'menu',
      flash: flash(req),
      body: h`${backLink('/specs', 'Параметры')}${pageTitle(s.name)}
<p class="muted">Ключ для статей: <code>{{spec:${s.key}}}</code></p>
<form method="post" action="/specs/${s.id}">
<div class="row">${field('Значение', textInput('value', { value: s.value }))}${field('Единица', textInput('unit', { value: s.unit }))}</div>
<fieldset><legend>Источник (обязателен для значения)</legend>
${field('Документ из архива', selectInput('source_document_id', docs, s.source_document_id, { empty: 'Не выбран' }))}
${field('или официальная ссылка', textInput('source_url', { value: s.source_url, type: 'url', placeholder: 'https://' }))}
<div class="row">${field('Страница или раздел', textInput('source_page', { value: s.source_page }))}${field('Дата', textInput('source_date', { type: 'date', value: s.source_date || today() }))}</div>
${field('К чему относится', textInput('applies_to', { value: s.applies_to, placeholder: 'ARG, Passat B5 3BG, …' }))}
</fieldset>
<div class="checks"><label><input type="checkbox" name="verified" value="1"${s.status === 'verified' ? raw(' checked') : ''}> Проверено мной по документу</label></div>
<button class="btn block" type="submit">Сохранить</button>
</form>
<p class="muted">Чтобы убрать значение, очистите поле «Значение».</p>`,
    }));
  });

  app.post('/specs/:id', async (req, reply) => {
    const db = getDb();
    const id = Number(req.params.id);
    const s = db.prepare('SELECT * FROM specs WHERE id = ?').get(id);
    if (!s) return reply.callNotFound();
    const b = req.body ?? {};
    const value = txt(b.value);
    const docId = Number(b.source_document_id) || null;
    const url = txt(b.source_url);
    if (url && !/^https?:\/\//i.test(url)) return go(reply, `/specs/${id}`, 'Ссылка должна начинаться с http:// или https://');
    if (value && !docId && !url) {
      return go(reply, `/specs/${id}`, 'Без источника значение не сохраняется: выберите документ из архива или укажите официальную ссылку.');
    }
    db.prepare(
      `UPDATE specs SET value = ?, unit = ?, source_document_id = ?, source_url = ?, source_page = ?, source_date = ?, applies_to = ?, status = ? WHERE id = ?`,
    ).run(value, txt(b.unit), value ? docId : null, value ? url : null, value ? txt(b.source_page) : null, value ? txt(b.source_date) : null,
      value ? txt(b.applies_to) : null, b.verified && value ? 'verified' : 'unverified', id);
    return go(reply, '/specs', 'Сохранено');
  });
}
