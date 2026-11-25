// Хранение загруженных файлов: оригиналы в data/files, превью в data/thumbs, текст PDF — в базе.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { paths } from '../config.js';
import { lastId } from '../db.js';
import { extractPdfText } from './pdftext.js';
import { indexOne } from './search.js';

const MIME_BY_EXT = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.heic': 'image/heic', '.heif': 'image/heif',
  '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv',
};
const INLINE_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const TEXT_MIME = new Set(['text/plain', 'text/markdown', 'text/csv']);

export const isInlineMime = (m) => INLINE_MIME.has(m);
export const isImage = (m) => /^image\//.test(m);

const inflight = new Set();
// Дождаться окончания фоновой обработки (превью, текст PDF) — нужно тестам и импорту.
export async function whenIdle() {
  while (inflight.size) await Promise.allSettled([...inflight]);
}

export function absFile(rel) {
  const full = path.resolve(paths.files(), rel);
  if (!full.startsWith(path.resolve(paths.files()) + path.sep)) throw new Error('Недопустимый путь файла');
  return full;
}

export const absThumb = (id) => path.join(paths.thumbs(), `${id}.jpg`);

function safeExt(origName, mime) {
  const ext = path.extname(origName || '').toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(ext)) return ext;
  const found = Object.entries(MIME_BY_EXT).find(([, m]) => m === mime);
  return found ? found[0] : '.bin';
}

function guessMime(origName, clientMime) {
  const ext = path.extname(origName || '').toLowerCase();
  return MIME_BY_EXT[ext] ?? (clientMime && clientMime !== 'application/octet-stream' ? clientMime : 'application/octet-stream');
}

/**
 * Шаг 1: принять поток во временный файл (считаем размер и SHA-256).
 * Возвращает null, если файл пустой.
 */
export async function receiveUpload(stream, { origName, mime, maxBytes }) {
  const incomingDir = path.join(paths.files(), '.incoming');
  fs.mkdirSync(incomingDir, { recursive: true });
  const tmp = path.join(incomingDir, crypto.randomBytes(8).toString('hex'));
  const hash = crypto.createHash('sha256');
  let size = 0;
  const meter = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      if (maxBytes && size > maxBytes) return cb(new Error('Файл слишком большой'));
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  try {
    await pipeline(stream, meter, fs.createWriteStream(tmp));
    if (stream.truncated) throw new Error('Файл слишком большой');
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  if (size === 0) {
    fs.rmSync(tmp, { force: true });
    return null;
  }
  return { tmp, size, sha256: hash.digest('hex'), origName, mime };
}

export function discardUpload(rec) {
  if (rec?.tmp) fs.rmSync(rec.tmp, { force: true });
}

/**
 * Шаг 2: переложить принятый файл на место и создать запись в таблице files.
 * Обработка (превью, текст PDF) идёт в фоне.
 */
export function commitUpload(db, rec, { ownerKind, ownerId, kind = null }) {
  const { tmp, size, origName } = rec;
  const realMime = guessMime(origName, rec.mime);
  const now = new Date();
  const sub = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
  const rel = `${sub}/${crypto.randomBytes(10).toString('hex')}${safeExt(origName, realMime)}`;
  const dest = absFile(rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(tmp, dest);

  const res = db.prepare(
    `INSERT INTO files (owner_kind, owner_id, rel_path, orig_name, mime, size, sha256, kind, text_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(ownerKind, ownerId, rel, (origName || 'файл').slice(0, 200), realMime, size, rec.sha256, kind,
    realMime === 'application/pdf' || TEXT_MIME.has(realMime) ? 'pending' : 'none');
  const id = lastId(res);
  processFile(db, id);
  return db.prepare('SELECT * FROM files WHERE id = ?').get(id);
}

// Принять и сразу сохранить (удобно в тестах и скриптах).
export async function storeUpload(db, stream, opts) {
  const rec = await receiveUpload(stream, opts);
  if (!rec) return null;
  return commitUpload(db, rec, opts);
}

export function processFile(db, id) {
  const p = (async () => {
    const f = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
    if (!f) return;
    const file = absFile(f.rel_path);
    if (isImage(f.mime)) await makeThumb(db, f);
    if (f.mime === 'application/pdf') {
      let text = '';
      let status = 'done';
      try {
        text = await extractPdfText(file);
        if (!text) status = 'empty';
      } catch {
        status = 'failed';
      }
      db.prepare('UPDATE files SET text_content = ?, text_status = ? WHERE id = ?').run(text, status, id);
    } else if (TEXT_MIME.has(f.mime)) {
      const text = fs.readFileSync(file, 'utf8').slice(0, 1_000_000);
      db.prepare('UPDATE files SET text_content = ?, text_status = ? WHERE id = ?').run(text, 'done', id);
    }
    reindexOwner(db, f.owner_kind, f.owner_id);
  })().catch((e) => console.error('Обработка файла', id, 'не удалась:', e.message))
    .finally(() => inflight.delete(p));
  inflight.add(p);
  return p;
}

export async function makeThumb(db, f) {
  const { default: sharp } = await import('sharp');
  fs.mkdirSync(paths.thumbs(), { recursive: true });
  const out = absThumb(f.id);
  try {
    await sharp(absFile(f.rel_path), { failOn: 'none' })
      .rotate()
      .resize(480, 480, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toFile(out);
    db.prepare('UPDATE files SET thumb_path = ? WHERE id = ?').run(`${f.id}.jpg`, f.id);
    return out;
  } catch {
    return null;
  }
}

export function reindexOwner(db, ownerKind, ownerId) {
  if (['record', 'document', 'part'].includes(ownerKind)) indexOne(db, ownerKind, ownerId);
}

export function deleteFile(db, id) {
  const f = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
  if (!f) return;
  db.prepare('DELETE FROM files WHERE id = ?').run(id);
  fs.rmSync(absFile(f.rel_path), { force: true });
  fs.rmSync(absThumb(id), { force: true });
  reindexOwner(db, f.owner_kind, f.owner_id);
}

export function deleteOwnerFiles(db, ownerKind, ownerId) {
  for (const f of db.prepare('SELECT id FROM files WHERE owner_kind = ? AND owner_id = ?').all(ownerKind, ownerId)) {
    deleteFile(db, f.id);
  }
}

export function filesOf(db, ownerKind, ownerId) {
  return db.prepare('SELECT * FROM files WHERE owner_kind = ? AND owner_id = ? ORDER BY id').all(ownerKind, ownerId);
}
