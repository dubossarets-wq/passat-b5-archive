// Показ результатов проверки по источникам и по машине владельца.
import { h } from './html.js';
import { verifyKey } from './seed.js';

const STATUS = {
  confirmed: ['v-ok', 'сверено по источникам'],
  partial: ['v-part', 'сверено частично'],
  conflict: ['v-bad', 'источники расходятся'],
  unconfirmed: ['v-none', 'не подтверждено'],
};
const FITS = { yes: ['v-ok', 'подходит вашей машине'], no: ['v-bad', 'не для вашей машины'], unknown: ['v-none', 'применимость не ясна'] };

export function getVerify(db, kind, key) {
  if (key == null) return null;
  return db.prepare('SELECT * FROM verification WHERE kind = ? AND key = ?').get(kind, verifyKey(kind, key)) ?? null;
}

// Метки статуса (для списков и заголовков).
export function verifyBadges(v) {
  if (!v) return h`<span class="badge v-none">ещё не проверено</span>`;
  const [sc, st] = STATUS[v.status] ?? STATUS.unconfirmed;
  const [fc, ft] = FITS[v.fits] ?? FITS.unknown;
  return h`<span class="badge ${sc}">${st}</span> <span class="badge ${fc}">${ft}</span>`;
}

// Блок «Проверка» на странице: что сверено и по каким ссылкам.
export function verifyBlock(v) {
  if (!v) return h`<section class="card verify"><h3>Проверка</h3><p class="muted">Ещё не проверено.</p></section>`;
  let checked = [];
  try { checked = JSON.parse(v.checked ?? '[]'); } catch { /* пусто */ }
  return h`<section class="card verify"><h3>Проверка ${verifyBadges(v)}</h3>
${v.note ? h`<p>${v.note}</p>` : ''}
${checked.length ? h`<p class="note">Сверено по: ${checked.map((u, i) => h`${i ? ', ' : ''}<a href="${u}" target="_blank" rel="noopener noreferrer">${(() => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; } })()}</a>`)}</p>` : ''}
<p class="note">Машина: Passat B5 3B, 2000 модельный год, ARG, передний привод. Сверка по открытым источникам не заменяет официальную документацию VW.</p></section>`;
}

// Короткая метка для списков: только то, что важно увидеть сразу.
export function verifyMini(v) {
  if (!v) return '';
  if (v.fits === 'no') return h` <span class="badge v-bad">не для вашей машины</span>`;
  if (v.status === 'conflict') return h` <span class="badge v-bad">источники расходятся</span>`;
  if (v.status === 'confirmed' && v.fits === 'yes') return h` <span class="badge v-ok">сверено</span>`;
  return '';
}
