// Критичные цифры (моменты затяжки, объёмы, допуски, установка ГРМ) в справочнике не приводятся.
// В текстах на их месте стоит метка {{spec:ключ}} — она показывается как «уточнить по официальной документации».
import { esc, raw } from './html.js';

export const SPEC_MISSING = 'уточнить по официальной документации';
const TOKEN = /\{\{spec:([a-z0-9_]+)\}\}/g;
const SPEC_HTML = `<span class="spec-missing">${SPEC_MISSING}</span>`;

// Обычный текст с метками -> безопасный HTML.
export function textWithSpecs(text) {
  const src = String(text ?? '');
  let out = '';
  let pos = 0;
  for (const m of src.matchAll(TOKEN)) {
    out += esc(src.slice(pos, m.index)) + SPEC_HTML;
    pos = m.index + m[0].length;
  }
  return raw(out + esc(src.slice(pos)));
}

// Для Markdown: метки заменяются до рендера и разворачиваются после.
export const protectSpecs = (md) => String(md ?? '').replace(TOKEN, '§§SPEC§§');
export const expandSpecs = (html) => html.replace(/§§SPEC§§/g, SPEC_HTML);
