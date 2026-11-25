// Данные о машине, пробеге и расчёт напоминаний по базе.
import { getSetting } from '../db.js';
import { computeReminder, STATUS_ORDER } from './reminders.js';
import { today } from './html.js';

export const getVehicle = (db) => db.prepare('SELECT * FROM vehicle ORDER BY id LIMIT 1').get();

// Текущий пробег — последнее показание по дате (при равенстве дат — последнее добавленное).
export function currentOdometer(db, vehicleId = 1) {
  return db.prepare('SELECT km, date FROM odometer WHERE vehicle_id = ? ORDER BY date DESC, id DESC LIMIT 1').get(vehicleId) ?? null;
}

export const currency = (db) => getSetting(db, 'currency', 'RUB');

// Показание пробега, связанное с записью журнала: создать, обновить или удалить.
export function syncOdometer(db, recordId) {
  const r = db.prepare('SELECT id, vehicle_id, date, odometer_km FROM records WHERE id = ?').get(recordId);
  db.prepare('DELETE FROM odometer WHERE record_id = ?').run(recordId);
  if (r && r.odometer_km != null) {
    db.prepare('INSERT INTO odometer (vehicle_id, date, km, record_id) VALUES (?, ?, ?, ?)').run(r.vehicle_id, r.date, r.odometer_km, r.id);
  }
}

export function lastRecordFor(db, itemId) {
  return db.prepare(
    `SELECT r.id, r.date, r.odometer_km AS km, r.title
     FROM record_items ri JOIN records r ON r.id = ri.record_id
     WHERE ri.maintenance_item_id = ?
     ORDER BY r.date DESC, r.id DESC LIMIT 1`,
  ).get(itemId) ?? null;
}

export function getReminders(db, { onlyActive = true, now = today() } = {}) {
  const cur = currentOdometer(db);
  const soonKm = Number(getSetting(db, 'soon_km', '1000'));
  const soonDays = Number(getSetting(db, 'soon_days', '30'));
  const items = db.prepare(
    `SELECT m.*, s.name AS system_name FROM maintenance_items m LEFT JOIN systems s ON s.id = m.system_id
     ${onlyActive ? 'WHERE m.active = 1' : ''} ORDER BY m.sort, m.name`,
  ).all();
  const list = items.map((m) => {
    const last = lastRecordFor(db, m.id);
    const r = computeReminder({
      intervalKm: m.interval_km,
      intervalMonths: m.interval_months,
      last: last ? { date: last.date, km: last.km } : null,
      currentKm: cur?.km ?? null,
      today: now,
      soonKm,
      soonDays,
    });
    return { item: m, last, ...r };
  });
  list.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  return { list, currentKm: cur?.km ?? null, soonKm, soonDays };
}
