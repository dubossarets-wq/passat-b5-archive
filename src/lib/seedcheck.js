// Проверка черновиков из seed/ на соответствие правилам архива:
//  * у каждого факта есть источник (ссылка), дата обращения и статус «не проверено»;
//  * в тексте нет критичных цифр (моменты затяжки, объёмы, давления, зазоры, напряжения и т. п.) —
//    только ссылки {{spec:ключ}} на параметры, у которых значение берётся из официального документа.
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../config.js';
import { parseArticle } from './seed.js';

// Число с единицей измерения, относящейся к критичным параметрам.
const UNITS = String.raw`(?:н\s?[·*.]?\s?м|n\s?[·*.]?\s?m|nm|кгс|кгс\s?[·*]\s?м|бар|bar|psi|кпа|мпа|kpa|mpa|мм|mm|см³|cm3|куб\.?\s?см|литр\w*|л|l|°|град\w*|об\/мин|rpm|мин-1|в|v|вольт\w*|ом|ohm|ком|кОм|мс|ms|гц|hz|а|ма|mA|г|кг|%|°c|°с|градус\w*)`;
const CRITICAL = new RegExp(String.raw`(?<![\w.,])\d+(?:[.,]\d+)?\s?(?:–|-|—|до)?\s?(?:\d+(?:[.,]\d+)?\s?)?${UNITS}(?![\p{L}\p{N}])`, 'iu');

// Допустимые числа: нумерация шагов, номера блоков/каналов VCDS, номера цилиндров, номера групп измерений.
const SAFE_CONTEXT = /(блок\w*|канал\w*|групп\w*|цилиндр\w*|ряд\w*|контакт\w*|вывод\w*|пин\w*|адрес\w*|клемм\w*|строк\w*|элемент\w*)\s*[:№#]?\s*\d+/i;

// Обозначения моторов, коробок и данные машины из описания владельца — это названия, а не регулировки.
const DESIGNATIONS = [
  /(?<![\p{L}\p{N}.,])1[.,]8\s*(?:л|т|t|20\s?v)?(?![\p{L}\p{N}])/giu,
  /(?<![\p{L}\p{N}])20\s?v(?![\p{L}\p{N}])/giu,
  /(?<![\p{L}\p{N}])125\s*л\.?\s?с\.?/giu,
  /(?<![\p{L}\p{N}])92\s*к?вт(?![\p{L}\p{N}])/giu,
  /(?<![\p{L}\p{N}])1781\s*(?:см³|cm3|куб\.?\s?см)/giu,
  /(?<![\p{L}\p{N}])0?[1-5]v(?![\p{L}\p{N}])/giu, // коробки 01V, 01N …
];

export function findCriticalNumbers(text) {
  const hits = [];
  let clean = String(text ?? '').replace(/\{\{spec:[a-z0-9_]+\}\}/g, '');
  for (const re of DESIGNATIONS) clean = clean.replace(re, ' ');
  for (const sentence of clean.split(/(?<=[.!?;\n])\s+/)) {
    const m = CRITICAL.exec(sentence);
    if (!m) continue;
    if (SAFE_CONTEXT.test(sentence) && !/(н\s?[·*.]?\s?м|n\s?[·*.]?\s?m|бар|кпа|мпа|мм|литр|об\/мин|вольт|ом\b)/i.test(m[0])) continue;
    hits.push(m[0].trim());
  }
  return hits;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function checkSources(where, sources, problems, { required = true } = {}) {
  if (!sources || sources.length === 0) {
    if (required) problems.push(`${where}: нет источников`);
    return;
  }
  sources.forEach((s, i) => {
    if (!s.url || !/^https?:\/\//.test(s.url)) problems.push(`${where}: источник ${i + 1} без ссылки http(s)`);
    if (!s.accessed || !DATE.test(String(s.accessed))) problems.push(`${where}: источник ${i + 1} без даты обращения (ГГГГ-ММ-ДД)`);
    if (!s.applies_to) problems.push(`${where}: источник ${i + 1} без пометки, к чему относится`);
  });
}

function textFields(obj, keys) {
  return keys.flatMap((k) => (Array.isArray(obj[k]) ? obj[k] : [obj[k]])).filter(Boolean);
}

export function validateSeed(dir = paths.seed()) {
  const problems = [];
  const counts = { codes: 0, articles: 0, links: 0, maintenance: 0, parts: 0 };
  const read = (f) => (fs.existsSync(path.join(dir, f)) ? JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) : null);
  const systems = new Set((read('systems.json') ?? []).map((s) => s.slug));
  const specKeys = new Set((read('specs.json') ?? []).map((s) => s.key));

  const checkTokens = (where, text) => {
    for (const m of String(text ?? '').matchAll(/\{\{spec:([a-z0-9_]+)\}\}/g)) {
      if (!specKeys.has(m[1])) problems.push(`${where}: неизвестный параметр {{spec:${m[1]}}}`);
    }
  };

  // коды ошибок
  const codesDir = path.join(dir, 'codes');
  const seenCodes = new Set();
  if (fs.existsSync(codesDir)) {
    for (const f of fs.readdirSync(codesDir).filter((x) => x.endsWith('.json'))) {
      for (const c of JSON.parse(fs.readFileSync(path.join(codesDir, f), 'utf8'))) {
        counts.codes++;
        const w = `код ${c.code} (${f})`;
        if (seenCodes.has(c.code)) problems.push(`${w}: повторяется`);
        seenCodes.add(c.code);
        if (!c.title) problems.push(`${w}: нет названия`);
        if (c.status !== 'unverified') problems.push(`${w}: статус должен быть unverified`);
        if (c.system && !systems.has(c.system)) problems.push(`${w}: неизвестная система ${c.system}`);
        if (c.vag != null && !/^\d{5}$/.test(String(c.vag))) problems.push(`${w}: VAG-код должен быть из 5 цифр`);
        checkSources(w, c.sources, problems);
        for (const t of textFields(c, ['title', 'description', 'causes', 'checks'])) {
          checkTokens(w, t);
          for (const hit of findCriticalNumbers(t)) problems.push(`${w}: похоже на критичную цифру «${hit}»`);
        }
      }
    }
  }

  // статьи
  const artDir = path.join(dir, 'articles');
  if (fs.existsSync(artDir)) {
    for (const f of fs.readdirSync(artDir).filter((x) => x.endsWith('.md'))) {
      counts.articles++;
      const w = `статья ${f}`;
      let parsed;
      try { parsed = parseArticle(fs.readFileSync(path.join(artDir, f), 'utf8')); } catch (e) { problems.push(`${w}: заголовок не разобрать (${e.message})`); continue; }
      if (!parsed) { problems.push(`${w}: нет YAML-заголовка`); continue; }
      const { meta, body } = parsed;
      if (!meta.title) problems.push(`${w}: нет title`);
      if (meta.status !== 'unverified') problems.push(`${w}: статус должен быть unverified`);
      if (meta.system && !systems.has(meta.system)) problems.push(`${w}: неизвестная система ${meta.system}`);
      checkSources(w, meta.sources, problems);
      checkTokens(w, body);
      for (const hit of findCriticalNumbers(body)) problems.push(`${w}: похоже на критичную цифру «${hit}»`);
    }
  }

  // ссылки
  for (const l of read('links.json') ?? []) {
    counts.links++;
    if (!/^https?:\/\//.test(l.url ?? '')) problems.push(`ссылка «${l.title}»: плохой адрес`);
  }

  // регламент (интервалы — не из памяти: без источника значение недопустимо)
  for (const m of read('maintenance.json') ?? []) {
    counts.maintenance++;
    const w = `регламент ${m.key}`;
    if (m.status !== 'unverified') problems.push(`${w}: статус должен быть unverified`);
    if (m.interval_km != null || m.interval_months != null) checkSources(w, m.sources, problems);
  }

  // электросхемы: только ссылка + описание своими словами
  const schDir = path.join(dir, 'schemes');
  const seenUrls = new Set();
  counts.schemes = 0;
  if (fs.existsSync(schDir)) {
    for (const f of fs.readdirSync(schDir).filter((x) => x.endsWith('.json'))) {
      for (const s of JSON.parse(fs.readFileSync(path.join(schDir, f), 'utf8'))) {
        counts.schemes++;
        const w = `схема «${s.title}» (${f})`;
        if (!/^https?:\/\//.test(s.url ?? '')) problems.push(`${w}: плохой адрес`);
        if (seenUrls.has(s.url)) problems.push(`${w}: ссылка повторяется`);
        seenUrls.add(s.url);
        if (s.status !== 'unverified') problems.push(`${w}: статус должен быть unverified`);
        if (!s.accessed || !DATE.test(String(s.accessed))) problems.push(`${w}: нет даты обращения`);
        if (!s.applies_to) problems.push(`${w}: нет пометки, к чему относится`);
        if (s.system && !systems.has(s.system)) problems.push(`${w}: неизвестная система ${s.system}`);
        for (const hit of findCriticalNumbers(s.description)) problems.push(`${w}: похоже на критичную цифру «${hit}»`);
      }
    }
  }

  // запчасти
  for (const p of read('parts.json') ?? []) {
    counts.parts++;
    const w = `деталь ${p.oem}`;
    if (p.status !== 'unverified') problems.push(`${w}: статус должен быть unverified`);
    checkSources(w, p.sources, problems);
    for (const t of textFields(p, ['notes'])) {
      for (const hit of findCriticalNumbers(t)) problems.push(`${w}: похоже на критичную цифру «${hit}»`);
    }
  }
  return { problems, counts };
}
