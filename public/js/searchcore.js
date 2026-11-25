// Ядро поиска по справочнику. Работает и в браузере (страница поиска), и в Node (сборка индекса, тесты).
// Индекс — массив документов: { k: раздел, u: адрес, t: заголовок, x: текст для фрагмента, ts: основы заголовка, s: основы текста }.
import { tokenize, stemVariants, normPart } from './stem.js';

export function esc(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Основы слов для индекса: все варианты основ, без повторов; плюс «слитные» номера деталей.
export function indexStems(text) {
  const out = new Set();
  for (const tok of tokenize(text)) for (const s of stemVariants(tok)) out.add(s);
  return [...out];
}

export function parseQuery(q) {
  const groups = tokenize(q).map((t) => [...new Set(stemVariants(t))]);
  const norm = normPart(q).toLowerCase();
  return { groups, norm: /\d/.test(norm) && norm.length >= 5 ? norm : '' };
}

const hasPrefix = (stems, variants) => stems.some((s) => variants.some((v) => s.startsWith(v)));

/** Оценка документа: 0 — не подходит. Все слова запроса должны найтись (в заголовке или тексте). */
export function scoreDoc(doc, query) {
  if (!query.groups.length) return 0;
  let score = 0;
  let all = true;
  for (const g of query.groups) {
    const inTitle = hasPrefix(doc.ts, g);
    const inBody = inTitle || hasPrefix(doc.s, g);
    if (!inBody) { all = false; break; }
    score += inTitle ? 10 : 1;
  }
  if (all) return score;
  // Номер детали, набранный с пробелами или дефисами: «06A 115 561 B».
  if (query.norm && doc.s.some((s) => s.startsWith(query.norm))) return 5;
  return 0;
}

export function runSearch(index, q, { kind = '', limit = 150 } = {}) {
  const query = parseQuery(q);
  const hits = [];
  for (const doc of index) {
    if (kind && doc.k !== kind) continue;
    const sc = scoreDoc(doc, query);
    if (sc > 0) hits.push({ doc, sc });
  }
  hits.sort((a, b) => b.sc - a.sc || a.doc.t.localeCompare(b.doc.t, 'ru'));
  return hits.slice(0, limit).map((h) => h.doc);
}

/** Фрагмент текста вокруг первого найденного слова; найденные слова — в <mark>. Возвращает безопасный HTML. */
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
  return `${from > 0 ? '…' : ''}${out.replace(/\s+/g, ' ')}${to < src.length ? '…' : ''}`;
}
