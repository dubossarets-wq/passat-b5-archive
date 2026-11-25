// Сборка справочника из папки seed/. Вызывается при каждом запуске.
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { paths } from '../config.js';
import { tx, lastId } from '../db.js';
import { normPart } from '../../public/js/stem.js';

export const SCHEME_KINDS = ['diagram', 'pinout', 'fuses', 'location', 'guide', 'official'];
export const SCHEME_SOURCES = ['official', 'reference', 'forum', 'blog', 'video'];

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const asText = (v) => (Array.isArray(v) ? v.join(', ') : v == null ? null : String(v));
const clean = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
const jsonFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort() : []);

function addSources(db, kind, id, sources) {
  const ins = db.prepare(
    'INSERT INTO sources (owner_kind, owner_id, url, title, accessed, applies_to, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  for (const s of sources ?? []) {
    if (!s || !s.url) continue;
    ins.run(kind, id, clean(s.url), clean(s.title), clean(s.accessed), asText(s.applies_to), clean(s.note));
  }
}

export const systemIdBySlug = (db, slug) => (slug ? db.prepare('SELECT id FROM systems WHERE slug = ?').get(slug)?.id ?? null : null);

function seedSystems(db, dir) {
  const list = readJson(path.join(dir, 'systems.json')) ?? [];
  const ins = db.prepare('INSERT OR IGNORE INTO systems (slug, name, sort) VALUES (?, ?, ?)');
  list.forEach((s, i) => ins.run(s.slug, s.name, i + 1));
  return list.length;
}

function seedMaintenance(db, dir) {
  let n = 0;
  (readJson(path.join(dir, 'maintenance.json')) ?? []).forEach((m, i) => {
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

function seedParts(db, dir) {
  let n = 0;
  for (const p of readJson(path.join(dir, 'parts.json')) ?? []) {
    if (!p.oem || !p.name) continue;
    const norm = normPart(p.oem);
    const item = p.maintenance_key ? db.prepare('SELECT id FROM maintenance_items WHERE key = ?').get(p.maintenance_key)?.id ?? null : null;
    const res = db.prepare(
      `INSERT OR IGNORE INTO parts (oem, oem_norm, name, system_id, maintenance_item_id, notes, status, seed_key)
       VALUES (?, ?, ?, ?, ?, ?, 'unverified', ?)`,
    ).run(p.oem.trim(), norm, p.name.trim(), systemIdBySlug(db, p.system), item, clean(p.notes), `${norm}:${p.name}`);
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

function seedCodes(db, dir) {
  let n = 0;
  for (const f of jsonFiles(path.join(dir, 'codes'))) {
    for (const c of readJson(path.join(dir, 'codes', f)) ?? []) {
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

function seedArticles(db, dir) {
  const artDir = path.join(dir, 'articles');
  if (!fs.existsSync(artDir)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(artDir).filter((x) => x.endsWith('.md')).sort()) {
    let parsed;
    try {
      parsed = parseArticle(fs.readFileSync(path.join(artDir, f), 'utf8'));
    } catch (e) {
      console.error(`Статья ${f}: не удалось разобрать заголовок (${e.message})`);
      continue;
    }
    if (!parsed || !parsed.meta.title) continue;
    const res = db.prepare(
      "INSERT OR IGNORE INTO articles (title, system_id, body_md, applies_to, status, seed_key) VALUES (?, ?, ?, ?, 'unverified', ?)",
    ).run(String(parsed.meta.title), systemIdBySlug(db, parsed.meta.system), parsed.body, asText(parsed.meta.applies_to), f);
    if (res.changes) {
      addSources(db, 'article', lastId(res), parsed.meta.sources);
      n++;
    }
  }
  return n;
}

function seedLinks(db, dir) {
  const ins = db.prepare(
    'INSERT OR IGNORE INTO links (title, url, category, description, applies_to, checked_at, check_result) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  let n = 0;
  for (const l of readJson(path.join(dir, 'links.json')) ?? []) {
    if (!l.url || !l.title) continue;
    n += ins.run(l.title.trim(), l.url.trim(), l.category || 'reference', clean(l.description), asText(l.applies_to),
      clean(l.checked_at), clean(l.check_result)).changes;
  }
  return n;
}

// Картинки схем: только прямые http(s)-адреса; показываются с исходного сайта, не копируются.
export function cleanImages(list) {
  if (!Array.isArray(list)) return null;
  const out = list
    .filter((im) => im && typeof im.src === 'string' && /^https?:\/\//i.test(im.src.trim()))
    .slice(0, 12)
    .map((im) => ({ src: im.src.trim(), caption: clean(im.caption) ?? '', source_url: clean(im.source_url) }));
  return out.length ? JSON.stringify(out) : null;
}

function seedSchemes(db, dir) {
  const ins = db.prepare(
    `INSERT OR IGNORE INTO schemes (title, url, system_id, kind, source_type, description, applies_to, checked_at, check_result, images, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unverified')`,
  );
  let n = 0;
  for (const f of jsonFiles(path.join(dir, 'schemes'))) {
    for (const s of readJson(path.join(dir, 'schemes', f)) ?? []) {
      if (!s.url || !s.title || !/^https?:\/\//.test(s.url)) continue;
      const url = s.url.trim();
      const images = cleanImages(s.images);
      const added = ins.run(s.title.trim(), url, systemIdBySlug(db, s.system), SCHEME_KINDS.includes(s.kind) ? s.kind : 'diagram',
        SCHEME_SOURCES.includes(s.source_type) ? s.source_type : 'reference', clean(s.description), asText(s.applies_to),
        clean(s.accessed), clean(s.check_result), images).changes;
      n += added;
      // Та же ссылка у другого собирателя: картинки объединяем, чтобы не потерять.
      if (!added && images) {
        const cur = db.prepare('SELECT images FROM schemes WHERE url = ?').get(url);
        const merged = [...JSON.parse(cur?.images ?? '[]'), ...JSON.parse(images)];
        const uniq = merged.filter((im, i) => merged.findIndex((x) => x.src === im.src) === i).slice(0, 12);
        db.prepare('UPDATE schemes SET images = ? WHERE url = ?').run(JSON.stringify(uniq), url);
      }
    }
  }
  return n;
}

export const DIAGRAM_TYPES = ['pinout', 'circuit'];

function seedDiagrams(db, dir) {
  let n = 0;
  for (const f of jsonFiles(path.join(dir, 'diagrams'))) {
    for (const d of readJson(path.join(dir, 'diagrams', f)) ?? []) {
      if (!d.id || !d.title || !DIAGRAM_TYPES.includes(d.type)) continue;
      const data = d.type === 'pinout'
        ? { component: d.component ?? '', location: d.location ?? '', pins: Array.isArray(d.pins) ? d.pins : [] }
        : { paths: Array.isArray(d.paths) ? d.paths : [] };
      const res = db.prepare(
        `INSERT OR IGNORE INTO diagrams (slug, type, title, system_id, applies_to, data, notes, images, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unverified')`,
      ).run(String(d.id).toLowerCase().replace(/[^a-z0-9-]+/g, '-'), d.type, d.title.trim(), systemIdBySlug(db, d.system), asText(d.applies_to),
        JSON.stringify(data), clean(d.notes), cleanImages(d.images));
      if (res.changes) {
        addSources(db, 'diagram', lastId(res), d.sources);
        n++;
      }
    }
  }
  return n;
}

/** Загрузить весь справочник из seed/ в пустую базу. Возвращает количество записей по разделам. */
export function seedAll(db, dir = paths.seed()) {
  const counts = {};
  tx(db, () => {
    counts.systems = seedSystems(db, dir);
    counts.maintenance = seedMaintenance(db, dir);
    counts.parts = seedParts(db, dir);
    counts.codes = seedCodes(db, dir);
    counts.articles = seedArticles(db, dir);
    counts.links = seedLinks(db, dir);
    counts.schemes = seedSchemes(db, dir);
    counts.diagrams = seedDiagrams(db, dir);
  });
  return counts;
}
