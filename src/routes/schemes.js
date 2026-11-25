// Раздел «Электросхемы»: собственные схемы и распиновки (рисуются по фактам из источников)
// и материалы из открытых источников с картинками, которые показываются с исходного сайта.
import { getDb } from '../db.js';
import { h } from '../lib/html.js';
import { page, pageTitle, backLink } from '../views/layout.js';
import { emptyState, searchBox, groupBySystem, statusBadge, sourcesBlock } from '../lib/ui.js';
import { icon } from '../lib/icons.js';
import { SCHEME_KIND_LABEL } from '../lib/search.js';
import { wireColors } from '../lib/diagram.js';

const SOURCE_LABEL = { official: 'официальный', reference: 'справочник', forum: 'форум', blog: 'бортжурнал / блог', video: 'видео' };
const TYPE_LABEL = { pinout: 'распиновка', circuit: 'схема цепи' };

const images = (json) => {
  try { return JSON.parse(json ?? '[]') ?? []; } catch { return []; }
};

// Картинки загружаются с исходного сайта (не копируются), под каждой — откуда она.
export function gallery(list, pageUrl) {
  if (!list.length) return '';
  return h`<div class="shots">${list.map((im) => h`<figure>
<a href="${im.src}" target="_blank" rel="noopener noreferrer"><img src="${im.src}" alt="${im.caption || 'схема'}" loading="lazy" referrerpolicy="no-referrer"></a>
<figcaption>${im.caption || ''} <a href="${im.source_url || pageUrl || im.src}" target="_blank" rel="noopener noreferrer">источник</a></figcaption>
</figure>`)}</div>`;
}

// Превью на карточке — только оригинальные фото: слева сам компонент, справа его схема из источника.
function previews(d) {
  const photo = images(d.photo)[0];
  const schemePic = images(d.images)[0];
  const box = (pic, tag, emptyText) => h`<span class="pv-box">${pic
    ? h`<img src="${pic.src}" alt="${pic.caption || tag}" loading="lazy" referrerpolicy="no-referrer">`
    : h`<span class="pv-empty">${icon(tag === 'фото' ? 'parts' : 'schemes', { size: '1.6em' })}<small>${emptyText}</small></span>`}<span class="pv-tag">${tag}</span></span>`;
  return h`<span class="pv">${box(photo, 'фото', 'фото ищется')}${box(schemePic, 'схема', 'схема ищется')}</span>`;
}

export default function register(app) {
  app.get('/schemes', async (req, reply) => {
    const db = getDb();
    const diagrams = db.prepare(
      `SELECT d.id, d.title, d.type, d.applies_to, d.data, d.images, d.photo, d.part_numbers, s.name AS system_name
       FROM diagrams d LEFT JOIN systems s ON s.id = d.system_id ORDER BY s.sort, d.title`,
    ).all();
    const rows = db.prepare(
      `SELECT s.*, sy.name AS system_name FROM schemes s LEFT JOIN systems sy ON sy.id = s.system_id
       ORDER BY sy.sort, (s.images IS NULL), s.kind, s.title`,
    ).all();
    const withImages = rows.filter((r) => r.images).length;
    return reply.html(page({
      title: 'Электросхемы',
      active: 'menu',
      body: h`${pageTitle('Электросхемы')}
${searchBox('/search', '', 'Фары, ЭБУ, предохранители, стеклоподъёмник…', 'scheme')}
<p class="muted">Ваша машина — Passat B5, кузов 3B, 2000 модельный год, мотор ARG. Полные заводские схемы — в erWin (платный доступ на сайте Volkswagen).</p>

<h2>Схемы и распиновки по компонентам <span class="muted" style="font-weight:400">· ${diagrams.length}</span></h2>
<p class="muted">Оригинальные фото схем и компонентов из открытых источников, номера деталей и распиновка текстом. Источники — на странице каждой схемы; всё «не проверено».</p>
${diagrams.length ? h`<div class="cards">${diagrams.map((d) => h`<a class="card diag-card" href="/diagrams/${d.id}">
${previews(d)}
<span class="t">${d.title}</span>
${images(d.part_numbers).length ? h`<span class="pn mono">${images(d.part_numbers).slice(0, 3).map((p, i) => h`${i ? ' · ' : ''}${p.number}${p.brand && p.brand !== 'VAG' ? ` (${p.brand})` : ''}`)}</span>` : ''}
<span class="s">${TYPE_LABEL[d.type]}${d.system_name ? ` · ${d.system_name}` : ''}${d.applies_to ? ` · ${d.applies_to}` : ''}</span></a>`)}</div>` : emptyState('Схемы готовятся.')}

<h2>Из открытых источников <span class="muted" style="font-weight:400">· ${rows.length}, с картинками ${withImages}</span></h2>
${rows.length ? groupBySystem(rows).map(([name, list]) => h`<h3 class="grp">${name}</h3><ul class="list">${list.map((s) => h`<li id="s${s.id}"><div class="item">
<a class="t" href="${s.url}" target="_blank" rel="noopener noreferrer">${s.title} ${icon('external')}</a>
${s.description ? h`<span class="snip">${s.description}</span>` : ''}
<span class="s">${SCHEME_KIND_LABEL[s.kind] ?? s.kind} · ${SOURCE_LABEL[s.source_type] ?? s.source_type}${s.applies_to ? ` · ${s.applies_to}` : ''}</span>
${gallery(images(s.images), s.url)}
</div></li>`)}</ul>`) : emptyState('Ссылок на схемы пока нет.')}`,
    }));
  });

  app.get('/diagrams/:id', async (req, reply) => {
    const db = getDb();
    const d = db.prepare('SELECT d.*, s.name AS system_name FROM diagrams d LEFT JOIN systems s ON s.id = d.system_id WHERE d.id = ?').get(Number(req.params.id));
    if (!d) return reply.callNotFound();
    const data = JSON.parse(d.data);
    const sources = db.prepare("SELECT * FROM sources WHERE owner_kind = 'diagram' AND owner_id = ? ORDER BY id").all(d.id);
    const table = d.type === 'pinout'
      ? h`<div class="table-wrap"><table><thead><tr><th>Контакт</th><th>Назначение</th><th>Провод</th><th>Куда идёт</th></tr></thead><tbody>
${(data.pins ?? []).map((p) => h`<tr><td class="num"><b>${p.pin}</b></td><td>${p.signal}</td><td>${wireColors(p.wire).map((c) => h`<span class="swatch" style="background:${c}"></span>`)} ${p.wire || '—'}</td><td>${p.to || '—'}</td></tr>`)}
</tbody></table></div>`
      : h`${(data.paths ?? []).map((path) => h`<h3>${path.label || 'Цепь'}</h3><ol class="plain">${(path.nodes ?? []).map((n) => h`<li><b>${n.name}</b>${n.pin ? ` (конт. ${n.pin})` : ''}${n.wire ? h` <span class="muted">— провод ${n.wire}</span>` : ''}</li>`)}</ol>`)}`;
    return reply.html(page({
      title: d.title,
      active: 'menu',
      body: h`${backLink('/schemes', 'Электросхемы')}${pageTitle(d.title)}
<p>${statusBadge(d.status)} <span class="muted">${TYPE_LABEL[d.type]}${d.system_name ? ` · ${d.system_name}` : ''}${d.applies_to ? ` · относится к: ${d.applies_to}` : ''}</span></p>
${data.location ? h`<p><b>Где находится:</b> ${data.location}</p>` : ''}
${images(d.images).length ? h`<h2>Схема (оригинальные фото)</h2>${gallery(images(d.images), '')}` : h`<p class="muted">Оригинальное фото схемы пока не найдено.</p>`}
${images(d.photo).length ? h`<h2>Как выглядит</h2>${gallery(images(d.photo), '')}` : ''}
${images(d.part_numbers).length ? h`<h2>Номера деталей</h2><div class="table-wrap"><table><thead><tr><th>Номер</th><th>Производитель</th><th>К чему подходит</th><th></th></tr></thead><tbody>
${images(d.part_numbers).map((p) => h`<tr><td class="mono"><b>${p.number}</b></td><td>${p.brand || 'VAG'}</td><td>${p.note || '—'}</td><td><a href="${p.source_url}" target="_blank" rel="noopener noreferrer">источник</a></td></tr>`)}
</tbody></table></div>` : ''}
<h2>${d.type === 'pinout' ? 'Распиновка' : 'Цепь'} по данным источников</h2>
${table}
${d.notes ? h`<p class="pre">${d.notes}</p>` : ''}
${sourcesBlock(sources)}`,
    }));
  });
}
