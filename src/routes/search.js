// Страница поиска — оболочка; сам поиск идёт в браузере по индексу /search-index.json
// (так он работает и на статическом сайте без сервера).
import { getDb } from '../db.js';
import { h, raw } from '../lib/html.js';
import { page, pageTitle } from '../views/layout.js';
import { searchBox } from '../lib/ui.js';
import { buildSearchIndex, KINDS } from '../lib/search.js';

let cached = null;
export function searchIndexJson(db) {
  cached ??= JSON.stringify(buildSearchIndex(db));
  return cached;
}
export const resetSearchIndex = () => { cached = null; };

export default function register(app) {
  app.get('/search', async (req, reply) => reply.html(page({
    title: 'Поиск',
    active: 'search',
    body: h`${pageTitle('Поиск')}
${searchBox('/search', '', 'Код ошибки, деталь, номер, проблема…')}
<div id="search-chips" class="chips"></div>
<p id="search-hint" class="muted">Ищет сразу по кодам ошибок, статьям, электросхемам, запчастям, регламенту и ссылкам. Понимает разные формы слов (масло, масла, маслом), коды (P0102, 16486) и номера деталей с пробелами и без.</p>
<ul id="search-results" class="list"></ul>
<script type="application/json" id="search-kinds">${raw(JSON.stringify(Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, v.label]))).replace(/</g, '\\u003c'))}</script>
<script type="module" src="/static/js/searchpage.js"></script>`,
  })));

  app.get('/search-index.json', async (req, reply) => {
    reply.type('application/json; charset=utf-8').send(searchIndexJson(getDb()));
  });
}
