import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, tx } from '../src/db.js';
import { stem, normPart } from '../src/lib/stem.js';
import { indexOne, reindexAll, search, ftsQuery, removeIndex } from '../src/lib/search.js';

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

test('беглая гласная: колодки/колодок, ошибка/ошибок, масла/масел находятся друг по другу', () => {
  const db = fixture();
  db.prepare("INSERT INTO records (id, date, title, description) VALUES (10, '2025-07-01', 'Замена колодок', 'Передние колодок комплект, ошибок нет')").run();
  indexOne(db, 'record', 10);
  assert.ok(search(db, 'колодки').some((h) => h.id === 10));
  assert.ok(search(db, 'колодка').some((h) => h.id === 10));
  assert.ok(search(db, 'ошибка').some((h) => h.id === 10));
  assert.ok(search(db, 'масел').some((h) => h.kind === 'record' && h.id === 1));
});

test('стеммер не трогает коды и номера', () => {
  assert.equal(stem('P0102'), 'p0102');
  assert.equal(stem('06A115561B'), '06a115561b');
  assert.equal(normPart('06A 115-561.b'), '06A115561B');
});

function fixture() {
  const db = openDb(':memory:');
  tx(db, () => {
    db.prepare("INSERT INTO systems (id, slug, name) VALUES (1, 'lubrication', 'Смазка'), (2, 'ignition', 'Зажигание')").run();
    db.prepare("INSERT INTO records (id, date, odometer_km, title, system_id, description) VALUES (1, '2025-05-01', 200000, 'Замена масла и фильтра', 1, 'Залил полусинтетику, фильтр MANN')").run();
    db.prepare("INSERT INTO records (id, date, odometer_km, title, system_id, description) VALUES (2, '2025-06-01', 201000, 'Свечи зажигания', 2, 'Поставил новые свечи')").run();
    db.prepare("INSERT INTO documents (id, title, doc_type, tags) VALUES (1, 'Руководство по ремонту двигателя', 'manual', 'ремонт, мотор')").run();
    db.prepare("INSERT INTO files (owner_kind, owner_id, rel_path, orig_name, mime, size, sha256, text_content, text_status) VALUES ('document', 1, 'a.pdf', 'a.pdf', 'application/pdf', 10, 'x', 'Натяжитель цепи распредвалов расположен в голове блока цилиндров', 'done')").run();
    db.prepare("INSERT INTO articles (id, title, system_id, body_md) VALUES (1, 'Охлаждение: типовые проблемы', 1, 'Термостат и помпа часто выходят из строя')").run();
    db.prepare("INSERT INTO dtc_codes (id, code, vag, title, description) VALUES (1, 'P0102', '16486', 'Расходомер воздуха: низкий сигнал', 'Блок видит слишком слабый сигнал от расходомера')").run();
    db.prepare("INSERT INTO parts (id, oem, oem_norm, name) VALUES (1, '06A 115 561 B', '06A115561B', 'Фильтр масляный')").run();
    db.prepare("INSERT INTO part_analogs (part_id, brand, number, number_norm) VALUES (1, 'MANN-FILTER', 'W 719/45', 'W71945')").run();
  });
  reindexAll(db);
  return db;
}

test('поиск находит запись журнала по другой словоформе', () => {
  const db = fixture();
  const hits = search(db, 'масло');
  assert.ok(hits.some((h) => h.kind === 'record' && h.id === 1));
  const hits2 = search(db, 'заменил фильтры');
  assert.ok(hits2.some((h) => h.kind === 'record' && h.id === 1));
});

test('поиск находит документ по слову из текста внутри PDF', () => {
  const db = fixture();
  const hits = search(db, 'натяжитель распредвала');
  assert.equal(hits[0].kind, 'document');
  assert.equal(hits[0].id, 1);
  assert.match(String(hits[0].snippet), /<mark>/);
});

test('поиск по статье, коду ошибки и VAG-коду', () => {
  const db = fixture();
  assert.ok(search(db, 'термостат').some((h) => h.kind === 'article'));
  assert.ok(search(db, 'P0102').some((h) => h.kind === 'code'));
  assert.ok(search(db, 'p0102').some((h) => h.kind === 'code'));
  assert.ok(search(db, '16486').some((h) => h.kind === 'code'));
  assert.ok(search(db, 'расходомера').some((h) => h.kind === 'code'));
});

test('номер детали находится в любой записи: с пробелами, дефисами и слитно', () => {
  const db = fixture();
  for (const q of ['06A115561B', '06A 115 561 B', '06a-115-561-b', '06A115']) {
    assert.ok(search(db, q).some((h) => h.kind === 'part' && h.id === 1), q);
  }
  // номер аналога
  assert.ok(search(db, 'W 719/45').some((h) => h.kind === 'part'));
  assert.ok(search(db, 'MANN').some((h) => h.kind === 'part'));
});

test('результаты разных разделов приходят вместе, пустой запрос — пусто', () => {
  const db = fixture();
  const kinds = new Set(search(db, 'фильтр').map((h) => h.kind));
  assert.ok(kinds.has('record') && kinds.has('part'));
  assert.deepEqual(search(db, ''), []);
  assert.deepEqual(search(db, '   !!! '), []);
});

test('кавычки и спецсимволы в запросе не ломают поиск', () => {
  const db = fixture();
  assert.doesNotThrow(() => search(db, '"масло" OR * ( ) NEAR'));
  assert.ok(ftsQuery('a"b'));
});

test('индекс обновляется при изменении и удалении записи', () => {
  const db = fixture();
  db.prepare("UPDATE records SET title = 'Замена тормозных колодок', description = 'Передняя ось' WHERE id = 2").run();
  indexOne(db, 'record', 2);
  assert.ok(search(db, 'колодки').some((h) => h.kind === 'record' && h.id === 2));
  assert.ok(!search(db, 'свечи').some((h) => h.kind === 'record' && h.id === 2));
  removeIndex(db, 'record', 2);
  assert.ok(!search(db, 'колодки').some((h) => h.kind === 'record'));
});

test('подсветка экранирует HTML из текста', () => {
  const db = fixture();
  db.prepare("UPDATE records SET description = '<script>alert(1)</script> масло' WHERE id = 1").run();
  indexOne(db, 'record', 1);
  const hit = search(db, 'масло').find((h) => h.kind === 'record' && h.id === 1);
  assert.ok(!String(hit.snippet).includes('<script>'));
  assert.match(String(hit.snippet), /&lt;script&gt;/);
});
