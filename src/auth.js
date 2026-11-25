// Вход по паролю — необязательный. Пока пароль не задан, архив открыт без входа.
// Включить пароль можно в настройках в любой момент (понадобится, когда архив окажется на сервере).
// Пароль хранится только как scrypt-хеш, сессии — случайные токены в cookie (в базе их хеш).
import crypto from 'node:crypto';
import { getDb, getSetting } from './db.js';
import { config } from './config.js';
import { h } from './lib/html.js';
import { page, pageTitle } from './views/layout.js';
import { field, textInput } from './lib/ui.js';

export const MIN_PASSWORD = 8;
export const CURRENCIES = ['RUB', 'BYN', 'UAH', 'KZT', 'EUR', 'USD', 'PLN', 'GEL', 'MDL'];

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  if (!stored) return false;
  const [kind, saltB64, hashB64] = String(stored).split('$');
  if (kind !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function createSession(db) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const exp = new Date(now.getTime() + config.sessionDays * 86400000);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now.toISOString());
  db.prepare('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)').run(sha(token), now.toISOString(), exp.toISOString());
  return { token, expires: exp };
}

export function sessionValid(db, token) {
  if (!token) return false;
  const row = db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(sha(token));
  return Boolean(row && row.expires_at > new Date().toISOString());
}

export function destroySessions(db, exceptToken = null) {
  if (exceptToken) db.prepare('DELETE FROM sessions WHERE token_hash <> ?').run(sha(exceptToken));
  else db.exec('DELETE FROM sessions');
}

export const hasPassword = (db = getDb()) => Boolean(getSetting(db, 'password_hash'));

export function setCookie(reply, { token, expires }) {
  reply.setCookie('sid', token, {
    path: '/', httpOnly: true, sameSite: 'strict', secure: config.secureCookies, expires,
  });
}

// Ограничение частоты неудачных входов (по адресу клиента).
const attempts = new Map();
function lockedFor(ip) {
  const a = attempts.get(ip);
  return a && a.until > Date.now() ? Math.ceil((a.until - Date.now()) / 1000) : 0;
}
function registerFail(ip) {
  const a = attempts.get(ip) ?? { fails: 0, until: 0 };
  a.fails += 1;
  if (a.fails >= 5) a.until = Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** (a.fails - 5));
  attempts.set(ip, a);
}
export const resetAttempts = () => attempts.clear();

const PUBLIC = [/^\/login(\?|$)/, /^\/static\//, /^\/vendor\//, /^\/favicon\.ico$/];

export function registerAuth(app) {
  app.decorateRequest('authed', false);

  app.addHook('onRequest', async (req, reply) => {
    // Защита от подделки запросов с чужих сайтов (нужна и без пароля).
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      let bad = false;
      if (origin) {
        try { bad = new URL(origin).host !== req.headers.host; } catch { bad = true; }
      }
      const sfs = req.headers['sec-fetch-site'];
      if (sfs && sfs !== 'same-origin' && sfs !== 'none') bad = true;
      if (bad) return reply.code(403).type('text/plain; charset=utf-8').send('Запрос отклонён: чужой источник.');
    }

    const db = getDb();
    const url = req.raw.url;
    if (PUBLIC.some((re) => re.test(url))) return;

    // Пароль не задан — вход не нужен.
    if (!hasPassword(db)) {
      req.authed = true;
      return;
    }
    if (!sessionValid(db, req.cookies?.sid)) {
      const next = req.method === 'GET' && url !== '/' ? `?next=${encodeURIComponent(url)}` : '';
      return reply.redirect(`/login${next}`);
    }
    req.authed = true;
  });

  const loginForm = (error = '', next = '') => page({
    title: 'Вход',
    bare: true,
    error,
    body: h`${pageTitle('Вход')}
<form method="post" action="/login">
<input type="hidden" name="next" value="${next}">
${field('Пароль', textInput('password', { type: 'password', required: true, attrs: ' autocomplete="current-password" autofocus' }))}
<button class="btn block" type="submit">Войти</button>
</form>`,
  });

  app.get('/login', async (req, reply) => {
    const db = getDb();
    if (!hasPassword(db) || sessionValid(db, req.cookies?.sid)) return reply.redirect('/');
    return reply.html(loginForm('', req.query.next ?? ''));
  });

  app.post('/login', async (req, reply) => {
    const db = getDb();
    if (!hasPassword(db)) return reply.redirect('/');
    const wait = lockedFor(req.ip);
    const next = String(req.body?.next ?? '');
    if (wait) return reply.code(429).html(loginForm(`Слишком много попыток. Подождите ${wait} с.`, next));
    if (!verifyPassword(String(req.body?.password ?? ''), getSetting(db, 'password_hash'))) {
      registerFail(req.ip);
      return reply.code(401).html(loginForm('Неверный пароль', next));
    }
    attempts.delete(req.ip);
    setCookie(reply, createSession(db));
    // Переход только на внутренние адреса.
    return reply.redirect(/^\/(?![/\\])/.test(next) ? next : '/');
  });

  app.post('/logout', async (req, reply) => {
    const db = getDb();
    const token = req.cookies?.sid;
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
    reply.clearCookie('sid', { path: '/' });
    return reply.redirect(hasPassword(db) ? '/login' : '/');
  });
}
