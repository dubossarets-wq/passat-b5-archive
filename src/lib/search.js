// Разделы справочника для поиска и сборка поискового индекса (сам поиск — public/js/searchcore.js).
import { normPart } from '../../public/js/stem.js';
import { indexStems } from '../../public/js/searchcore.js';

export const KINDS = {
  code: { label: 'Коды ошибок', table: 'dtc_codes', url: (id) => `/codes/${id}` },
  article: { label: 'Статьи', table: 'articles', url: (id) => `/kb/${id}` },
  scheme: { label: 'Электросхемы', table: 'schemes', url: (id) => `/schemes#s${id}` },
  part: { label: 'Запчасти', table: 'parts', url: (id) => `/parts/${id}` },
  maintenance: { label: 'Регламент ТО', table: 'maintenance_items', url: (id) => `/maintenance/${id}` },
  link: { label: 'Ссылки', table: 'links', url: () => '/links' },
};

export const SCHEME_KIND_LABEL = {
  diagram: 'схема', pinout: 'распиновка', fuses: 'предохранители и реле', location: 'где расположено', guide: 'проверка цепи', official: 'официальный источник',
};

export function jsonList(s) {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function systemName(db, id) {
  if (!id) return '';
  return db.prepare('SELECT name FROM systems WHERE id = ?').get(id)?.name ?? '';
}

// Markdown -> простой текст для фрагментов результатов.
const plain = (md) => String(md ?? '')
  .replace(/\{\{spec:[a-z0-9_]+\}\}/g, 'уточнить по официальной документации')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/[#>*_`|]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// Заголовок и текст документа для поиска.
export function buildDoc(db, kind, id) {
  const row = db.prepare(`SELECT * FROM ${KINDS[kind].table} WHERE id = ?`).get(id);
  if (!row) return null;
  const sys = systemName(db, row.system_id);
  if (kind === 'code') {
    return {
      title: `${row.code}${row.vag ? ` / ${row.vag}` : ''} ${row.title}`,
      body: [row.code, row.vag, row.description, ...jsonList(row.causes), ...jsonList(row.checks), sys].filter(Boolean).map(plain).join('\n'),
    };
  }
  if (kind === 'article') return { title: row.title, body: [plain(row.body_md), sys, row.applies_to].filter(Boolean).join('\n') };
  if (kind === 'scheme') {
    return { title: row.title, body: [row.description, SCHEME_KIND_LABEL[row.kind], 'электросхема', sys, row.applies_to].filter(Boolean).join('\n') };
  }
  if (kind === 'part') {
    const analogs = db.prepare('SELECT brand, number FROM part_analogs WHERE part_id = ?').all(id)
      .map((a) => `${a.brand} ${a.number} ${normPart(a.number)}`);
    return { title: `${row.oem} ${row.name}`, body: [row.oem, normPart(row.oem), row.notes, sys, ...analogs].filter(Boolean).join('\n') };
  }
  if (kind === 'maintenance') return { title: row.name, body: [row.note, sys, 'регламент замена интервал'].filter(Boolean).join('\n') };
  if (kind === 'link') return { title: row.title, body: [row.description, row.applies_to, row.url].filter(Boolean).join('\n') };
  return null;
}

/** Поисковый индекс всего справочника (массив документов, формат — см. public/js/searchcore.js). */
export function buildSearchIndex(db) {
  const docs = [];
  for (const [kind, k] of Object.entries(KINDS)) {
    for (const { id } of db.prepare(`SELECT id FROM ${k.table} ORDER BY id`).all()) {
      const d = buildDoc(db, kind, id);
      if (!d) continue;
      docs.push({ k: kind, u: k.url(id), t: d.title, x: d.body.slice(0, 4000), ts: indexStems(d.title), s: indexStems(`${d.title}\n${d.body}`) });
    }
  }
  return docs;
}
