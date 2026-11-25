// Общие функции для обработчиков страниц.
import { config } from '../config.js';
import { receiveUpload, discardUpload } from './files.js';

export const flash = (req) => (typeof req.query?.m === 'string' ? req.query.m.slice(0, 300) : '');

export function go(reply, url, message = '') {
  if (message) url += `${url.includes('?') ? '&' : '?'}m=${encodeURIComponent(message)}`;
  return reply.redirect(url);
}

// Возврат только на внутренние адреса.
export function safeBack(value, fallback = '/') {
  const s = String(value ?? '');
  return /^\/(?![/\\])/.test(s) ? s : fallback;
}

export const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/**
 * Читает форму: обычную (urlencoded) или с файлами (multipart).
 * Файлы сразу принимаются во временную папку; их надо либо commitUpload, либо discardForm.
 * @returns {{fields: object, files: {field:string, rec:object}[]}}
 */
export async function readForm(req, { maxBytes = config.maxUploadBytes } = {}) {
  if (!req.isMultipart || !req.isMultipart()) return { fields: req.body ?? {}, files: [] };
  const fields = {};
  const files = [];
  try {
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        if (!part.filename) {
          part.file.resume();
          continue;
        }
        const rec = await receiveUpload(part.file, { origName: part.filename, mime: part.mimetype, maxBytes });
        if (rec) files.push({ field: part.fieldname, rec });
      } else if (fields[part.fieldname] === undefined) {
        fields[part.fieldname] = part.value;
      } else {
        fields[part.fieldname] = [...arr(fields[part.fieldname]), part.value];
      }
    }
  } catch (e) {
    files.forEach((f) => discardUpload(f.rec));
    throw e;
  }
  return { fields, files };
}

export function discardForm(form) {
  form.files.forEach((f) => discardUpload(f.rec));
}

export const filesOfField = (form, ...names) => form.files.filter((f) => names.includes(f.field));
