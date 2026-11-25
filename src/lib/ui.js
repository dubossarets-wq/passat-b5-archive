// Небольшие элементы интерфейса справочника (только чтение).
import { h, fmtDate } from './html.js';
import { icon } from './icons.js';

export function statusBadge(status) {
  return status === 'verified'
    ? h`<span class="badge verified">проверено</span>`
    : h`<span class="badge unverified">не проверено</span>`;
}

// Строка поиска — единственное поле ввода в приложении.
export function searchBox(action, q = '', placeholder = 'Поиск', kind = '') {
  return h`<form method="get" action="${action}" class="searchbar" role="search">
${kind ? h`<input type="hidden" name="kind" value="${kind}">` : ''}
<input type="search" name="q" value="${q}" placeholder="${placeholder}" aria-label="${placeholder}">
<button type="submit" aria-label="Найти">${icon('search')}</button>
</form>`;
}

export function sourcesBlock(sources, { title = 'Источники' } = {}) {
  if (!sources || sources.length === 0) return '';
  return h`<section class="card"><h3>${title}</h3><ol class="sources">${sources.map((s) => h`<li>
${s.url ? h`<a href="${s.url}" target="_blank" rel="noopener noreferrer">${s.title || s.url}</a>` : (s.title || 'без названия')}
<span class="muted">${s.applies_to ? h` · относится к: ${s.applies_to}` : ''}${s.accessed ? h` · просмотрено ${fmtDate(s.accessed)}` : ''}</span>
${s.note ? h`<span class="note">${s.note}</span>` : ''}</li>`)}</ol></section>`;
}

export function emptyState(text) {
  return h`<p class="empty">${text}</p>`;
}

// Группировка строк по системе (порядок — как в справочнике систем).
export function groupBySystem(rows) {
  const groups = new Map();
  for (const r of rows) {
    const k = r.system_name || 'Общее';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups];
}
