import { getDb } from '../db.js';
import { h } from '../lib/html.js';
import { page, pageTitle } from '../views/layout.js';
import { emptyState } from '../lib/ui.js';
import { icon } from '../lib/icons.js';

export const LINK_CATEGORIES = [
  ['official', 'Официальные'],
  ['reference', 'Справочники'],
  ['forum', 'Форумы'],
  ['blog', 'Бортжурналы и блоги'],
  ['catalog', 'Каталоги запчастей'],
  ['other', 'Другое'],
];

export default function register(app) {
  app.get('/links', async (req, reply) => {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM links ORDER BY title').all();
    const known = new Set(LINK_CATEGORIES.map(([k]) => k));
    const groups = LINK_CATEGORIES
      .map(([key, label]) => [label, rows.filter((l) => (known.has(l.category) ? l.category : 'other') === key)])
      .filter(([, l]) => l.length);
    return reply.html(page({
      title: 'Ссылки',
      active: 'menu',
      body: h`${pageTitle('Ссылки')}
<p class="muted">Официальные порталы, справочники, форумы, бортжурналы и каталоги. Платный доступ (например, erWin) оформляется на сайте производителя.</p>
${groups.length ? groups.map(([label, list]) => h`<h2>${label}</h2><ul class="list">${list.map((l) => h`<li><div class="item">
<a class="t" href="${l.url}" target="_blank" rel="noopener noreferrer">${l.title} ${icon('external')}</a>
${l.description ? h`<span class="snip">${l.description}</span>` : ''}
${l.applies_to ? h`<span class="s">${l.applies_to}</span>` : ''}</div></li>`)}</ul>`) : emptyState('Ссылок нет.')}`,
    }));
  });
}
