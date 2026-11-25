// Экспорт всего архива в один ZIP (база + файлы) и восстановление из него.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync } from 'node:sqlite';
import yauzl from 'yauzl';
import { ZipArchive } from 'archiver';
import { paths, config } from '../config.js';
import { openDb, closeDb } from '../db.js';
import { MIGRATIONS } from '../schema.js';
import { reindexAll } from './search.js';

export const APP_ID = 'passat-b5-archive';
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');

const sqlQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

// Снимок базы в отдельный файл (без сессий входа).
export function snapshotDb(db, destFile) {
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  fs.rmSync(destFile, { force: true });
  db.exec(`VACUUM INTO ${sqlQuote(destFile)}`);
  const snap = new DatabaseSync(destFile);
  try {
    snap.exec('DELETE FROM sessions');
  } finally {
    snap.close();
  }
}

/** Пишет ZIP со всем архивом в файл outFile. Возвращает сводку. */
export async function exportArchive(db, outFile) {
  fs.mkdirSync(paths.tmp(), { recursive: true });
  const work = fs.mkdtempSync(path.join(paths.tmp(), 'export-'));
  try {
    const snapFile = path.join(work, 'archive.db');
    snapshotDb(db, snapFile);
    const dbHash = await sha256File(snapFile);
    const dbSize = fs.statSync(snapFile).size;

    const rows = db.prepare('SELECT rel_path, size, sha256 FROM files').all();
    const missing = [];
    const entries = [];
    for (const r of rows) {
      const abs = path.join(paths.files(), r.rel_path);
      if (!fs.existsSync(abs)) {
        missing.push(r.rel_path);
        continue;
      }
      entries.push({ path: `files/${r.rel_path}`, abs, size: r.size, sha256: r.sha256 });
    }

    const manifest = {
      app: APP_ID,
      format: 1,
      createdAt: new Date().toISOString(),
      schemaVersion: MIGRATIONS.length,
      db: { path: 'archive.db', size: dbSize, sha256: dbHash },
      files: entries.map((e) => ({ path: e.path, size: e.size, sha256: e.sha256 })),
      missing,
    };

    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    const output = fs.createWriteStream(outFile);
    const zip = new ZipArchive({ zlib: { level: 1 } });
    const done = pipeline(zip, output);
    zip.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    zip.file(snapFile, { name: 'archive.db' });
    for (const e of entries) zip.file(e.abs, { name: e.path, store: true });
    await zip.finalize();
    await done;
    return { files: entries.length, missing, bytes: fs.statSync(outFile).size, manifest };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// ---------- восстановление ----------

function openZip(file) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (err, z) => (err ? reject(err) : resolve(z)));
  });
}

// Допустимые имена внутри архива: manifest.json, archive.db, files/<относительный путь>.
export function safeEntryName(name) {
  if (name.endsWith('/')) return null; // каталог
  if (name.includes('\\') || name.includes('\0') || name.startsWith('/') || /^[a-zA-Z]:/.test(name)) throw new Error(`Недопустимое имя в архиве: ${name}`);
  const parts = name.split('/');
  if (parts.some((p) => p === '..' || p === '.' || p === '')) throw new Error(`Недопустимое имя в архиве: ${name}`);
  if (name === 'manifest.json' || name === 'archive.db') return name;
  if (parts[0] === 'files' && parts.length >= 2) return name;
  throw new Error(`Лишний файл в архиве: ${name}`);
}

async function extractZip(zipFile, destDir) {
  const zip = await openZip(zipFile);
  const written = [];
  await new Promise((resolve, reject) => {
    zip.on('error', reject);
    zip.on('end', resolve);
    zip.on('entry', (entry) => {
      let name;
      try {
        name = safeEntryName(entry.fileName);
      } catch (e) {
        return reject(e);
      }
      if (name == null) return zip.readEntry();
      const target = path.resolve(destDir, name);
      if (!target.startsWith(path.resolve(destDir) + path.sep)) return reject(new Error(`Недопустимое имя в архиве: ${name}`));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      zip.openReadStream(entry, (err, rs) => {
        if (err) return reject(err);
        pipeline(rs, fs.createWriteStream(target)).then(() => {
          written.push(name);
          zip.readEntry();
        }, reject);
      });
    });
    zip.readEntry();
  });
  return written;
}

function moveSync(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(src, dest);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    fs.cpSync(src, dest, { recursive: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
}

/**
 * Проверяет и разворачивает ZIP, затем заменяет текущие данные.
 * Старые данные не удаляются: уходят в data/backups/before-restore-<время>/.
 */
export async function restoreArchive(zipFile) {
  fs.mkdirSync(paths.tmp(), { recursive: true });
  const work = fs.mkdtempSync(path.join(paths.tmp(), 'restore-'));
  try {
    const names = await extractZip(zipFile, work);
    if (!names.includes('manifest.json')) throw new Error('В архиве нет manifest.json — это не архив приложения');
    if (!names.includes('archive.db')) throw new Error('В архиве нет базы archive.db');

    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(work, 'manifest.json'), 'utf8'));
    } catch {
      throw new Error('manifest.json повреждён');
    }
    if (manifest.app !== APP_ID) throw new Error('Это не архив Passat B5 Archive');
    if (manifest.schemaVersion > MIGRATIONS.length) throw new Error('Архив создан более новой версией приложения');

    // Контрольные суммы базы и каждого файла.
    const dbFile = path.join(work, 'archive.db');
    if ((await sha256File(dbFile)) !== manifest.db.sha256) throw new Error('База в архиве повреждена (контрольная сумма не совпала)');
    const listed = new Set();
    for (const f of manifest.files) {
      const name = safeEntryName(f.path);
      listed.add(name);
      const abs = path.join(work, name);
      if (!fs.existsSync(abs)) throw new Error(`В архиве не хватает файла ${f.path}`);
      if ((await sha256File(abs)) !== f.sha256) throw new Error(`Файл повреждён (контрольная сумма): ${f.path}`);
    }
    const extra = names.filter((n) => n.startsWith('files/') && !listed.has(n));
    if (extra.length) throw new Error(`В архиве есть файлы, которых нет в описи: ${extra[0]}`);

    // База должна быть целой.
    const probe = new DatabaseSync(dbFile, { readOnly: true });
    try {
      const ok = probe.prepare('PRAGMA integrity_check').get();
      if (Object.values(ok)[0] !== 'ok') throw new Error('Проверка целостности базы из архива не пройдена');
    } finally {
      probe.close();
    }

    // Замена. Сначала убираем старое в резервную папку.
    closeDb();
    const data = paths.data();
    const backupDir = path.join(paths.backups(), `before-restore-${stamp()}`);
    fs.mkdirSync(backupDir, { recursive: true });
    const moved = [];
    const oldItems = [
      ['archive.db', path.join(data, 'archive.db')],
      ['archive.db-wal', path.join(data, 'archive.db-wal')],
      ['archive.db-shm', path.join(data, 'archive.db-shm')],
      ['files', paths.files()],
      ['thumbs', paths.thumbs()],
    ];
    try {
      for (const [name, src] of oldItems) {
        if (fs.existsSync(src)) {
          moveSync(src, path.join(backupDir, name));
          moved.push([name, src]);
        }
      }
      moveSync(dbFile, path.join(data, 'archive.db'));
      if (fs.existsSync(path.join(work, 'files'))) moveSync(path.join(work, 'files'), paths.files());
      else fs.mkdirSync(paths.files(), { recursive: true });
      fs.mkdirSync(paths.thumbs(), { recursive: true });
    } catch (e) {
      // Откат: вернуть старые данные на место.
      for (const p of [path.join(data, 'archive.db'), paths.files(), paths.thumbs()]) fs.rmSync(p, { recursive: true, force: true });
      for (const [name, src] of moved) {
        try { moveSync(path.join(backupDir, name), src); } catch { /* уже на месте */ }
      }
      openDb();
      throw new Error(`Не удалось заменить данные (${e.code === 'EBUSY' || e.code === 'EPERM' ? 'остановите сервер и повторите' : e.message}). Старые данные возвращены.`);
    }

    const db = openDb();
    reindexAll(db);
    return { files: manifest.files.length, missing: manifest.missing ?? [], backupDir, createdAt: manifest.createdAt };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// Автокопия базы при запуске: data/backups/auto-<время>.db, хранится последние N.
export function autoBackup(db) {
  const dir = paths.backups();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `auto-${stamp()}.db`);
  snapshotDb(db, file);
  const old = fs.readdirSync(dir).filter((f) => /^auto-.*\.db$/.test(f)).sort();
  while (old.length > config.backupsToKeep) fs.rmSync(path.join(dir, old.shift()), { force: true });
  return file;
}

export { stamp };
