// Справочник только для чтения: страницы, отсутствие форм ввода, сборка статического сайта.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir, rmDir } from './helpers.js';
import { openDb } from '../src/db.js';
import { seedAll } from '../src/lib/seed.js';
import { buildApp } from '../src/server.js';
import { buildSite, rewriteHtml } from '../src/build.js';

let app;
let tmp;

let diagramId;
before(async () => {
  const db = openDb();
  seedAll(db);
  // Пример собственной схемы и ссылки с картинкой — чтобы проверить отрисовку независимо от наполнения.
  diagramId = Number(db.prepare(
    "INSERT INTO diagrams (slug, type, title, data, images) VALUES ('test-obd', 'pinout', 'Тестовый разъём OBD', ?, ?)",
  ).run(JSON.stringify({ component: 'Разъём OBD', pins: [{ pin: '7', signal: 'K-линия', wire: 'серо-оранжевый', to: 'блоки' }, { pin: '16', signal: '+12 В', wire: '', to: 'предохранитель' }] }),
    JSON.stringify([{ src: 'https://example.org/obd.jpg', caption: 'фото разъёма' }])).lastInsertRowid);
  db.prepare("INSERT INTO schemes (title, url, kind, images) VALUES ('Тест с картинкой', 'https://example.org/post', 'pinout', ?)")
    .run(JSON.stringify([{ src: 'https://example.org/pin.png', caption: 'распиновка' }]));
  app = await buildApp();
  tmp = makeTempDir('site');
});

test('собственная схема рисуется в SVG, с таблицей, цветами проводов и картинкой из источника', async () => {
  const body = (await app.inject({ method: 'GET', url: `/diagrams/${diagramId}` })).body;
  assert.match(body, /<svg class="diagram"/);
  assert.match(body, /K-линия/);
  assert.match(body, /stroke="#9e9e9e"/, 'серый провод');
  assert.match(body, /stroke="#f57c00"/, 'оранжевая полоса');
  assert.match(body, /<table>/);
  assert.match(body, /src="https:\/\/example.org\/obd.jpg"[^>]*referrerpolicy="no-referrer"/);
  const list = (await app.inject({ method: 'GET', url: '/schemes' })).body;
  assert.match(list, new RegExp(`href="/diagrams/${diagramId}"`));
  assert.match(list, /src="https:\/\/example.org\/pin.png"/);
});

after(async () => {
  await app.close();
  rmDir(tmp);
});

const PAGES = ['/', '/menu', '/search', '/codes', '/codes/1', '/kb', '/kb/1', '/schemes', '/parts', '/parts/1', '/maintenance', '/maintenance/1', '/links'];

test('все страницы справочника открываются', async () => {
  for (const url of PAGES) {
    const r = await app.inject({ method: 'GET', url });
    assert.equal(r.statusCode, 200, url);
    assert.match(r.headers['content-security-policy'], /default-src 'self'/);
  }
  assert.equal((await app.inject({ method: 'GET', url: '/journal' })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: '/settings' })).statusCode, 404);
});

test('ввод — только строка поиска: нет форм отправки и других полей', async () => {
  for (const url of PAGES) {
    const body = (await app.inject({ method: 'GET', url })).body;
    assert.doesNotMatch(body, /method="post"/i, url);
    assert.doesNotMatch(body, /<textarea|<select|type="file"|type="password"|type="checkbox"/i, url);
    for (const m of body.matchAll(/<input[^>]*>/g)) {
      assert.match(m[0], /name="(q|kind)"/, `${url}: лишнее поле ${m[0]}`);
    }
  }
});

test('изменять ничего нельзя: запросы кроме GET отклоняются', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    assert.equal((await app.inject({ method, url: '/codes' })).statusCode, 405, method);
  }
});

test('страница поиска передаёт названия разделов корректным JSON', async () => {
  const body = (await app.inject({ method: 'GET', url: '/search' })).body;
  const m = /<script type="application\/json" id="search-kinds">([\s\S]*?)<\/script>/.exec(body);
  assert.ok(m);
  assert.equal(JSON.parse(m[1]).code, 'Коды ошибок');
});

test('индекс поиска отдаётся и содержит все разделы', async () => {
  const r = await app.inject({ method: 'GET', url: '/search-index.json' });
  assert.equal(r.statusCode, 200);
  const idx = JSON.parse(r.body);
  const kinds = new Set(idx.map((d) => d.k));
  for (const k of ['code', 'article', 'part', 'maintenance', 'link']) assert.ok(kinds.has(k), k);
});

test('ссылки переписываются под адрес сайта в подпапке', () => {
  const html = '<html lang="ru" data-base="/"><a href="/codes/5">a</a><a href="/">b</a><a href="/schemes#s3">c</a>'
    + '<link href="/static/app.css"><form action="/search"></form><a href="https://x.org/y">d</a><a href="/search?q=1">e</a>';
  const out = rewriteHtml(html, '/passat-b5-archive/');
  assert.match(out, /href="\/passat-b5-archive\/codes\/5\/"/);
  assert.match(out, /href="\/passat-b5-archive\/"/);
  assert.match(out, /href="\/passat-b5-archive\/schemes\/#s3"/);
  assert.match(out, /href="\/passat-b5-archive\/static\/app.css"/);
  assert.match(out, /action="\/passat-b5-archive\/search\/"/);
  assert.match(out, /href="https:\/\/x.org\/y"/);
  assert.match(out, /href="\/passat-b5-archive\/search\/\?q=1"/);
  assert.match(out, /data-base="\/passat-b5-archive\/"/);
});

test('сборка статического сайта: все страницы, индекс поиска, стили, без внутренних ссылок мимо сайта', async () => {
  const dist = path.join(tmp, 'dist');
  const res = await buildSite({ base: '/passat-b5-archive/', dist, quiet: true });
  assert.ok(res.pages > 150, `страниц: ${res.pages}`);
  for (const f of ['index.html', 'codes/index.html', 'codes/1/index.html', 'kb/1/index.html', 'search/index.html', 'schemes/index.html',
    '404.html', 'search-index.json', 'static/app.css', 'static/js/searchcore.js', 'static/js/stem.js', 'static/radix/base.css', '.nojekyll']) {
    assert.ok(fs.existsSync(path.join(dist, f)), f);
  }
  // Все внутренние ссылки ведут внутрь сайта и указывают на существующие страницы.
  const home = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  for (const m of home.matchAll(/(?:href|src|action)="(\/[^"#?]*)/g)) {
    assert.ok(m[1].startsWith('/passat-b5-archive/'), m[1]);
    const rel = m[1].slice('/passat-b5-archive/'.length);
    const target = rel === '' || rel.endsWith('/') ? path.join(dist, rel, 'index.html') : path.join(dist, rel);
    assert.ok(fs.existsSync(target), `нет файла для ${m[1]}`);
  }
});
