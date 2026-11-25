// Раздел «Электросхемы»: ссылки на открытые схемы и распиновки с описанием своими словами.
// Сами схемы из чужих источников не копируются.
import { getDb } from '../db.js';
import { h } from '../lib/html.js';
import { page, pageTitle } from '../views/layout.js';
import { emptyState, searchBox, groupBySystem } from '../lib/ui.js';
import { icon } from '../lib/icons.js';
import { SCHEME_KIND_LABEL } from '../lib/search.js';

const SOURCE_LABEL = { official: 'официальный', reference: 'справочник', forum: 'форум', blog: 'бортжурнал / блог', video: 'видео' };

export default function register(app) {
  app.get('/schemes', async (req, reply) => {
    const db = getDb();
    const rows = db.prepare(
      `SELECT s.*, sy.name AS system_name FROM schemes s LEFT JOIN systems sy ON sy.id = s.system_id ORDER BY sy.sort, s.kind, s.title`,
    ).all();
    return reply.html(page({
      title: 'Электросхемы',
      active: 'menu',
      body: h`${pageTitle('Электросхемы')}
${searchBox('/search', '', 'Фары, ЭБУ, предохранители, стеклоподъёмник…', 'scheme')}
<p class="muted">Ссылки на открытые схемы, распиновки и описания цепей с пометкой, к какому мотору и кузову относятся (ваша машина — кузов 3B, 2000 модельный год, мотор ARG). Полные официальные схемы — в erWin, это платный доступ на сайте Volkswagen.</p>
${rows.length ? groupBySystem(rows).map(([name, list]) => h`<h2>${name}</h2><ul class="list">${list.map((s) => h`<li id="s${s.id}"><div class="item">
<a class="t" href="${s.url}" target="_blank" rel="noopener noreferrer">${s.title} ${icon('external')}</a>
${s.description ? h`<span class="snip">${s.description}</span>` : ''}
<span class="s">${SCHEME_KIND_LABEL[s.kind] ?? s.kind} · ${SOURCE_LABEL[s.source_type] ?? s.source_type}${s.applies_to ? ` · ${s.applies_to}` : ''}</span>
</div></li>`)}</ul>`) : emptyState('Ссылок на схемы пока нет.')}`,
    }));
  });
}
