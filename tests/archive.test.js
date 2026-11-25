// Защита при восстановлении: битые и вредные архивы отклоняются, данные остаются нетронутыми.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { makeTempDir, rmDir, makeZip } from './helpers.js';

const root = makeTempDir('arc');
const dataDir = path.join(root, 'data');
process.env.ARCHIVE_DATA_DIR = dataDir;

const { openDb, closeDb } = await import('../src/db.js');
const { snapshotDb, restoreArchive, safeEntryName, autoBackup } = await import('../src/lib/archive.js');
const { MIGRATIONS } = await import('../src/schema.js');
const { config } = await import('../src/config.js');

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
let db;

before(() => {
  db = openDb();
  db.prepare("INSERT INTO records (date, title) VALUES ('2025-01-01', 'Исходная запись')").run();
  fs.mkdirSync(path.join(dataDir, 'files', '2025', '01'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'files', '2025', '01', 'orig.bin'), 'исходный файл');
});

after(() => {
  closeDb();
  rmDir(root);
});

// Корректные элементы архива: manifest + база + один файл.
function validEntries({ mutate = () => {} } = {}) {
  const snap = path.join(root, `snap-${Math.random().toString(16).slice(2)}.db`);
  snapshotDb(db, snap);
  const dbBuf = fs.readFileSync(snap);
  fs.rmSync(snap);
  const fileBuf = Buffer.from('файл из архива');
  const manifest = {
    app: 'passat-b5-archive', format: 1, createdAt: new Date().toISOString(), schemaVersion: MIGRATIONS.length,
    db: { path: 'archive.db', size: dbBuf.length, sha256: sha(dbBuf) },
    files: [{ path: 'files/2025/02/new.bin', size: fileBuf.length, sha256: sha(fileBuf) }],
    missing: [],
  };
  const entries = { manifest, dbBuf, fileBuf };
  mutate(entries);
  return [
    { name: 'manifest.json', data: JSON.stringify(entries.manifest) },
    { name: 'archive.db', data: entries.dbBuf },
    { name: 'files/2025/02/new.bin', data: entries.fileBuf },
  ];
}

function writeZip(entries) {
  const f = path.join(root, `a-${Math.random().toString(16).slice(2)}.zip`);
  fs.writeFileSync(f, makeZip(entries));
  return f;
}

function assertDataIntact() {
  db = openDb();
  assert.equal(db.prepare('SELECT title FROM records').get().title, 'Исходная запись');
  assert.equal(fs.readFileSync(path.join(dataDir, 'files', '2025', '01', 'orig.bin'), 'utf8'), 'исходный файл');
}

test('safeEntryName пропускает только manifest, базу и files/…', () => {
  assert.equal(safeEntryName('manifest.json'), 'manifest.json');
  assert.equal(safeEntryName('archive.db'), 'archive.db');
  assert.equal(safeEntryName('files/2025/01/a.pdf'), 'files/2025/01/a.pdf');
  assert.equal(safeEntryName('files/'), null);
  for (const bad of ['../evil.txt', 'files/../../evil.txt', '/etc/passwd', 'C:/evil.txt', 'files\\x.bin', 'evil.exe', 'files', 'files//a', './archive.db']) {
    assert.throws(() => safeEntryName(bad), undefined, bad);
  }
});

test('архив с путём за пределами папки отклоняется, ничего не создаётся снаружи', async () => {
  const entries = validEntries();
  entries.push({ name: '../evil.txt', data: 'вредный файл' });
  const zip = writeZip(entries);
  await assert.rejects(() => restoreArchive(zip));
  assert.equal(fs.existsSync(path.join(root, 'evil.txt')), false);
  assert.equal(fs.existsSync(path.join(dataDir, '..', 'evil.txt')), false);
  assertDataIntact();
});

test('лишний файл, которого нет в описи, отклоняется', async () => {
  const entries = validEntries();
  entries.push({ name: 'files/2025/02/lishniy.bin', data: 'x' });
  await assert.rejects(() => restoreArchive(writeZip(entries)), /нет в описи/);
  assertDataIntact();
});

test('подмена файла внутри архива ловится по контрольной сумме', async () => {
  const entries = validEntries({ mutate: (e) => { e.fileBuf = Buffer.from('подменённое содержимое'); e.manifest.files[0].sha256 = sha(Buffer.from('другое')); } });
  await assert.rejects(() => restoreArchive(writeZip(entries)), /контрольн/);
  assertDataIntact();
});

test('повреждённая база в архиве отклоняется', async () => {
  const entries = validEntries({ mutate: (e) => { e.dbBuf = Buffer.concat([e.dbBuf.subarray(0, 100), Buffer.from('мусор')]); } });
  await assert.rejects(() => restoreArchive(writeZip(entries)), /контрольн|повреждена/);
  assertDataIntact();
});

test('не архив приложения, без описи и архив новой версии отклоняются', async () => {
  await assert.rejects(() => restoreArchive(writeZip([{ name: 'archive.db', data: 'x' }])), /manifest/);
  await assert.rejects(() => restoreArchive(writeZip(validEntries({ mutate: (e) => { e.manifest.app = 'другое-приложение'; } }))), /не архив/i);
  await assert.rejects(() => restoreArchive(writeZip(validEntries({ mutate: (e) => { e.manifest.schemaVersion = 999; } }))), /новой версией/);
  const notZip = path.join(root, 'plain.zip');
  fs.writeFileSync(notZip, 'это не zip');
  await assert.rejects(() => restoreArchive(notZip));
  assertDataIntact();
});

test('корректный архив восстанавливается, прежние данные уходят в резервную папку', async () => {
  const res = await restoreArchive(writeZip(validEntries()));
  assert.equal(res.files, 1);
  assert.equal(fs.readFileSync(path.join(dataDir, 'files', '2025', '02', 'new.bin'), 'utf8'), 'файл из архива');
  assert.ok(fs.existsSync(path.join(res.backupDir, 'files', '2025', '01', 'orig.bin')), 'старый файл сохранён');
  assert.ok(fs.existsSync(path.join(res.backupDir, 'archive.db')), 'старая база сохранена');
});

test('автокопия базы хранит только последние N штук', () => {
  db = openDb();
  const dir = path.join(dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < config.backupsToKeep + 3; i++) {
    fs.writeFileSync(path.join(dir, `auto-20240101-0000${String(i).padStart(2, '0')}.db`), 'x');
  }
  autoBackup(db);
  const left = fs.readdirSync(dir).filter((f) => /^auto-.*\.db$/.test(f));
  assert.equal(left.length, config.backupsToKeep);
});
