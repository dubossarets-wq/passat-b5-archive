import { getDb } from '../db.js';
import { h } from '../lib/html.js';
import { page, pageTitle } from '../views/layout.js';
import { textInput } from '../lib/ui.js';
import { search, KINDS } from '../lib/search.js';

export default function register(app) {
  app.get('/search', async (req, reply) => {
    const db = getDb();
    const q = String(req.query.q ?? '').trim();
    const kind = KINDS[req.query.kind] ? req.query.kind : '';
    const all = q ? search(db, q) : [];
    const counts = Object.keys(KINDS).map((k) => [k, all.filter((x) => x.kind === k).length]);
    const shown = kind ? all.filter((x) => x.kind === kind) : all;
    const chip = (k, label, n) => h`<a href="/search?${new URLSearchParams({ q, kind: k }).toString()}" class="${kind === k ? 'on' : ''}">${label}${n != null ? ` (${n})` : ''}</a>`;
    return reply.html(page({
      title: 'Поиск',
      active: 'search',
      body: h`${pageTitle('Поиск')}
<form method="get" action="/search" class="filter">
<input id="f-q" name="q" type="search" value="${q}" placeholder="Журнал, документы, статьи, коды, запчасти" autofocus>
<button class="btn" type="submit">Найти</button>
</form>
${q ? h`<div class="chips">${chip('', 'Всё', all.length)}${counts.filter(([, n]) => n).map(([k, n]) => chip(k, KINDS[k].label, n))}</div>` : h`<p class="muted">Ищет по журналу работ, документам (включая текст внутри PDF), статьям, кодам ошибок и запчастям. Номера деталей находятся с пробелами и без.</p>`}
${q && !shown.length ? h`<p class="empty">Ничего не найдено. Попробуйте другое слово или часть слова.</p>` : ''}
<ul class="list">${shown.map((r) => h`<li><a class="item" href="${r.url}"><span class="s">${KINDS[r.kind].label}</span><span class="t">${r.titleHtml}</span><span class="snip">${r.snippet}</span></a></li>`)}</ul>`,
    }));
  });
}
