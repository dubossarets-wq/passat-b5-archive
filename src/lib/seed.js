// Загрузка черновиков из папки seed/ в базу. Повторный запуск ничего не перезаписывает:
// добавляются только отсутствующие записи (то, что вы правили руками, не затрагивается).
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { paths } from '../config.js';
import { tx, lastId, getSetting, setSetting } from '../db.js';
import { normPart } from './stem.js';
import { reindexAll } from './search.js';

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const asText = (v) => (Array.isArray(v) ? v.join(', ') : v == null ? null : String(v));
const clean = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());

function addSources(db, kind, id, sources) {
  const ins = db.prepare(
    'INSERT INTO sources (owner_kind, owner_id, url, title, accessed, applies_to, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  for (const s of sources ?? []) {
    if (!s || !s.url) continue;
    ins.run(kind, id, clean(s.url), clean(s.title), clean(s.accessed), asText(s.applies_to), clean(s.note));
  }
}

export function seedSystems(db) {
  const list = readJson(path.join(paths.seed(), 'systems.json')) ?? [];
  const ins = db.prepare('INSERT OR IGNORE INTO systems (slug, name, sort) VALUES (?, ?, ?)');
  list.forEach((s, i) => ins.run(s.slug, s.name, i + 1));
  return list.length;
}

export const systemIdBySlug = (db, slug) => (slug ? db.prepare('SELECT id FROM systems WHERE slug = ?').get(slug)?.id ?? null : null);

export function seedSpecs(db) {
  const list = readJson(path.join(paths.seed(), 'specs.json')) ?? [];
  const ins = db.prepare('INSERT OR IGNORE INTO specs (key, name, system_id, unit) VALUES (?, ?, ?, ?)');
  let n = 0;
  for (const s of list) n += ins.run(s.key, s.name, systemIdBySlug(db, s.system), s.unit || null).changes;
  return n;
}

export function seedMaintenance(db) {
  const list = readJson(path.join(paths.seed(), 'maintenance.json')) ?? [];
  let n = 0;
  list.forEach((m, i) => {
    if (!m.key || !m.name) return;
    const res = db.prepare(
      `INSERT OR IGNORE INTO maintenance_items (key, name, system_id, interval_km, interval_months, note, status, sort)
       VALUES (?, ?, ?, ?, ?, ?, 'unverified', ?)`,
    ).run(m.key, m.name, systemIdBySlug(db, m.system), Number.isFinite(m.interval_km) ? m.interval_km : null,
      Number.isFinite(m.interval_months) ? m.interval_months : null, clean(m.note), i + 1);
    if (res.changes) {
      addSources(db, 'maintenance', lastId(res), m.sources);
      n++;
    }
  });
  return n;
}

export function seedParts(db) {
  const list = readJson(path.join(paths.seed(), 'parts.json')) ?? [];
  let n = 0;
  for (const p of list) {
    if (!p.oem || !p.name) continue;
    const norm = normPart(p.oem);
    const key = `${norm}:${p.name}`;
    const item = p.maintenance_key ? db.prepare('SELECT id FROM maintenance_items WHERE key = ?').get(p.maintenance_key)?.id ?? null : null;
    const res = db.prepare(
      `INSERT OR IGNORE INTO parts (oem, oem_norm, name, system_id, maintenance_item_id, notes, status, seed_key)
       VALUES (?, ?, ?, ?, ?, ?, 'unverified', ?)`,
    ).run(p.oem.trim(), norm, p.name.trim(), systemIdBySlug(db, p.system), item, clean(p.notes), key);
    if (!res.changes) continue;
    const id = lastId(res);
    for (const a of p.analogs ?? []) {
      if (!a.brand || !a.number) continue;
      db.prepare('INSERT INTO part_analogs (part_id, brand, number, number_norm, source_url) VALUES (?, ?, ?, ?, ?)')
        .run(id, a.brand.trim(), String(a.number).trim(), normPart(a.number), clean(a.source_url));
    }
    addSources(db, 'part', id, p.sources);
    n++;
  }
  return n;
}

export function seedCodes(db) {
  const dir = path.join(paths.seed(), 'codes');
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const list = readJson(path.join(dir, f)) ?? [];
    for (const c of list) {
      if (!c.code || !c.title) continue;
      const res = db.prepare(
        `INSERT OR IGNORE INTO dtc_codes (code, vag, system_id, title, description, causes, checks, applies_to, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unverified')`,
      ).run(String(c.code).trim().toUpperCase(), clean(c.vag), systemIdBySlug(db, c.system), c.title.trim(), clean(c.description),
        JSON.stringify(c.causes ?? []), JSON.stringify(c.checks ?? []), asText(c.applies_to));
      if (res.changes) {
        addSources(db, 'code', lastId(res), c.sources);
        n++;
      }
    }
  }
  return n;
}

// Разбор статьи: YAML-заголовок между строками --- и Markdown-текст.
export function parseArticle(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  return { meta: YAML.parse(m[1]) ?? {}, body: m[2].trim() };
}

export function seedArticles(db) {
  const dir = path.join(paths.seed(), 'articles');
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md')).sort()) {
    let parsed;
    try {
      parsed = parseArticle(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch (e) {
      console.error(`Статья ${f}: не удалось разобрать заголовок (${e.message})`);
      continue;
    }
    if (!parsed || !parsed.meta.title) {
      console.error(`Статья ${f}: нет заголовка с названием, пропущена`);
      continue;
    }
    const res = db.prepare(
      `INSERT OR IGNORE INTO articles (title, system_id, body_md, applies_to, status, seed_key)
       VALUES (?, ?, ?, ?, 'unverified', ?)`,
    ).run(String(parsed.meta.title), systemIdBySlug(db, parsed.meta.system), parsed.body, asText(parsed.meta.applies_to), f);
    if (res.changes) {
      addSources(db, 'article', lastId(res), parsed.meta.sources);
      n++;
    }
  }
  return n;
}

export function seedLinks(db) {
  const list = readJson(path.join(paths.seed(), 'links.json')) ?? [];
  const ins = db.prepare(
    `INSERT OR IGNORE INTO links (title, url, category, description, applies_to, checked_at, check_result, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'unverified')`,
  );
  let n = 0;
  for (const l of list) {
    if (!l.url || !l.title) continue;
    n += ins.run(l.title.trim(), l.url.trim(), l.category || 'reference', clean(l.description), asText(l.applies_to),
      clean(l.checked_at), clean(l.check_result)).changes;
  }
  return n;
}

export function seedAll(db) {
  const counts = {};
  tx(db, () => {
    counts.systems = seedSystems(db);
    counts.specs = seedSpecs(db);
    counts.maintenance = seedMaintenance(db);
    counts.parts = seedParts(db);
    counts.codes = seedCodes(db);
    counts.articles = seedArticles(db);
    counts.links = seedLinks(db);
  });
  reindexAll(db);
  return counts;
}

// При первом запуске — загрузить всё; дальше только по кнопке в настройках.
export function seedIfFirstRun(db) {
  seedSystems(db);
  if (getSetting(db, 'seeded') === '1') return null;
  const counts = seedAll(db);
  setSetting(db, 'seeded', '1');
  return counts;
}
