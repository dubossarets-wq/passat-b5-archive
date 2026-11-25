import { getDb } from '../db.js';
import { h } from '../lib/html.js';
import { page, pageTitle, backLink } from '../views/layout.js';
import { statusBadge, sourcesBlock, emptyState, searchBox, groupBySystem } from '../lib/ui.js';
import { icon } from '../lib/icons.js';

export default function register(app) {
  app.get('/parts', async (req, reply) => {
    const db = getDb();
    const rows = db.prepare(
      `SELECT p.*, s.name AS system_name,
        (SELECT group_concat(brand || ' ' || number, ' · ') FROM part_analogs a WHERE a.part_id = p.id) AS analogs
       FROM parts p LEFT JOIN systems s ON s.id = p.system_id ORDER BY s.sort, p.name`,
    ).all();
    return reply.html(page({
      title: 'Запчасти',
      active: 'menu',
      body: h`${pageTitle('Запчасти')}
${searchBox('/search', '', 'Номер VAG, аналог или название', 'part')}
<p class="muted">Оригинальные номера VAG и аналоги для ARG / Passat B5. Применимость часто зависит от года, номера шасси и PR-кодов — смотрите примечание у детали.</p>
${rows.length ? groupBySystem(rows).map(([name, list]) => h`<h2>${name}</h2><ul class="list">${list.map((p) => h`<li><a class="item" href="/parts/${p.id}">
<span class="t">${p.name}</span><span class="s mono">${p.oem}</span>
${p.analogs ? h`<span class="tags">аналоги: ${p.analogs}</span>` : ''}</a></li>`)}</ul>`) : emptyState('Деталей нет.')}`,
    }));
  });

  app.get('/parts/:id', async (req, reply) => {
    const db = getDb();
    const p = db.prepare(
      `SELECT p.*, s.name AS system_name, m.name AS item_name FROM parts p
       LEFT JOIN systems s ON s.id = p.system_id LEFT JOIN maintenance_items m ON m.id = p.maintenance_item_id WHERE p.id = ?`,
    ).get(Number(req.params.id));
    if (!p) return reply.callNotFound();
    const analogs = db.prepare('SELECT * FROM part_analogs WHERE part_id = ? ORDER BY brand').all(p.id);
    const sources = db.prepare("SELECT * FROM sources WHERE owner_kind = 'part' AND owner_id = ? ORDER BY id").all(p.id);
    return reply.html(page({
      title: p.name,
      active: 'menu',
      body: h`${backLink('/parts', 'Запчасти')}${pageTitle(p.name)}
<p class="oem mono">${p.oem}</p>
<p>${statusBadge(p.status)} <span class="muted">${p.system_name || ''}</span></p>
${p.maintenance_item_id ? h`<p>Регламент: <a href="/maintenance/${p.maintenance_item_id}">${p.item_name}</a></p>` : ''}
${p.notes ? h`<h2>Применимость</h2><p class="pre">${p.notes}</p>` : ''}
<h2>Аналоги</h2>
${analogs.length ? h`<div class="table-wrap"><table><thead><tr><th>Производитель</th><th>Номер</th></tr></thead><tbody>
${analogs.map((a) => h`<tr><td>${a.brand}</td><td class="mono">${a.source_url ? h`<a href="${a.source_url}" target="_blank" rel="noopener noreferrer">${a.number} ${icon('external')}</a>` : a.number}</td></tr>`)}
</tbody></table></div>` : emptyState('Аналоги с номерами не найдены.')}
${sourcesBlock(sources, { title: 'Откуда взят номер' })}`,
    }));
  });
}
