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
// Схема — только картинка, размеченная как схема; всё остальное считается фото.
const schemePics = (json) => images(json).filter((im) => im.kind === 'scheme');
const photoPics = (json) => images(json).filter((im) => im.kind !== 'scheme');

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
  const photo = images(d.photo)[0] ?? photoPics(d.images)[0];
  const schemePic = schemePics(d.images)[0];
  const box = (pic, tag, emptyText) => h`<span class="pv-box">${pic
    ? h`<img src="${pic.src}" alt="${pic.caption || tag}" loading="lazy" referrerpolicy="no-referrer">`
    : h`<span class="pv-empty">${icon(tag === 'фото' ? 'parts' : 'schemes', { size: '1.6em' })}<small>${emptyText}</small></span>`}<span class="pv-tag">${tag}</span></span>`;
  return h`<span class="pv">${box(photo, 'фото', 'фото ищется')}${box(schemePic, 'схема', 'схема ищется')}</span>`;
}

// Заводские параметры (только из официальных источников) и как проверить — коротко.
function specsBlock(comps) {
  const withSpecs = comps.filter((c) => c.specs);
  const withChecks = comps.filter((c) => c.checks);
  return h`<h2>Заводские параметры</h2>
${withSpecs.length ? withSpecs.map((c) => h`<div class="table-wrap"><table><thead><tr><th colspan="2">${c.component}${c.part_number ? h` · <span class="mono">${c.part_number}</span>` : ''}</th></tr></thead><tbody>
${images(c.specs).map((s) => h`<tr><td>${s.param}${s.condition ? h` <span class="muted">(${s.condition})</span>` : ''}</td><td class="num"><b>${s.value}${s.unit ? ` ${s.unit}` : ''}</b></td></tr>`)}
</tbody></table></div><p class="note">Источник: <a href="${c.source_url}" target="_blank" rel="noopener noreferrer">${c.source_title || c.source_owner || 'официальный документ'}</a> · не проверено</p>`)
    : h`<p class="spec-missing">Уточнить по официальной документации (erWin): в открытых официальных источниках параметры не найдены.</p>`}
${withChecks.length ? h`<h2>Как проверить</h2>${withChecks.map((c) => h`<ol class="plain">${images(c.checks).map((x) => h`<li>${x}</li>`)}</ol>${c.check_source_url ? h`<p class="note"><a href="${c.check_source_url}" target="_blank" rel="noopener noreferrer">откуда методика</a></p>` : ''}`)}` : ''}`;
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
    const looseChecks = db.prepare('SELECT * FROM component_specs WHERE diagram_slug IS NULL AND checks IS NOT NULL ORDER BY component').all();
    // Галерея: только картинки, размеченные как схемы.
    const host = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return ''; } };
    const tiles = [
      ...diagrams.flatMap((d) => schemePics(d.images).map((im) => ({ im, title: d.title, href: `/diagrams/${d.id}`, src: im.source_url || '' }))),
      ...rows.flatMap((r) => schemePics(r.images).map((im) => ({ im, title: r.title, href: r.url, src: r.url, ext: true }))),
    ].filter((t, i, all) => all.findIndex((x) => x.im.src === t.im.src) === i);
    return reply.html(page({
      title: 'Электросхемы',
      active: 'menu',
      body: h`${pageTitle('Электросхемы')}
${searchBox('/search', '', 'Фары, ЭБУ, предохранители, стеклоподъёмник…', 'scheme')}
<p class="muted">Passat B5 3B, 2000, ARG. Полные заводские схемы — erWin (платно).</p>

<h2>Схемы <span class="muted" style="font-weight:400">· ${tiles.length}</span></h2>
${tiles.length ? h`<div class="gallery">${tiles.map((t) => h`<a class="g-tile" href="${t.href}"${t.ext ? h` target="_blank" rel="noopener noreferrer"` : ''}>
<span class="g-img"><img src="${t.im.src}" alt="${t.im.caption || t.title}" loading="lazy" referrerpolicy="no-referrer"></span>
<span class="g-t">${t.im.caption || t.title}</span><span class="g-s">${host(t.src || t.im.src)}</span></a>`)}</div>` : emptyState('Схемы разбираются — скоро появятся.')}

<h2>По компонентам <span class="muted" style="font-weight:400">· ${diagrams.length}</span></h2>
${diagrams.length ? h`<div class="cards">${diagrams.map((d) => h`<a class="card diag-card" href="/diagrams/${d.id}">
${previews(d)}
<span class="t">${d.title}</span>
${images(d.part_numbers).length ? h`<span class="pn mono">${images(d.part_numbers).slice(0, 3).map((p, i) => h`${i ? ' · ' : ''}${p.number}${p.brand && p.brand !== 'VAG' ? ` (${p.brand})` : ''}`)}</span>` : ''}
<span class="s">${TYPE_LABEL[d.type]}${d.system_name ? ` · ${d.system_name}` : ''}${d.applies_to ? ` · ${d.applies_to}` : ''}</span></a>`)}</div>` : emptyState('Схемы готовятся.')}

${looseChecks.length ? h`<h2 id="checks">Проверка датчиков</h2>
${looseChecks.map((c) => h`<details class="check"><summary>${c.component}${c.part_number ? h` <span class="muted mono">${c.part_number}</span>` : ''}</summary>
<ol class="plain">${images(c.checks).map((x) => h`<li>${x}</li>`)}</ol>
<p class="note">Заводские значения: уточнить по официальной документации (erWin).${c.check_source_url ? h` <a href="${c.check_source_url}" target="_blank" rel="noopener noreferrer">Откуда методика</a>` : ''}</p></details>`)}` : ''}

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
    const comps = db.prepare('SELECT * FROM component_specs WHERE diagram_slug = ? ORDER BY id').all(d.slug);
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
${schemePics(d.images).length ? h`<h2>Схема</h2>${gallery(schemePics(d.images), '')}` : h`<p class="muted">Картинка схемы из открытых источников пока не найдена.</p>`}
${[...images(d.photo), ...photoPics(d.images)].length ? h`<h2>Фото</h2>${gallery([...images(d.photo), ...photoPics(d.images)], '')}` : ''}
${images(d.part_numbers).length ? h`<h2>Номера деталей</h2><div class="table-wrap"><table><thead><tr><th>Номер</th><th>Производитель</th><th>К чему подходит</th><th></th></tr></thead><tbody>
${images(d.part_numbers).map((p) => h`<tr><td class="mono"><b>${p.number}</b></td><td>${p.brand || 'VAG'}</td><td>${p.note || '—'}</td><td><a href="${p.source_url}" target="_blank" rel="noopener noreferrer">источник</a></td></tr>`)}
</tbody></table></div>` : ''}
${specsBlock(comps)}
<h2>${d.type === 'pinout' ? 'Распиновка' : 'Цепь'} по данным источников</h2>
${table}
${d.notes ? h`<p class="pre">${d.notes}</p>` : ''}
${sourcesBlock(sources)}`,
    }));
  });
}
