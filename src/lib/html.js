// Мини-шаблонизатор: тег h`...` экранирует всё, кроме значений, помеченных raw().
class Safe {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

export const raw = (s) => new Safe(s == null ? '' : String(s));

export function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function render(v) {
  if (v == null || v === false) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}

export function h(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += render(vals[i]) + strings[i + 1];
  return new Safe(out);
}

export const str = (safe) => (safe instanceof Safe ? safe.s : String(safe));

// Разбор числа из формы: пустое -> null, запятая как разделитель допускается.
export function num(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(/\s+/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function int(v) {
  const n = num(v);
  return n == null ? null : Math.round(n);
}

export const txt = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

// Форматирование даты ГГГГ-ММ-ДД -> ДД.ММ.ГГГГ
export function fmtDate(d) {
  if (!d) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(d);
}

export function fmtKm(n) {
  if (n == null || n === '') return '';
  return Number(n).toLocaleString('ru-RU').replace(/ /g, ' ') + ' км';
}

export function fmtMoney(n, currency) {
  if (n == null || n === '') return '';
  const s = Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return `${s.replace(/ /g, ' ')} ${currency || ''}`.trim();
}

export function today() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
