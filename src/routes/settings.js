import fs from 'node:fs';
import path from 'node:path';
import { getDb, getSetting, setSetting, openDb } from '../db.js';
import { h } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { page, pageTitle, backLink } from '../views/layout.js';
import { field, textInput, selectInput, confirmForm } from '../lib/ui.js';
import { flash, go, readForm, discardForm } from '../lib/web.js';
import { paths } from '../config.js';
import { CURRENCIES, hashPassword, verifyPassword, MIN_PASSWORD, destroySessions, createSession, setCookie, hasPassword } from '../auth.js';
import { exportArchive, restoreArchive, stamp } from '../lib/archive.js';
import { seedAll } from '../lib/seed.js';
import { discardUpload } from '../lib/files.js';
import { whenIdle } from '../lib/files.js';

export default function register(app) {
  app.get('/settings', async (req, reply) => {
    const db = getDb();
    const cur = getSetting(db, 'currency', 'RUB');
    const list = CURRENCIES.includes(cur) ? CURRENCIES : [cur, ...CURRENCIES];
    const protectedNow = hasPassword(db);
    const counts = {
      records: db.prepare('SELECT COUNT(*) AS n FROM records').get().n,
      files: db.prepare('SELECT COUNT(*) AS n FROM files').get().n,
      docs: db.prepare('SELECT COUNT(*) AS n FROM documents').get().n,
    };
    return reply.html(page({
      title: 'Настройки',
      active: 'menu',
      flash: flash(req),
      body: h`${backLink('/menu', 'Меню')}${pageTitle('Настройки')}
<form method="post" action="/settings">
${field('Валюта', selectInput('currency', list.map((c) => [c, c]), cur))}
<div class="row">
${field('«Скоро» за, км', textInput('soon_km', { value: getSetting(db, 'soon_km', '1000'), inputmode: 'numeric' }))}
${field('«Скоро» за, дней', textInput('soon_days', { value: getSetting(db, 'soon_days', '30'), inputmode: 'numeric' }))}
</div>
<button class="btn block" type="submit">Сохранить</button>
</form>

<h2>Резервная копия</h2>
<p>В архиве сейчас: записей журнала — ${counts.records}, документов — ${counts.docs}, файлов — ${counts.files}.</p>
<p>ZIP содержит базу и все файлы. Храните его не только на этом компьютере.</p>
<p><a class="btn" href="/settings/export">${icon('download')} Скачать весь архив (ZIP)</a></p>

<h2>Восстановление из ZIP</h2>
<p class="muted">Текущие данные не удаляются: они переносятся в папку <code>data/backups/before-restore-…</code>.</p>
<form method="post" action="/settings/import" enctype="multipart/form-data" data-confirm="Заменить текущие данные данными из архива?">
${field('Файл архива', h`<input id="f-zip" type="file" name="zip" accept=".zip,application/zip" required>`)}
<button class="btn danger block" type="submit">Восстановить</button>
</form>

<h2>Пароль</h2>
${protectedNow
        ? h`<p>Вход по паролю <b>включён</b>.</p>
<form method="post" action="/settings/password">
${field('Текущий пароль', textInput('old', { type: 'password', required: true, attrs: ' autocomplete="current-password"' }))}
${field(`Новый пароль (от ${MIN_PASSWORD} символов)`, textInput('password', { type: 'password', required: true, attrs: ' autocomplete="new-password"' }))}
${field('Новый пароль ещё раз', textInput('password2', { type: 'password', required: true, attrs: ' autocomplete="new-password"' }))}
<button class="btn ghost block" type="submit">Сменить пароль</button>
</form>
<h3 style="margin-top:18px">Отключить пароль</h3>
<form method="post" action="/settings/password/off" data-confirm="Отключить пароль? Архив станет доступен всем в вашей сети.">
${field('Текущий пароль', textInput('old', { type: 'password', required: true, attrs: ' autocomplete="current-password"' }))}
<button class="btn danger block" type="submit">Отключить пароль</button>
</form>`
        : h`<p>Пароля нет: архив открыт всем, кто подключён к вашей сети Wi-Fi. Если не хотите этого, включите пароль.</p>
<form method="post" action="/settings/password">
${field(`Пароль (от ${MIN_PASSWORD} символов)`, textInput('password', { type: 'password', required: true, attrs: ' autocomplete="new-password"' }))}
${field('Пароль ещё раз', textInput('password2', { type: 'password', required: true, attrs: ' autocomplete="new-password"' }))}
<button class="btn ghost block" type="submit">Включить пароль</button>
</form>`}

<h2>Черновики справочников</h2>
<p class="muted">Добавляет из папки seed только недостающие записи: коды, статьи, ссылки, регламент, детали. Ваши правки не затрагиваются.</p>
<form method="post" action="/settings/reseed"><button class="btn ghost block" type="submit">Догрузить черновики</button></form>

<h2>Где лежат данные</h2>
<dl class="kv"><dt>Папка данных</dt><dd><code>${paths.data()}</code></dd><dt>База</dt><dd><code>archive.db</code></dd><dt>Файлы</dt><dd><code>files/</code></dd></dl>`,
    }));
  });

  app.post('/settings', async (req, reply) => {
    const db = getDb();
    const b = req.body ?? {};
    const currency = String(b.currency ?? '').trim().slice(0, 8);
    if (currency) setSetting(db, 'currency', currency);
    const km = Number(String(b.soon_km ?? '').replace(/\s+/g, ''));
    const days = Number(b.soon_days);
    if (Number.isFinite(km) && km >= 0) setSetting(db, 'soon_km', Math.round(km));
    if (Number.isFinite(days) && days >= 0) setSetting(db, 'soon_days', Math.round(days));
    return go(reply, '/settings', 'Сохранено');
  });

  // Включить пароль (если его не было) или сменить (нужен текущий).
  app.post('/settings/password', async (req, reply) => {
    const db = getDb();
    const b = req.body ?? {};
    const had = hasPassword(db);
    if (had && !verifyPassword(String(b.old ?? ''), getSetting(db, 'password_hash'))) return go(reply, '/settings', 'Текущий пароль неверный');
    const pw = String(b.password ?? '');
    if (pw.length < MIN_PASSWORD) return go(reply, '/settings', `Пароль короче ${MIN_PASSWORD} символов`);
    if (pw !== String(b.password2 ?? '')) return go(reply, '/settings', 'Пароли не совпадают');
    setSetting(db, 'password_hash', hashPassword(pw));
    destroySessions(db);
    setCookie(reply, createSession(db)); // этот браузер остаётся внутри, остальные устройства разлогиниваются
    return go(reply, '/settings', had ? 'Пароль изменён, остальные устройства разлогинены' : 'Пароль включён. Теперь вход нужен со всех устройств.');
  });

  app.post('/settings/password/off', async (req, reply) => {
    const db = getDb();
    if (!verifyPassword(String(req.body?.old ?? ''), getSetting(db, 'password_hash'))) return go(reply, '/settings', 'Текущий пароль неверный');
    db.prepare("DELETE FROM settings WHERE key = 'password_hash'").run();
    destroySessions(db);
    reply.clearCookie('sid', { path: '/' });
    return go(reply, '/settings', 'Пароль отключён. Архив открыт без входа.');
  });

  app.post('/settings/reseed', async (req, reply) => {
    const c = seedAll(getDb());
    return go(reply, '/settings', `Добавлено: кодов ${c.codes}, статей ${c.articles}, ссылок ${c.links}, деталей ${c.parts}, позиций регламента ${c.maintenance}`);
  });

  app.get('/settings/export', async (req, reply) => {
    const db = getDb();
    await whenIdle();
    fs.mkdirSync(paths.tmp(), { recursive: true });
    const tmp = path.join(paths.tmp(), `export-${stamp()}-${Math.random().toString(36).slice(2, 8)}.zip`);
    await exportArchive(db, tmp);
    const size = fs.statSync(tmp).size;
    const stream = fs.createReadStream(tmp);
    stream.on('close', () => fs.rm(tmp, { force: true }, () => {}));
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Length', size);
    reply.header('Content-Disposition', `attachment; filename="passat-archive-${stamp()}.zip"`);
    return reply.send(stream);
  });

  app.post('/settings/import', async (req, reply) => {
    const form = await readForm(req, { maxBytes: 64 * 1024 ** 3 });
    const zip = form.files.find((f) => f.field === 'zip');
    if (!zip) {
      discardForm(form);
      return go(reply, '/settings', 'Выберите файл архива');
    }
    try {
      await whenIdle();
      const res = await restoreArchive(zip.rec.tmp);
      // Сессии в архив не попадают. Если в архиве был пароль, понадобится войти заново.
      reply.clearCookie('sid', { path: '/' });
      return go(reply, hasPassword() ? '/login' : '/', `Восстановлено: файлов ${res.files}.`);
    } catch (e) {
      return go(reply, '/settings', `Не удалось восстановить: ${e.message}`);
    } finally {
      discardUpload(zip.rec);
      discardForm(form);
      openDbIfClosed();
    }
  });
}

function openDbIfClosed() {
  try { getDb(); } catch { openDb(); }
}
