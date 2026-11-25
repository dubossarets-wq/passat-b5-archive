// Черновики из seed/: правила архива (источники, статус, никаких критичных цифр) и загрузка в базу.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { validateSeed, findCriticalNumbers } from '../src/lib/seedcheck.js';
import { seedAll } from '../src/lib/seed.js';
import { search } from '../src/lib/search.js';
import { renderMarkdown } from '../src/lib/markdown.js';
import { loadSpecMap } from '../src/lib/specs.js';

test('проверка ловит критичные цифры и пропускает названия моторов', () => {
  for (const bad of ['затянуть моментом 25 Н·м', 'давление 3,5 бар', 'залить 4.5 л масла', 'зазор 0.8 мм', 'сопротивление 5 кОм', 'угол 12°', '850 об/мин']) {
    assert.ok(findCriticalNumbers(bad).length > 0, bad);
  }
  for (const ok of ['мотор 1.8 20V, 125 л.с., 92 кВт', 'коробка 01V', 'блок 01, группа 98', 'цилиндр 3', 'момент: {{spec:timing_marks}}', 'датчик G62']) {
    assert.deepEqual(findCriticalNumbers(ok), [], ok);
  }
});

test('черновики соблюдают правила: источники с датой, статус «не проверено», без критичных цифр', () => {
  const { problems, counts } = validateSeed();
  assert.deepEqual(problems, []);
  assert.ok(counts.codes >= 100, `кодов: ${counts.codes}`);
  assert.ok(counts.articles >= 16, `статей: ${counts.articles}`);
  assert.ok(counts.links >= 20, `ссылок: ${counts.links}`);
  assert.equal(counts.maintenance, 11);
});

test('черновики загружаются в базу, повторная загрузка ничего не дублирует, поиск работает', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO systems (slug, name, sort) VALUES ('x', 'x', 0)").run();
  const first = seedAll(db);
  assert.ok(first.codes >= 100);
  assert.ok(first.articles >= 16);
  assert.ok(first.specs >= 30);
  const second = seedAll(db);
  assert.deepEqual([second.codes, second.articles, second.links, second.parts, second.maintenance, second.specs], [0, 0, 0, 0, 0, 0]);

  // всё загруженное — «не проверено», у кодов и статей есть источники
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM dtc_codes WHERE status <> 'unverified'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM articles WHERE status <> 'unverified'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM dtc_codes c WHERE NOT EXISTS (SELECT 1 FROM sources s WHERE s.owner_kind = 'code' AND s.owner_id = c.id)").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM articles a WHERE NOT EXISTS (SELECT 1 FROM sources s WHERE s.owner_kind = 'article' AND s.owner_id = a.id)").get().n, 0);

  // критичные параметры заведены, но значений нет (их вносит только владелец, с источником)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM specs WHERE value IS NOT NULL').get().n, 0);

  // известный код находится по P-коду и по VAG-коду
  const row = db.prepare("SELECT code, vag FROM dtc_codes WHERE vag IS NOT NULL AND code GLOB 'P[0-9]*' ORDER BY code LIMIT 1").get();
  assert.ok(search(db, row.code).some((h) => h.kind === 'code'));
  assert.ok(search(db, row.vag).some((h) => h.kind === 'code'));
});

test('метки {{spec:…}} в статьях без значения показывают «уточнить по официальной документации»', () => {
  const db = openDb(':memory:');
  seedAll(db);
  const withSpec = db.prepare("SELECT body_md FROM articles WHERE body_md LIKE '%{{spec:%' LIMIT 1").get();
  if (!withSpec) return; // в черновиках может не быть ни одной метки
  const html = String(renderMarkdown(withSpec.body_md, loadSpecMap(db)));
  assert.match(html, /уточнить по официальной документации/);
  assert.doesNotMatch(html, /\{\{spec:/);
});
