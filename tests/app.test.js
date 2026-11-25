// Сквозные проверки приложения: вход, журнал с фото, напоминания, PDF и поиск по тексту,
// экспорт в ZIP и восстановление из него, защита.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir, rmDir, makePdf, multipart, sha256OfDir } from './helpers.js';

const dataDir = makeTempDir('app');
process.env.ARCHIVE_DATA_DIR = dataDir;

const { buildApp } = await import('../src/server.js');
const { getDb, closeDb } = await import('../src/db.js');
const { whenIdle } = await import('../src/lib/files.js');
const { exportArchive, restoreArchive } = await import('../src/lib/archive.js');
const { default: sharp } = await import('sharp');

let app;
let cookie = '';
const PASSWORD = 'проверка-пароля-1';

const req = (opts) => app.inject({ remoteAddress: '127.0.0.1', ...opts, headers: { cookie, ...(opts.headers ?? {}) } });
const form = (url, data) => req({ method: 'POST', url, payload: new URLSearchParams(data).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
const send = (url, fields, files) => {
  const { payload, headers } = multipart(fields, files);
  return req({ method: 'POST', url, payload, headers });
};

before(async () => {
  app = await buildApp();
});

after(async () => {
  await app.close();
  closeDb();
  rmDir(dataDir);
});

const urlenc = { 'content-type': 'application/x-www-form-urlencoded' };
const anon = (opts) => app.inject({ remoteAddress: '127.0.0.1', ...opts });
const post = (url, data, headers = {}) => anon({ method: 'POST', url, payload: new URLSearchParams(data).toString(), headers: { ...urlenc, ...headers } });

test('по умолчанию пароля нет: архив открыт, страницы входа и первого запуска не нужны', async () => {
  assert.equal((await anon({ method: 'GET', url: '/' })).statusCode, 200);
  assert.equal((await anon({ method: 'GET', url: '/journal' })).statusCode, 200);
  const login = await anon({ method: 'GET', url: '/login' });
  assert.equal(login.statusCode, 302);
  assert.equal(login.headers.location, '/');
  assert.equal((await anon({ method: 'GET', url: '/setup' })).statusCode, 404);
  assert.doesNotMatch((await anon({ method: 'GET', url: '/menu' })).body, /Выйти/);
});

test('пароль включается и отключается в настройках, вход работает', async () => {
  // слишком короткий или несовпадающий пароль не принимается
  assert.match(decodeURIComponent((await post('/settings/password', { password: '123', password2: '123' })).headers.location), /короче/);
  assert.match(decodeURIComponent((await post('/settings/password', { password: PASSWORD, password2: 'другой-пароль-1' })).headers.location), /не совпадают/);
  assert.equal((await anon({ method: 'GET', url: '/' })).statusCode, 200, 'пароль не включился');

  // включаем: этот браузер остаётся внутри, остальные требуют вход
  const on = await post('/settings/password', { password: PASSWORD, password2: PASSWORD });
  const sid = on.cookies.find((c) => c.name === 'sid');
  assert.ok(sid && sid.httpOnly && sid.sameSite === 'Strict');
  const mine = `sid=${sid.value}`;
  assert.equal((await anon({ method: 'GET', url: '/', headers: { cookie: mine } })).statusCode, 200);
  assert.match((await anon({ method: 'GET', url: '/menu', headers: { cookie: mine } })).body, /Выйти/);
  const other = await anon({ method: 'GET', url: '/journal' });
  assert.equal(other.statusCode, 302);
  assert.match(other.headers.location, /^\/login/);
  assert.equal((await anon({ method: 'GET', url: '/files/1' })).statusCode, 302, 'файлы закрыты без входа');

  // вход: неверный и верный пароль, переход только на свои адреса
  assert.equal((await post('/login', { password: 'не тот' })).statusCode, 401);
  const good = await post('/login', { password: PASSWORD, next: '//evil.example' });
  assert.equal(good.statusCode, 302);
  assert.equal(good.headers.location, '/');
  assert.ok(good.cookies.find((c) => c.name === 'sid'));

  // отключение требует текущий пароль
  assert.match(decodeURIComponent((await post('/settings/password/off', { old: 'не тот' }, { cookie: mine })).headers.location), /неверный/);
  assert.equal((await anon({ method: 'GET', url: '/journal' })).statusCode, 302, 'пароль всё ещё включён');
  assert.match(decodeURIComponent((await post('/settings/password/off', { old: PASSWORD }, { cookie: mine })).headers.location), /отключён/);
  assert.equal((await anon({ method: 'GET', url: '/journal' })).statusCode, 200, 'снова открыт без входа');
});

test('защита от запросов с чужих сайтов работает и без пароля', async () => {
  const r = await req({
    method: 'POST', url: '/odometer', payload: 'km=201000',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://evil.example', host: 'localhost:8080' },
  });
  assert.equal(r.statusCode, 403);
  const r2 = await req({
    method: 'POST', url: '/odometer', payload: 'km=201000',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'cross-site' },
  });
  assert.equal(r2.statusCode, 403);
  // свой источник проходит
  const ok = await req({
    method: 'POST', url: '/odometer', payload: 'km=200000',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost:8080', host: 'localhost:8080' },
  });
  assert.equal(ok.statusCode, 302);
});

test('карточка машины сохраняется, показания пробега не уменьшаются', async () => {
  const r = await send('/vehicle', [['name', 'VW Passat B5'], ['vin', 'wvwzzz3bzxe123456'], ['engine_code', 'ARG'], ['gearbox_code', 'EZP'], ['body_code', '3B']], []);
  assert.equal(r.statusCode, 302);
  const row = getDb().prepare('SELECT * FROM vehicle WHERE id = 1').get();
  assert.equal(row.vin, 'WVWZZZ3BZXE123456');
  assert.equal(row.gearbox_code, 'EZP');

  await form('/odometer', { km: '205000' });
  assert.equal(getDb().prepare('SELECT km FROM odometer ORDER BY id DESC LIMIT 1').get().km, 205000);
  const lower = await form('/odometer', { km: '100' });
  assert.match(decodeURIComponent(lower.headers.location), /меньше/);
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM odometer').get().n, 2);
});

test('запись журнала с фото и чеком: файлы, превью, поиск', async () => {
  const db = getDb();
  db.prepare("INSERT INTO systems (slug, name, sort) VALUES ('lubrication', 'Смазка', 1)").run();
  await form('/maintenance', { name: 'Моторное масло', interval_km: '10000', interval_months: '12' });
  const item = db.prepare('SELECT id FROM maintenance_items').get();

  const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#336699' } }).png().toBuffer();
  const r = await send('/journal', [
    ['date', '2025-01-10'], ['odometer_km', '195000'], ['title', 'Замена масла и фильтра'], ['system_id', '1'],
    ['description', 'Залил полусинтетику'], ['cost_work', '0'], ['cost_parts', '120,50'], ['item', String(item.id)],
    ['part_name', 'Масляный фильтр'], ['part_brand', 'MANN-FILTER'], ['part_number', 'W 719/45'], ['part_qty', '1'], ['part_price', '9,5'],
  ], [
    { field: 'photos', filename: 'снимок.png', type: 'image/png', data: png },
    { field: 'receipts', filename: 'чек.pdf', type: 'application/pdf', data: makePdf('Receipt oil filter MANN') },
  ]);
  assert.equal(r.statusCode, 302, r.body);
  await whenIdle();

  const rec = db.prepare('SELECT * FROM records').get();
  assert.equal(rec.cost_parts, 120.5);
  assert.equal(rec.odometer_km, 195000);
  const files = db.prepare('SELECT * FROM files ORDER BY id').all();
  assert.equal(files.length, 2);
  assert.equal(files[0].kind, 'photo');
  assert.equal(files[0].orig_name, 'снимок.png');
  assert.ok(fs.existsSync(path.join(dataDir, 'files', files[0].rel_path)));
  assert.ok(fs.existsSync(path.join(dataDir, 'thumbs', `${files[0].id}.jpg`)), 'превью создано');
  assert.equal(files[1].text_status, 'done');

  const view = await req({ method: 'GET', url: `/journal/${rec.id}` });
  assert.equal(view.statusCode, 200);
  assert.match(view.body, /Замена масла и фильтра/);
  assert.match(view.body, /W 719\/45/);

  // файл отдаётся с правильным типом
  const file = await req({ method: 'GET', url: `/files/${files[0].id}` });
  assert.equal(file.statusCode, 200);
  assert.equal(file.headers['content-type'], 'image/png');

  // поиск по журналу, в том числе по тексту чека (PDF у записи)
  const plain = (html) => html.replace(/<\/?mark>/g, '');
  const s1 = await req({ method: 'GET', url: `/search?q=${encodeURIComponent('масла')}` });
  assert.match(plain(s1.body), /Замена масла и фильтра/);
  assert.match(s1.body, /<mark>масла<\/mark>/, 'найденное слово подсвечено');
  const s2 = await req({ method: 'GET', url: '/search?q=receipt' });
  assert.match(plain(s2.body), /Замена масла и фильтра/);
});

test('напоминания: в норме, скоро, просрочено — по пробегу и по дате', async () => {
  const db = getDb();
  const home = async () => (await req({ method: 'GET', url: '/' })).body;
  // Последняя замена: 195 000 км, 2025-01-10. Интервал 10 000 км / 12 мес. Сейчас 205 000 км.
  const { getReminders } = await import('../src/lib/vehicle.js');
  const at = (today) => getReminders(db, { now: today }).list[0];

  assert.equal(at('2025-06-01').status, 'soon'); // по пробегу осталось 0 км — срок наступил, но не просрочен
  assert.equal(at('2025-06-01').basis, 'km');

  await form('/odometer', { km: '205400' });
  assert.equal(at('2025-06-01').status, 'overdue');
  assert.match(await home(), /просрочено/);

  // По дате: пробег свежий, но срок 12 месяцев вышел
  db.prepare('UPDATE odometer SET km = 196000 WHERE km IN (205000, 205400)').run();
  assert.equal(at('2025-06-01').status, 'ok');
  assert.equal(at('2025-12-20').status, 'soon');
  assert.equal(at('2025-12-20').basis, 'date');
  assert.equal(at('2026-02-01').status, 'overdue');
  assert.equal(at('2026-02-01').basis, 'date');
});

test('документ: загрузка PDF и поиск по слову из его текста', async () => {
  const r = await send('/docs', [['title', 'Руководство по ремонту'], ['doc_type', 'manual'], ['tags', 'мотор']], [
    { field: 'files', filename: 'manual.pdf', type: 'application/pdf', data: makePdf('Camshaft chain tensioner removal procedure') },
  ]);
  assert.equal(r.statusCode, 302, r.body);
  await whenIdle();
  const doc = getDb().prepare('SELECT * FROM documents').get();
  assert.equal(doc.title, 'Руководство по ремонту');
  const f = getDb().prepare("SELECT * FROM files WHERE owner_kind = 'document'").get();
  assert.equal(f.text_status, 'done');
  assert.match(f.text_content, /chain tensioner/);

  const found = await req({ method: 'GET', url: '/search?q=tensioner' });
  assert.match(found.body, /Руководство по ремонту/);
  const list = await req({ method: 'GET', url: '/docs?q=tensioner' });
  assert.match(list.body, /Руководство по ремонту/);
  const none = await req({ method: 'GET', url: '/docs?q=несуществующееслово' });
  assert.doesNotMatch(none.body, /Руководство по ремонту/);

  // просмотр PDF и диапазоны байт
  const viewer = await req({ method: 'GET', url: `/view/${f.id}` });
  assert.equal(viewer.statusCode, 200);
  const range = await req({ method: 'GET', url: `/files/${f.id}`, headers: { range: 'bytes=0-4' } });
  assert.equal(range.statusCode, 206);
  assert.equal(range.body, '%PDF-');
});

test('критичные параметры: значение не сохраняется без источника и не показывается без него', async () => {
  const db = getDb();
  db.prepare("INSERT INTO specs (key, name, unit) VALUES ('engine_oil_capacity', 'Объём масла', 'л')").run();
  const spec = db.prepare('SELECT id FROM specs').get();
  const noSource = await form(`/specs/${spec.id}`, { value: '9', unit: 'л' });
  assert.match(decodeURIComponent(noSource.headers.location), /Без источника/);
  assert.equal(db.prepare('SELECT value FROM specs').get().value, null);

  db.prepare("INSERT INTO articles (title, body_md) VALUES ('Тест', 'Заливать: {{spec:engine_oil_capacity}}')").run();
  const art = db.prepare('SELECT id FROM articles').get();
  let page = (await req({ method: 'GET', url: `/kb/${art.id}` })).body;
  assert.match(page, /уточнить по официальной документации/);

  await form(`/specs/${spec.id}`, { value: '7', unit: 'л', source_url: 'https://example.org/official.pdf', source_page: 'стр. 3' });
  page = (await req({ method: 'GET', url: `/kb/${art.id}` })).body;
  assert.match(page, /<b>7 л<\/b>/);
  assert.match(page, /не проверено/);
  db.prepare('DELETE FROM specs').run();
  db.prepare('DELETE FROM articles').run();
});

test('экспорт в ZIP и восстановление возвращают всё как было', async () => {
  const db = getDb();
  await whenIdle();
  const zipFile = path.join(dataDir, '..', `export-test-${Date.now()}.zip`);
  const filesBefore = sha256OfDir(path.join(dataDir, 'files'));
  delete filesBefore[Object.keys(filesBefore).find((k) => k.startsWith('.incoming')) ?? ''];
  const snapshot = {
    records: db.prepare('SELECT * FROM records ORDER BY id').all(),
    docs: db.prepare('SELECT * FROM documents ORDER BY id').all(),
    files: db.prepare('SELECT id, rel_path, sha256, text_content FROM files ORDER BY id').all(),
    odometer: db.prepare('SELECT * FROM odometer ORDER BY id').all(),
    vehicle: db.prepare('SELECT * FROM vehicle').all(),
    items: db.prepare('SELECT * FROM maintenance_items ORDER BY id').all(),
  };

  try {
    const res = await exportArchive(db, zipFile);
    assert.equal(res.files, 3);
    assert.deepEqual(res.missing, []);

    // Ломаем состояние: новая запись, удалён документ, пропал файл
    await form('/journal/new'.replace('/new', ''), { date: '2025-02-02', title: 'Лишняя запись' });
    db.prepare('DELETE FROM documents').run();
    for (const f of snapshot.files) fs.rmSync(path.join(dataDir, 'files', f.rel_path), { force: true });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM records').get().n, 2);

    const restored = await restoreArchive(zipFile);
    assert.equal(restored.files, 3);
    assert.ok(fs.existsSync(restored.backupDir), 'прежние данные сохранены, а не удалены');

    const db2 = getDb();
    assert.deepEqual(db2.prepare('SELECT * FROM records ORDER BY id').all(), snapshot.records);
    assert.deepEqual(db2.prepare('SELECT * FROM documents ORDER BY id').all(), snapshot.docs);
    assert.deepEqual(db2.prepare('SELECT id, rel_path, sha256, text_content FROM files ORDER BY id').all(), snapshot.files);
    assert.deepEqual(db2.prepare('SELECT * FROM odometer ORDER BY id').all(), snapshot.odometer);
    assert.deepEqual(db2.prepare('SELECT * FROM vehicle').all(), snapshot.vehicle);
    assert.deepEqual(db2.prepare('SELECT * FROM maintenance_items ORDER BY id').all(), snapshot.items);

    const filesAfter = sha256OfDir(path.join(dataDir, 'files'));
    for (const k of Object.keys(filesBefore)) assert.equal(filesAfter[k], filesBefore[k], `файл ${k} совпадает по контрольной сумме`);

    // Поиск работает после восстановления
    const found = await req({ method: 'GET', url: '/search?q=tensioner' });
    assert.match(found.body, /Руководство по ремонту/);
  } finally {
    fs.rmSync(zipFile, { force: true });
  }
});

test('снимок базы в ZIP не содержит сессий входа', async () => {
  const db = getDb();
  const zipFile = path.join(dataDir, '..', `export-sessions-${Date.now()}.zip`);
  const { createSession } = await import('../src/auth.js');
  createSession(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
  try {
    await exportArchive(db, zipFile);
    const { DatabaseSync } = await import('node:sqlite');
    const { extractForTest } = await import('./helpers-zip.js');
    const out = await extractForTest(zipFile, 'archive.db');
    const snap = new DatabaseSync(out, { readOnly: true });
    assert.equal(snap.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
    snap.close();
    fs.rmSync(out, { force: true });
  } finally {
    fs.rmSync(zipFile, { force: true });
  }
});
