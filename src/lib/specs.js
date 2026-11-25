// Критичные параметры (моменты затяжки, объёмы, допуски, ГРМ). Значение показывается только
// если у него есть официальный источник; иначе — «уточнить по официальной документации».
import { esc, raw } from './html.js';

export const SPEC_MISSING = 'уточнить по официальной документации';
const TOKEN = /\{\{spec:([a-z0-9_]+)\}\}/g;

export function loadSpecMap(db) {
  const map = new Map();
  for (const s of db.prepare('SELECT * FROM specs').all()) map.set(s.key, s);
  return map;
}

export const specHasSource = (s) => Boolean(s && (s.source_url || s.source_document_id));
export const specIsFilled = (s) => Boolean(s && s.value && specHasSource(s));

export function specHtml(key, map) {
  const s = map.get(key);
  if (!specIsFilled(s)) {
    return `<a class="spec spec-missing" href="/specs#${esc(key)}">${SPEC_MISSING}</a>`;
  }
  const unit = s.unit ? ` ${esc(s.unit)}` : '';
  const flag = s.status === 'verified' ? '' : ' <small>(не проверено)</small>';
  return `<a class="spec spec-ok" href="/specs#${esc(key)}"><b>${esc(s.value)}${unit}</b>${flag}</a>`;
}

// Обычный текст с токенами {{spec:...}} -> безопасный HTML.
export function textWithSpecs(text, map) {
  const src = String(text ?? '');
  let out = '';
  let pos = 0;
  for (const m of src.matchAll(TOKEN)) {
    out += esc(src.slice(pos, m.index)) + specHtml(m[1], map);
    pos = m.index + m[0].length;
  }
  out += esc(src.slice(pos));
  return raw(out);
}

// Для Markdown: токены заменяются на безопасные метки до рендера и разворачиваются после.
export function protectSpecs(md) {
  return String(md ?? '').replace(TOKEN, (_m, key) => `§§SPEC:${key}§§`);
}

export function expandSpecs(html, map) {
  return html.replace(/§§SPEC:([a-z0-9_]+)§§/g, (_m, key) => specHtml(key, map));
}

export function findSpecKeys(text) {
  return [...String(text ?? '').matchAll(TOKEN)].map((m) => m[1]);
}
