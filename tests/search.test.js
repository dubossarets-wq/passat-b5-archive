// Поиск по справочнику: тот же код, что работает в браузере (public/js/searchcore.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, tx } from '../src/db.js';
import { stem, normPart } from '../public/js/stem.js';
import { runSearch, highlight } from '../public/js/searchcore.js';
import { buildSearchIndex } from '../src/lib/search.js';

test('стеммер: словоформы дают одну основу', () => {
  const same = [
    ['масла', 'масло', 'масле', 'маслом'],
    ['фильтр', 'фильтра', 'фильтры', 'фильтров'],
    ['свеча', 'свечи', 'свечей', 'свечах'],
    ['ремень', 'ремня', 'ремни', 'ремней'],
    ['замена', 'замены', 'заменил', 'заменить', 'замене'],
    ['жидкость', 'жидкости', 'жидкостью'],
    ['двигатель', 'двигателя', 'двигателе'],
  ];
  for (const group of same) {
    const stems = new Set(group.map(stem));
    assert.equal(stems.size, 1, `${group.join(', ')} → ${[...stems].join(', ')}`);
  }
});

test('стеммер не трогает коды и номера', () => {
  assert.equal(stem('P0102'), 'p0102');
  assert.equal(stem('06A115561B'), '06a115561b');
  assert.equal(normPart('06A 115-561.b'), '06A115561B');
});

function fixtureIndex() {
  const db = openDb();
  tx(db, () => {
    db.prepare("INSERT INTO systems (id, slug, name) VALUES (1, 'intake_exhaust', 'Впуск и выпуск'), (2, 'electrical', 'Электрика и свет')").run();
    db.prepare("INSERT INTO dtc_codes (id, code, vag, system_id, title, description, causes) VALUES (1, 'P0102', '16486', 1, 'Расходомер воздуха: низкий сигнал', 'Блок видит слишком слабый сигнал от расходомера', '[\"Подсос воздуха после ДМРВ\"]')").run();
    db.prepare("INSERT INTO articles (id, title, system_id, body_md) VALUES (1, 'Охлаждение: типовые проблемы', 1, 'Термостат и помпа часто выходят из строя. Колодок это не касается, ошибок нет.')").run();
    db.prepare("INSERT INTO parts (id, oem, oem_norm, name) VALUES (1, '06A 115 561 B', '06A115561B', 'Фильтр масляный')").run();
    db.prepare("INSERT INTO part_analogs (part_id, brand, number, number_norm) VALUES (1, 'MANN-FILTER', 'W 719/45', 'W71945')").run();
    db.prepare("INSERT INTO schemes (id, title, url, system_id, kind, description) VALUES (1, 'Распиновка разъёма фары', 'https://example.org/a', 2, 'pinout', 'Какие провода идут к фаре и корректору')").run();
    db.prepare("INSERT INTO maintenance_items (id, key, name, note) VALUES (1, 'oil', 'Моторное масло и масляный фильтр', 'Интервал по сервисной книжке')").run();
    db.prepare("INSERT INTO links (id, title, url, description) VALUES (1, 'Ross-Tech Wiki', 'https://wiki.ross-tech.com', 'Справочник кодов VAG')").run();
  });
  return buildSearchIndex(db);
}

test('индекс содержит все разделы справочника', () => {
  const kinds = new Set(fixtureIndex().map((d) => d.k));
  assert.deepEqual([...kinds].sort(), ['article', 'code', 'link', 'maintenance', 'part', 'scheme']);
});

test('поиск по коду ошибки, VAG-коду и словам в другой форме', () => {
  const idx = fixtureIndex();
  for (const q of ['P0102', 'p0102', '16486', 'расходомера', 'подсос воздуха']) {
    assert.ok(runSearch(idx, q).some((d) => d.k === 'code'), q);
  }
  assert.ok(runSearch(idx, 'термостата').some((d) => d.k === 'article'));
  assert.ok(runSearch(idx, 'фары').some((d) => d.k === 'scheme'));
  assert.ok(runSearch(idx, 'масла').some((d) => d.k === 'maintenance'));
});

test('беглая гласная: колодки/колодок, ошибка/ошибок находятся друг по другу', () => {
  const idx = fixtureIndex();
  assert.ok(runSearch(idx, 'колодки').some((d) => d.k === 'article'));
  assert.ok(runSearch(idx, 'ошибка').some((d) => d.k === 'article'));
});

test('номер детали находится в любой записи: с пробелами, дефисами и слитно, и по аналогу', () => {
  const idx = fixtureIndex();
  for (const q of ['06A115561B', '06A 115 561 B', '06a-115-561-b', '06A115', 'W 719/45', 'MANN']) {
    assert.ok(runSearch(idx, q).some((d) => d.k === 'part'), q);
  }
});

test('фильтр по разделу, пустой и мусорный запрос', () => {
  const idx = fixtureIndex();
  assert.ok(runSearch(idx, 'фильтр', { kind: 'part' }).every((d) => d.k === 'part'));
  assert.deepEqual(runSearch(idx, ''), []);
  assert.deepEqual(runSearch(idx, '   !!! '), []);
  assert.doesNotThrow(() => runSearch(idx, '"масло" OR * ( ) NEAR'));
});

test('заголовок важнее текста: совпадение в заголовке выше', () => {
  const idx = fixtureIndex();
  const res = runSearch(idx, 'фильтр');
  assert.equal(res[0].k, 'part'); // «Фильтр масляный» — в заголовке
});

test('подсветка находит слово в другой форме и экранирует HTML', () => {
  assert.match(highlight('Замена масла и фильтра', 'масло'), /<mark>масла<\/mark>/);
  const out = highlight('<script>alert(1)</script> масло', 'масло');
  assert.ok(!out.includes('<script>'));
  assert.match(out, /&lt;script&gt;/);
});
