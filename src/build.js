// Сборка статического сайта справочника в dist/ (для GitHub Pages или любой раздачи файлов).
//   node src/build.js            — для открытия с корня сайта (BASE=/)
//   BASE=/passat-b5-archive/ node src/build.js — для сайта в подпапке (GitHub Pages проекта)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDb } from './db.js';
import { paths } from './config.js';
import { seedAll } from './lib/seed.js';
import { buildApp, notFoundPage } from './server.js';
import { searchIndexJson } from './routes/search.js';

export function normBase(b) {
  let s = String(b || '/').trim();
  if (!s.startsWith('/')) s = `/${s}`;
  if (!s.endsWith('/')) s += '/';
  return s;
}

// Внутренние ссылки -> адреса сайта: /codes/5 -> BASE + codes/5/, /schemes#s3 -> BASE + schemes/#s3.
// Файлы (/static/app.css, /search-index.json) остаются без косой черты в конце.
export function rewriteHtml(html, base) {
  const fix = (url) => {
    if (!url.startsWith('/') || url.startsWith('//')) return url;
    const m = /^([^?#]*)([?#].*)?$/.exec(url);
    let p = m[1];
    const rest = m[2] ?? '';
    const isFile = /\.[a-z0-9]+$/i.test(p);
    if (!isFile && !p.endsWith('/')) p += '/';
    return base + p.replace(/^\//, '') + rest;
  };
  return html
    .replace(/\b(href|src|action)="(\/[^"]*)"/g, (_m, attr, url) => `${attr}="${fix(url)}"`)
    .replace('data-base="/"', `data-base="${base}"`);
}

function outFile(dist, url) {
  const clean = url.replace(/^\//, '').replace(/\/$/, '');
  return clean ? path.join(dist, ...clean.split('/'), 'index.html') : path.join(dist, 'index.html');
}

export async function buildSite({ base = process.env.BASE || '/', dist = paths.dist(), quiet = false } = {}) {
  base = normBase(base);
  const db = openDb();
  const counts = seedAll(db);
  const app = await buildApp();

  const urls = ['/', '/menu', '/search', '/codes', '/kb', '/schemes', '/parts', '/maintenance', '/links'];
  for (const [table, prefix] of [['dtc_codes', '/codes/'], ['articles', '/kb/'], ['parts', '/parts/'], ['maintenance_items', '/maintenance/']]) {
    for (const { id } of db.prepare(`SELECT id FROM ${table} ORDER BY id`).all()) urls.push(prefix + id);
  }

  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  for (const url of urls) {
    const res = await app.inject({ method: 'GET', url });
    if (res.statusCode !== 200) throw new Error(`Страница ${url} ответила ${res.statusCode}`);
    const file = outFile(dist, url);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, rewriteHtml(res.body, base));
  }
  fs.writeFileSync(path.join(dist, '404.html'), rewriteHtml(notFoundPage(), base));
  fs.writeFileSync(path.join(dist, 'search-index.json'), searchIndexJson(db));
  fs.cpSync(paths.public(), path.join(dist, 'static'), { recursive: true });
  fs.writeFileSync(path.join(dist, '.nojekyll'), '');
  await app.close();

  if (!quiet) {
    console.log(`Сайт собран: ${dist}`);
    console.log(`Страниц: ${urls.length + 1}. Кодов ${counts.codes}, статей ${counts.articles}, схем ${counts.schemes}, деталей ${counts.parts}, ссылок ${counts.links}. Адрес сайта: ${base}`);
  }
  return { pages: urls.length + 1, counts, base };
}

// Запуск из командной строки.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  buildSite().catch((e) => {
    console.error('Сборка не удалась:', e.message);
    process.exit(1);
  });
}
