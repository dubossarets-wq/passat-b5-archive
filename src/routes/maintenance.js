import { getDb } from '../db.js';
import { h } from '../lib/html.js';
import { page, pageTitle, backLink } from '../views/layout.js';
import { statusBadge, sourcesBlock } from '../lib/ui.js';

const NUM = new Intl.NumberFormat('ru-RU');
const fmt = (n) => NUM.format(n).replace(/ /g, ' ');

export function intervalText(m) {
  const parts = [];
  if (m.interval_km) parts.push(`${fmt(m.interval_km)} км`);
  if (m.interval_months) parts.push(`${m.interval_months} мес.`);
  return parts.length ? `каждые ${parts.join(' или ')}` : 'интервал в открытых источниках не найден';
}

export default function register(app) {
  app.get('/maintenance', async (req, reply) => {
    const db = getDb();
    const items = db.prepare('SELECT * FROM maintenance_items ORDER BY sort, name').all();
    return reply.html(page({
      title: 'Регламент ТО',
      active: 'menu',
      body: h`${pageTitle('Регламент ТО')}
<p class="muted">Типовые интервалы замены из открытых источников. Официального графика ТО VW в открытом доступе нет, поэтому все значения — «не проверено»: сверяйте с сервисной книжкой. Если указаны и км, и месяцы — что наступит раньше.</p>
<div class="table-wrap"><table class="reg"><thead><tr><th>Позиция</th><th>Интервал</th><th></th></tr></thead><tbody>
${items.map((m) => h`<tr><td><a href="/maintenance/${m.id}">${m.name}</a></td><td>${intervalText(m)}</td><td>${m.interval_km || m.interval_months ? statusBadge(m.status) : ''}</td></tr>`)}
</tbody></table></div>`,
    }));
  });

  app.get('/maintenance/:id', async (req, reply) => {
    const db = getDb();
    const m = db.prepare('SELECT m.*, s.name AS system_name FROM maintenance_items m LEFT JOIN systems s ON s.id = m.system_id WHERE m.id = ?').get(Number(req.params.id));
    if (!m) return reply.callNotFound();
    const sources = db.prepare("SELECT * FROM sources WHERE owner_kind = 'maintenance' AND owner_id = ? ORDER BY id").all(m.id);
    const parts = db.prepare('SELECT id, name, oem FROM parts WHERE maintenance_item_id = ? ORDER BY name').all(m.id);
    return reply.html(page({
      title: m.name,
      active: 'menu',
      body: h`${backLink('/maintenance', 'Регламент ТО')}${pageTitle(m.name)}
<p class="lead">${intervalText(m)} ${m.interval_km || m.interval_months ? statusBadge(m.status) : ''}</p>
${m.note ? h`<p class="pre">${m.note}</p>` : ''}
${parts.length ? h`<h2>Детали</h2><ul class="list">${parts.map((p) => h`<li><a class="item" href="/parts/${p.id}"><span class="t">${p.name}</span><span class="s mono">${p.oem}</span></a></li>`)}</ul>` : ''}
${sourcesBlock(sources, { title: 'Откуда взят интервал' })}`,
    }));
  });
}
