// Страница поиска: читает ?q= и ?kind=, загружает индекс и показывает результаты.
import { runSearch, highlight, esc } from './searchcore.js';

const base = document.documentElement.dataset.base || '/';
const params = new URLSearchParams(location.search);
const q = (params.get('q') || '').trim().slice(0, 200);
const kind = params.get('kind') || '';
const labels = JSON.parse(document.getElementById('search-kinds').textContent);
const input = document.querySelector('.searchbar input[name=q]');
const results = document.getElementById('search-results');
const chips = document.getElementById('search-chips');
const hint = document.getElementById('search-hint');

if (input) {
  input.value = q;
  if (!q) input.focus();
}
// Фильтр раздела сохраняется при новом поиске.
if (kind && labels[kind] && input) {
  const hidden = document.createElement('input');
  hidden.type = 'hidden';
  hidden.name = 'kind';
  hidden.value = kind;
  input.form.prepend(hidden);
}

const link = (u) => base + u.replace(/^\//, '');
const searchUrl = (k) => `${base}search/?${new URLSearchParams(k ? { q, kind: k } : { q })}`;

async function main() {
  if (!q) return;
  hint.hidden = true;
  results.innerHTML = '<li class="empty">Ищу…</li>';
  let index;
  try {
    index = await (await fetch(`${base}search-index.json`)).json();
  } catch {
    results.innerHTML = '<li class="empty">Не удалось загрузить данные для поиска. Обновите страницу.</li>';
    return;
  }
  const all = runSearch(index, q);
  const counts = {};
  for (const d of all) counts[d.k] = (counts[d.k] || 0) + 1;
  const shown = kind ? all.filter((d) => d.k === kind) : all;
  chips.innerHTML = [`<a href="${esc(searchUrl(''))}" class="${kind ? '' : 'on'}">Всё (${all.length})</a>`]
    .concat(Object.keys(labels).filter((k) => counts[k]).map((k) => `<a href="${esc(searchUrl(k))}" class="${kind === k ? 'on' : ''}">${esc(labels[k])} (${counts[k]})</a>`))
    .join('');
  results.innerHTML = shown.length
    ? shown.map((d) => `<li><a class="item" href="${esc(link(d.u))}"><span class="s">${esc(labels[d.k])}</span><span class="t">${highlight(d.t, q, 200)}</span><span class="snip">${highlight(d.x, q)}</span></a></li>`).join('')
    : '<li class="empty">Ничего не найдено. Попробуйте другое слово или его часть.</li>';
  document.title = `Поиск: ${q} · Passat B5`;
}

main();
