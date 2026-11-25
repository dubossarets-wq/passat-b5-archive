// Общий поиск по журналу, документам, статьям, кодам и запчастям (SQLite FTS5 + русский стеммер).
import { tokenize, indexText, normPart, stemVariants } from './stem.js';
import { esc, raw } from './html.js';

export const KINDS = {
  record: { label: 'Журнал', base: 1_000_000_000, url: (id) => `/journal/${id}` },
  document: { label: 'Документы', base: 2_000_000_000, url: (id) => `/docs/${id}` },
  article: { label: 'Статьи', base: 3_000_000_000, url: (id) => `/kb/${id}` },
  code: { label: 'Коды ошибок', base: 4_000_000_000, url: (id) => `/codes/${id}` },
  part: { label: 'Запчасти', base: 5_000_000_000, url: (id) => `/parts/${id}` },
};

const MAX_TEXT = 2_000_000;

export function jsonList(s) {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

const DOC_TYPES = {
  manual: 'руководство', scheme: 'схема', receipt: 'чек', act: 'акт', photo: 'фото', registration: 'документы на машину', other: 'другое',
};
export const docTypeLabel = (t) => DOC_TYPES[t] ?? t;
export const DOC_TYPE_OPTIONS = Object.entries(DOC_TYPES);

function systemName(db, id) {
  if (!id) return '';
  return db.prepare('SELECT name FROM systems WHERE id = ?').get(id)?.name ?? '';
}

function filesText(db, kind, id) {
  return db.prepare('SELECT text_content FROM files WHERE owner_kind = ? AND owner_id = ?').all(kind, id)
    .map((f) => f.text_content ?? '').join('\n').slice(0, MAX_TEXT);
}

// Собирает заголовок и текст для индекса из строки базы.
export function buildDoc(db, kind, id) {
  if (kind === 'record') {
    const r = db.prepare('SELECT * FROM records WHERE id = ?').get(id);
    if (!r) return null;
    const parts = db.prepare('SELECT name, brand, number FROM record_parts WHERE record_id = ?').all(id)
      .map((p) => [p.name, p.brand, p.number, normPart(p.number)].filter(Boolean).join(' '));
    const items = db.prepare(
      'SELECT m.name FROM record_items ri JOIN maintenance_items m ON m.id = ri.maintenance_item_id WHERE ri.record_id = ?',
    ).all(id).map((x) => x.name);
    return {
      title: r.title,
      body: [r.description, systemName(db, r.system_id), r.performed_by, ...parts, ...items, filesText(db, 'record', id)].filter(Boolean).join('\n'),
    };
  }
  if (kind === 'document') {
    const d = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
    if (!d) return null;
    return {
      title: d.title,
      body: [d.tags, docTypeLabel(d.doc_type), systemName(db, d.system_id), d.source_note, d.applies_to, filesText(db, 'document', id)].filter(Boolean).join('\n'),
    };
  }
  if (kind === 'article') {
    const a = db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
    if (!a) return null;
    return { title: a.title, body: [a.body_md, systemName(db, a.system_id), a.applies_to].filter(Boolean).join('\n') };
  }
  if (kind === 'code') {
    const c = db.prepare('SELECT * FROM dtc_codes WHERE id = ?').get(id);
    if (!c) return null;
    return {
      title: `${c.code}${c.vag ? ` / ${c.vag}` : ''} ${c.title}`,
      body: [c.code, c.vag, c.description, ...jsonList(c.causes), ...jsonList(c.checks), systemName(db, c.system_id)].filter(Boolean).join('\n'),
    };
  }
  if (kind === 'part') {
    const p = db.prepare('SELECT * FROM parts WHERE id = ?').get(id);
    if (!p) return null;
    const analogs = db.prepare('SELECT brand, number FROM part_analogs WHERE part_id = ?').all(id)
      .map((a) => `${a.brand} ${a.number} ${normPart(a.number)}`);
    return {
      title: `${p.oem} ${p.name}`,
      body: [p.oem, normPart(p.oem), p.notes, systemName(db, p.system_id), ...analogs].filter(Boolean).join('\n'),
    };
  }
  return null;
}

export function removeIndex(db, kind, id) {
  db.prepare('DELETE FROM search_fts WHERE rowid = ?').run(KINDS[kind].base + id);
}

export function indexOne(db, kind, id) {
  removeIndex(db, kind, id);
  const doc = buildDoc(db, kind, id);
  if (!doc) return;
  db.prepare(
    'INSERT INTO search_fts (rowid, kind, ref_id, title, body, title_s, body_s) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(KINDS[kind].base + id, kind, id, doc.title, doc.body, indexText(doc.title), indexText(doc.body));
}

const TABLE = { record: 'records', document: 'documents', article: 'articles', code: 'dtc_codes', part: 'parts' };

export function reindexAll(db) {
  db.exec('DELETE FROM search_fts');
  for (const kind of Object.keys(KINDS)) {
    for (const row of db.prepare(`SELECT id FROM ${TABLE[kind]}`).all()) indexOne(db, kind, row.id);
  }
}

export function ftsQuery(q) {
  const toks = tokenize(q);
  if (toks.length === 0) return null;
  const quote = (s) => `"${s.replace(/"/g, '""')}"`;
  let query = toks
    .map((t) => {
      const v = [...new Set(stemVariants(t))].map((s) => `${quote(s)}*`);
      return v.length > 1 ? `(${v.join(' OR ')})` : v[0];
    })
    .join(' AND ');
  // Номера деталей пишут по-разному: «06A 115 561 B», «06A-115-561-B», «06A115561B».
  const n = normPart(q).toLowerCase();
  if (/\d/.test(n) && n.length >= 5) query = `(${query}) OR ${quote(n)}*`;
  return query;
}

// Фрагмент текста вокруг первого найденного слова, найденные слова — в <mark>.
export function highlight(text, q, maxLen = 180) {
  const stems = tokenize(q).flatMap(stemVariants);
  const src = String(text ?? '');
  const norm = normPart(q).toLowerCase();
  const matches = [];
  const re = /[\p{L}\p{N}]+/gu;
  let m;
  while ((m = re.exec(src))) {
    const own = stemVariants(m[0]);
    if (own.some((s) => stems.some((x) => s.startsWith(x))) || (norm.length >= 5 && own[0].startsWith(norm))) {
      matches.push([m.index, m.index + m[0].length]);
    }
  }
  let from = 0;
  let to = Math.min(src.length, maxLen);
  if (matches.length) {
    from = Math.max(0, matches[0][0] - 60);
    to = Math.min(src.length, from + maxLen);
  }
  let out = '';
  let pos = from;
  for (const [a, b] of matches) {
    if (b <= from || a >= to) continue;
    out += esc(src.slice(pos, Math.max(a, pos))) + `<mark>${esc(src.slice(Math.max(a, pos), Math.min(b, to)))}</mark>`;
    pos = Math.min(b, to);
  }
  out += esc(src.slice(pos, to));
  return raw(`${from > 0 ? '…' : ''}${out.replace(/\s+/g, ' ')}${to < src.length ? '…' : ''}`);
}

export function search(db, q, { kinds = Object.keys(KINDS), limit = 120 } = {}) {
  const query = ftsQuery(q);
  if (!query) return [];
  const rows = db.prepare(
    `SELECT kind, ref_id, title, body FROM search_fts WHERE search_fts MATCH ?
     ORDER BY bm25(search_fts, 0, 0, 0, 0, 10.0, 1.0) LIMIT ?`,
  ).all(query, limit);
  return rows
    .filter((r) => kinds.includes(r.kind))
    .map((r) => ({
      kind: r.kind,
      id: Number(r.ref_id),
      title: r.title,
      titleHtml: highlight(r.title, q, 200),
      snippet: highlight(r.body, q),
      url: KINDS[r.kind].url(Number(r.ref_id)),
    }));
}
