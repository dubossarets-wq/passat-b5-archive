// Расчёт напоминаний по регламенту. Чистые функции — без базы и без текущей даты внутри.
//
// Правила:
//  * срок по пробегу = пробег последней записи + интервал в км;
//  * срок по дате   = дата последней записи + интервал в месяцах
//    (31 января + 1 месяц = 28/29 февраля — конец месяца, если такого числа нет);
//  * считаются оба срока, статус определяет худший из них;
//  * просрочено — остаток строго меньше нуля; «скоро» — остаток от 0 до порога включительно.

export const STATUS = {
  OVERDUE: 'overdue',
  SOON: 'soon',
  OK: 'ok',
  NO_DATA: 'nodata', // нет записи о последней замене (или нечем посчитать)
  NO_INTERVAL: 'nointerval', // интервалы не заданы
};

const RANK = { ok: 0, soon: 1, overdue: 2 };

function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? ''));
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

const pad = (n) => String(n).padStart(2, '0');

export function addMonths(dateStr, months) {
  const p = parseDate(dateStr);
  if (!p) return null;
  const total = p.m - 1 + months;
  const y = p.y + Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return `${y}-${pad(m + 1)}-${pad(Math.min(p.d, lastDay))}`;
}

// Количество дней от a до b (b позже a — положительное число).
export function daysBetween(a, b) {
  const pa = parseDate(a);
  const pb = parseDate(b);
  if (!pa || !pb) return null;
  const ua = Date.UTC(pa.y, pa.m - 1, pa.d);
  const ub = Date.UTC(pb.y, pb.m - 1, pb.d);
  return Math.round((ub - ua) / 86400000);
}

function level(remaining, soon) {
  if (remaining < 0) return 'overdue';
  if (remaining <= soon) return 'soon';
  return 'ok';
}

/**
 * @param {object} p
 * @param {number|null} p.intervalKm
 * @param {number|null} p.intervalMonths
 * @param {{date:string, km:number|null}|null} p.last  последняя запись с этой позицией
 * @param {number|null} p.currentKm                   текущий пробег
 * @param {string} p.today                            ГГГГ-ММ-ДД
 * @param {number} [p.soonKm=1000]
 * @param {number} [p.soonDays=30]
 */
export function computeReminder({ intervalKm, intervalMonths, last, currentKm, today, soonKm = 1000, soonDays = 30 }) {
  const out = {
    status: STATUS.NO_INTERVAL,
    dueKm: null,
    dueDate: null,
    remainingKm: null,
    remainingDays: null,
    basis: null,
  };
  const hasKm = intervalKm != null && intervalKm > 0;
  const hasMonths = intervalMonths != null && intervalMonths > 0;
  if (!hasKm && !hasMonths) return out;
  if (!last) return { ...out, status: STATUS.NO_DATA };

  const levels = [];
  if (hasKm && last.km != null && currentKm != null) {
    out.dueKm = last.km + intervalKm;
    out.remainingKm = out.dueKm - currentKm;
    levels.push({ basis: 'km', level: level(out.remainingKm, soonKm), margin: out.remainingKm / intervalKm });
  }
  if (hasMonths && last.date) {
    out.dueDate = addMonths(last.date, intervalMonths);
    out.remainingDays = daysBetween(today, out.dueDate);
    levels.push({ basis: 'date', level: level(out.remainingDays, soonDays), margin: out.remainingDays / (intervalMonths * 30.4) });
  }
  if (levels.length === 0) return { ...out, status: STATUS.NO_DATA };

  // Худший статус; при равенстве — тот, у которого меньше относительный запас.
  levels.sort((a, b) => RANK[b.level] - RANK[a.level] || a.margin - b.margin);
  out.status = levels[0].level;
  out.basis = levels[0].basis;
  return out;
}

export const STATUS_LABEL = {
  overdue: 'просрочено',
  soon: 'скоро',
  ok: 'в норме',
  nodata: 'нет данных',
  nointerval: 'интервал не задан',
};

// Порядок для сортировки: просроченное первым.
export const STATUS_ORDER = { overdue: 0, soon: 1, nodata: 2, ok: 3, nointerval: 4 };
