// Небольшие элементы интерфейса, общие для страниц.
import { h, raw, fmtDate } from './html.js';
import { STATUS_LABEL } from './reminders.js';

export function field(label, control, hint = '') {
  return h`<label class="f"><span class="fl">${label}</span>${control}${hint ? h`<small class="hint">${hint}</small>` : ''}</label>`;
}

export function textInput(name, { value = '', type = 'text', required = false, placeholder = '', inputmode = '', list = '', attrs = '' } = {}) {
  return h`<input id="f-${name}" name="${name}" type="${type}" value="${value ?? ''}"${required ? raw(' required') : ''}${placeholder ? h` placeholder="${placeholder}"` : ''}${inputmode ? h` inputmode="${inputmode}"` : ''}${list ? h` list="${list}"` : ''}${raw(attrs)}>`;
}

export function textArea(name, value = '', rows = 4) {
  return h`<textarea id="f-${name}" name="${name}" rows="${rows}">${value ?? ''}</textarea>`;
}

export function selectInput(name, options, selected = '', { empty = null } = {}) {
  return h`<select id="f-${name}" name="${name}">${empty != null ? h`<option value="">${empty}</option>` : ''}${options.map(([v, l]) => h`<option value="${v}"${String(v) === String(selected ?? '') ? raw(' selected') : ''}>${l}</option>`)}</select>`;
}

export const systemOptions = (db) => db.prepare('SELECT id, name FROM systems ORDER BY sort, name').all().map((s) => [s.id, s.name]);

export function systemSelect(db, name, selected, empty = 'Не выбрана') {
  return selectInput(name, systemOptions(db), selected, { empty });
}

export function statusBadge(status) {
  return status === 'verified'
    ? h`<span class="badge verified">проверено мной</span>`
    : h`<span class="badge unverified">не проверено</span>`;
}

export function reminderBadge(status) {
  return h`<span class="st st-${status}">${STATUS_LABEL[status] ?? status}</span>`;
}

// Кнопка «отметить проверенным / не проверенным» для любого факта.
export function verifyForm(kind, id, status, back) {
  const next = status === 'verified' ? 'unverified' : 'verified';
  return h`<form method="post" action="/status" class="inline">
<input type="hidden" name="kind" value="${kind}"><input type="hidden" name="id" value="${id}">
<input type="hidden" name="value" value="${next}"><input type="hidden" name="back" value="${back}">
<button class="btn ghost" type="submit">${status === 'verified' ? 'Снять отметку «проверено»' : 'Отметить «проверено мной»'}</button></form>`;
}

export function confirmForm(action, label, message, extra = '', cls = 'btn danger') {
  return h`<form method="post" action="${action}" class="inline" data-confirm="${message}">${raw(extra)}<button class="${cls}" type="submit">${label}</button></form>`;
}

export function sourcesBlock(sources, { title = 'Источники' } = {}) {
  if (!sources || sources.length === 0) {
    return h`<section class="card"><h3>${title}</h3><p class="muted">Источников нет.</p></section>`;
  }
  return h`<section class="card"><h3>${title}</h3><ol class="sources">${sources.map((s) => h`<li>
${s.url ? h`<a href="${s.url}" target="_blank" rel="noopener noreferrer">${s.title || s.url}</a>` : (s.title || 'без названия')}
<span class="muted">${s.applies_to ? h` · относится к: ${s.applies_to}` : ''}${s.accessed ? h` · просмотрено ${fmtDate(s.accessed)}` : ''}</span>
${s.note ? h`<span class="note">${s.note}</span>` : ''}</li>`)}</ol></section>`;
}

export function fileGrid(files, { deletable = false, back = '' } = {}) {
  if (!files.length) return '';
  const imgs = files.filter((f) => /^image\//.test(f.mime));
  const others = files.filter((f) => !/^image\//.test(f.mime));
  return h`${imgs.length ? h`<div class="photos">${imgs.map((f) => h`<figure>
<a href="/files/${f.id}" target="_blank"><img src="/thumbs/${f.id}" alt="${f.orig_name}" loading="lazy"></a>
${deletable ? h`<form method="post" action="/files/${f.id}/delete" data-confirm="Удалить файл?"><input type="hidden" name="back" value="${back}"><button class="x" type="submit" aria-label="Удалить файл">×</button></form>` : ''}
</figure>`)}</div>` : ''}
${others.length ? h`<ul class="filelist">${others.map((f) => h`<li>${fileLink(f)}${deletable ? h` <form method="post" action="/files/${f.id}/delete" class="inline" data-confirm="Удалить файл?"><input type="hidden" name="back" value="${back}"><button class="btn small danger" type="submit">Удалить</button></form>` : ''}</li>`)}</ul>` : ''}`;
}

export function fileLink(f) {
  const size = f.size > 1048576 ? `${(f.size / 1048576).toFixed(1)} МБ` : `${Math.max(1, Math.round(f.size / 1024))} КБ`;
  const label = h`${f.orig_name} <span class="muted">(${size})</span>`;
  return f.mime === 'application/pdf'
    ? h`<a href="/view/${f.id}">${label}</a> · <a href="/files/${f.id}?download=1">скачать</a>`
    : h`<a href="/files/${f.id}" target="_blank">${label}</a>`;
}

export const textStatusLabel = {
  pending: 'текст извлекается…',
  done: 'текст найден, поиск по нему работает',
  empty: 'текста нет (скан): распознавание — этап 2',
  failed: 'не удалось прочитать текст',
  none: '',
};

export function emptyState(text, action = '') {
  return h`<p class="empty">${text}</p>${action}`;
}

export function pager(base, page, hasMore) {
  const sep = base.includes('?') ? '&' : '?';
  return h`<p class="pager">${page > 1 ? h`<a class="btn ghost" href="${base}${sep}page=${page - 1}">← Новее</a>` : ''}${hasMore ? h`<a class="btn ghost" href="${base}${sep}page=${page + 1}">Дальше →</a>` : ''}</p>`;
}
