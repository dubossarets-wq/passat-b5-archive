import { getDb } from '../db.js';
import { h } from '../lib/html.js';
import { page, pageTitle, backLink } from '../views/layout.js';
import { statusBadge, sourcesBlock, emptyState, searchBox, groupBySystem } from '../lib/ui.js';
import { textWithSpecs } from '../lib/specs.js';
import { jsonList } from '../lib/search.js';

export default function register(app) {
  app.get('/codes', async (req, reply) => {
    const db = getDb();
    const rows = db.prepare(
      'SELECT c.*, s.name AS system_name FROM dtc_codes c LEFT JOIN systems s ON s.id = c.system_id ORDER BY s.sort, c.code',
    ).all();
    return reply.html(page({
      title: 'Коды ошибок',
      active: 'codes',
      body: h`${pageTitle('Коды ошибок')}
${searchBox('/search', '', 'P0102, 16486 или слово: расходомер, лямбда…', 'code')}
<p class="muted">Кодов в справочнике: ${rows.length}. Общие коды OBD-II и пятизначные коды VAG с соответствием P-кодам.</p>
${rows.length ? groupBySystem(rows).map(([name, list]) => h`<h2>${name}</h2><ul class="list">${list.map((c) => h`<li><a class="item" href="/codes/${c.id}">
<span class="t">${c.code}${c.vag && c.vag !== c.code ? h` <span class="muted">· VAG ${c.vag}</span>` : ''}</span>
<span class="s">${c.title}</span></a></li>`)}</ul>`) : emptyState('Кодов нет.')}`,
    }));
  });

  app.get('/codes/:id', async (req, reply) => {
    const db = getDb();
    const c = db.prepare('SELECT c.*, s.name AS system_name FROM dtc_codes c LEFT JOIN systems s ON s.id = c.system_id WHERE c.id = ?').get(Number(req.params.id));
    if (!c) return reply.callNotFound();
    const sources = db.prepare("SELECT * FROM sources WHERE owner_kind = 'code' AND owner_id = ? ORDER BY id").all(c.id);
    const causes = jsonList(c.causes);
    const checks = jsonList(c.checks);
    return reply.html(page({
      title: c.code,
      active: 'codes',
      body: h`${backLink('/codes', 'Коды ошибок')}${pageTitle(`${c.code}${c.vag && c.vag !== c.code ? ` · VAG ${c.vag}` : ''}`)}
<p class="lead">${c.title}</p>
<p>${statusBadge(c.status)} <span class="muted">${c.system_name || ''}${c.applies_to ? ` · относится к: ${c.applies_to}` : ''}</span></p>
${c.description ? h`<p>${textWithSpecs(c.description)}</p>` : ''}
${causes.length ? h`<h2>Частые причины</h2><ul class="plain">${causes.map((x) => h`<li>${textWithSpecs(x)}</li>`)}</ul>` : ''}
${checks.length ? h`<h2>Что проверить</h2><ol class="plain">${checks.map((x) => h`<li>${textWithSpecs(x)}</li>`)}</ol>` : ''}
${sourcesBlock(sources)}`,
    }));
  });
}
