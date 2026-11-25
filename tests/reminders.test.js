import test from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, daysBetween, computeReminder, STATUS } from '../src/lib/reminders.js';

const base = { soonKm: 1000, soonDays: 30 };

test('addMonths: обычный случай и переход через год', () => {
  assert.equal(addMonths('2025-03-15', 12), '2026-03-15');
  assert.equal(addMonths('2025-11-10', 3), '2026-02-10');
  assert.equal(addMonths('2025-12-31', 1), '2026-01-31');
});

test('addMonths: конец месяца, если такого числа нет', () => {
  assert.equal(addMonths('2025-01-31', 1), '2025-02-28');
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29'); // високосный год
  assert.equal(addMonths('2025-08-31', 6), '2026-02-28');
  assert.equal(addMonths('2025-05-31', 1), '2025-06-30');
});

test('daysBetween считает дни, в том числе через границы месяцев', () => {
  assert.equal(daysBetween('2025-01-01', '2025-01-31'), 30);
  assert.equal(daysBetween('2025-02-28', '2025-03-01'), 1);
  assert.equal(daysBetween('2025-03-01', '2025-02-28'), -1);
  assert.equal(daysBetween('2024-02-28', '2024-03-01'), 2);
});

test('нет интервалов — «интервал не задан»', () => {
  const r = computeReminder({ intervalKm: null, intervalMonths: null, last: { date: '2025-01-01', km: 1000 }, currentKm: 5000, today: '2025-06-01', ...base });
  assert.equal(r.status, STATUS.NO_INTERVAL);
});

test('нет записи о последней замене — «нет данных»', () => {
  const r = computeReminder({ intervalKm: 10000, intervalMonths: 12, last: null, currentKm: 5000, today: '2025-06-01', ...base });
  assert.equal(r.status, STATUS.NO_DATA);
});

test('по пробегу: в норме, скоро, просрочено, граничные значения', () => {
  const mk = (currentKm) => computeReminder({
    intervalKm: 10000, intervalMonths: null, last: { date: '2025-01-01', km: 100000 }, currentKm, today: '2025-01-02', ...base,
  });
  assert.equal(mk(105000).status, STATUS.OK); // осталось 5000
  assert.equal(mk(109000).status, STATUS.SOON); // осталось ровно 1000 — порог включительно
  assert.equal(mk(108999).status, STATUS.OK); // осталось 1001
  assert.equal(mk(110000).status, STATUS.SOON); // осталось 0 — срок сегодня, ещё не просрочено
  assert.equal(mk(110001).status, STATUS.OVERDUE);
  const r = mk(110500);
  assert.equal(r.dueKm, 110000);
  assert.equal(r.remainingKm, -500);
  assert.equal(r.basis, 'km');
});

test('по дате: в норме, скоро, просрочено, граничные значения', () => {
  const mk = (today) => computeReminder({
    intervalKm: null, intervalMonths: 12, last: { date: '2025-01-15', km: null }, currentKm: null, today, ...base,
  });
  assert.equal(mk('2025-06-01').status, STATUS.OK);
  assert.equal(mk('2025-12-16').status, STATUS.SOON); // осталось 30 дней
  assert.equal(mk('2025-12-15').status, STATUS.OK); // осталось 31 день
  assert.equal(mk('2026-01-15').status, STATUS.SOON); // срок сегодня
  assert.equal(mk('2026-01-16').status, STATUS.OVERDUE);
  const r = mk('2026-02-01');
  assert.equal(r.dueDate, '2026-01-15');
  assert.equal(r.remainingDays, -17);
  assert.equal(r.basis, 'date');
});

test('оба срока: побеждает худший', () => {
  // по пробегу в норме, по дате просрочено
  const a = computeReminder({
    intervalKm: 15000, intervalMonths: 12, last: { date: '2024-01-10', km: 100000 }, currentKm: 105000, today: '2025-03-01', ...base,
  });
  assert.equal(a.status, STATUS.OVERDUE);
  assert.equal(a.basis, 'date');
  // по дате в норме, по пробегу просрочено
  const b = computeReminder({
    intervalKm: 15000, intervalMonths: 24, last: { date: '2025-01-10', km: 100000 }, currentKm: 116000, today: '2025-03-01', ...base,
  });
  assert.equal(b.status, STATUS.OVERDUE);
  assert.equal(b.basis, 'km');
  // по пробегу скоро, по дате в норме
  const c = computeReminder({
    intervalKm: 15000, intervalMonths: 24, last: { date: '2025-01-10', km: 100000 }, currentKm: 114500, today: '2025-03-01', ...base,
  });
  assert.equal(c.status, STATUS.SOON);
  assert.equal(c.basis, 'km');
});

test('пороги настраиваются', () => {
  const r = computeReminder({
    intervalKm: 10000, intervalMonths: null, last: { date: '2025-01-01', km: 0 }, currentKm: 8000, today: '2025-02-01', soonKm: 3000, soonDays: 30,
  });
  assert.equal(r.status, STATUS.SOON);
});

test('в последней записи нет пробега: считаем только по дате', () => {
  const r = computeReminder({
    intervalKm: 10000, intervalMonths: 12, last: { date: '2025-01-01', km: null }, currentKm: 200000, today: '2025-06-01', ...base,
  });
  assert.equal(r.status, STATUS.OK);
  assert.equal(r.dueKm, null);
  assert.equal(r.basis, 'date');
});

test('только интервал в км, а пробега в записи нет — «нет данных»', () => {
  const r = computeReminder({
    intervalKm: 10000, intervalMonths: null, last: { date: '2025-01-01', km: null }, currentKm: 200000, today: '2025-06-01', ...base,
  });
  assert.equal(r.status, STATUS.NO_DATA);
});
