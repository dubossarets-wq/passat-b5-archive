import { getDb } from '../db.js';
import { h } from '../lib/html.js';
import { page, pageTitle, SECTIONS } from '../views/layout.js';
import { icon } from '../lib/icons.js';
import { searchBox } from '../lib/ui.js';

const COUNT_SQL = {
  '/codes': 'SELECT COUNT(*) AS n FROM dtc_codes',
  '/kb': 'SELECT COUNT(*) AS n FROM articles',
  '/schemes': 'SELECT (SELECT COUNT(*) FROM schemes) + (SELECT COUNT(*) FROM diagrams) AS n',
  '/parts': 'SELECT COUNT(*) AS n FROM parts',
  '/maintenance': 'SELECT COUNT(*) AS n FROM maintenance_items',
  '/links': 'SELECT COUNT(*) AS n FROM links',
};

function tiles(db) {
  return h`<nav class="tiles">${SECTIONS.filter(([href]) => href !== '/').map(([href, label, ic]) => h`<a class="tile" href="${href}">
<span class="tile-ic">${icon(ic, { size: '1.4em' })}</span><span class="t">${label}</span><span class="n">${db.prepare(COUNT_SQL[href]).get().n}</span></a>`)}</nav>`;
}

export default function register(app) {
  app.get('/', async (req, reply) => {
    const db = getDb();
    return reply.html(page({
      title: 'Главная',
      active: 'home',
      body: h`${pageTitle('VW Passat B5 · 1.8 20V ARG')}
<p class="muted">Справочник по машине: коды ошибок, ремонт и типовые проблемы, электросхемы, номера запчастей, регламент ТО.</p>
${searchBox('/search', '', 'Код ошибки, деталь, номер, проблема…')}
${tiles(db)}
<p class="note">Всё из открытых источников, со ссылками. У каждого материала — проверка: «сверено по источникам» (два и больше независимых источника) и «подходит вашей машине» (3B, 2000, ARG). Моменты затяжки, объёмы и регулировки — только из официальных документов (erWin).</p>`,
    }));
  });

  app.get('/menu', async (req, reply) => {
    const db = getDb();
    return reply.html(page({
      title: 'Разделы',
      active: 'menu',
      body: h`${pageTitle('Разделы')}${tiles(db)}`,
    }));
  });
}
