// Проверка ссылок из черновиков: node src/cli/check-links.js [--all] [файл.json]
//  без параметров — только seed/links.json;
//  --all          — ещё и все ссылки-источники в кодах, статьях, регламенте и деталях.
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../config.js';
import { checkUrl } from '../lib/linkcheck.js';
import { parseArticle } from '../lib/seed.js';

const args = process.argv.slice(2);
const all = args.includes('--all');
const fileArg = args.find((a) => !a.startsWith('--'));
const seed = paths.seed();

const urls = new Map(); // url -> откуда
const add = (url, where) => {
  if (url && /^https?:\/\//.test(url) && !urls.has(url)) urls.set(url, where);
};
const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);

for (const l of readJson(fileArg ?? path.join(seed, 'links.json'))) add(l.url, 'links');
if (all && !fileArg) {
  for (const f of fs.existsSync(path.join(seed, 'codes')) ? fs.readdirSync(path.join(seed, 'codes')) : []) {
    for (const c of readJson(path.join(seed, 'codes', f))) for (const s of c.sources ?? []) add(s.url, `код ${c.code}`);
  }
  for (const f of fs.existsSync(path.join(seed, 'articles')) ? fs.readdirSync(path.join(seed, 'articles')) : []) {
    const a = parseArticle(fs.readFileSync(path.join(seed, 'articles', f), 'utf8'));
    for (const s of a?.meta.sources ?? []) add(s.url, `статья ${f}`);
  }
  for (const m of readJson(path.join(seed, 'maintenance.json'))) for (const s of m.sources ?? []) add(s.url, `регламент ${m.key}`);
  for (const f of fs.existsSync(path.join(seed, 'schemes')) ? fs.readdirSync(path.join(seed, 'schemes')) : []) {
    for (const s of readJson(path.join(seed, 'schemes', f))) add(s.url, `схема ${s.title}`);
  }
  for (const p of readJson(path.join(seed, 'parts.json'))) {
    for (const s of p.sources ?? []) add(s.url, `деталь ${p.oem}`);
    for (const a of p.analogs ?? []) add(a.source_url, `аналог ${p.oem}`);
  }
}

const list = [...urls];
console.log(`Проверяю ссылок: ${list.length}`);
const results = [];
let next = 0;
async function worker() {
  while (next < list.length) {
    const [url, where] = list[next++];
    const r = await checkUrl(url);
    results.push({ url, where, ...r });
    process.stdout.write(r.ok ? (r.manual ? 'o' : '.') : 'X');
  }
}
await Promise.all(Array.from({ length: 6 }, worker));

const bad = results.filter((r) => !r.ok);
const manual = results.filter((r) => r.ok && r.manual);
console.log(`\n\nОткрываются: ${results.length - bad.length - manual.length}`);
console.log(`Сайт блокирует автопроверку (открыть вручную): ${manual.length}`);
console.log(`Не открываются: ${bad.length}`);
const byHost = {};
for (const r of manual) byHost[new URL(r.url).host] = (byHost[new URL(r.url).host] ?? 0) + 1;
for (const [host, n] of Object.entries(byHost).sort((a, b) => b[1] - a[1])) console.log(`  [вручную] ${host}: ${n}`);
for (const r of bad) console.log(`  [ОШИБКА]  ${r.text}\n      ${r.url}  (${r.where})`);
fs.mkdirSync(paths.tmp(), { recursive: true });
fs.writeFileSync(path.join(paths.tmp(), 'link-report.json'), JSON.stringify(results, null, 1));
process.exitCode = bad.length ? 1 : 0;
