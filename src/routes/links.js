import { getDb } from '../db.js';
import { h, raw, fmtDate, txt } from '../lib/html.js';
import { page, pageTitle, backLink } from '../views/layout.js';
import { field, textInput, selectInput, statusBadge, confirmForm } from '../lib/ui.js';
import { flash, go } from '../lib/web.js';
import { startLinkCheck, linkCheckState } from '../lib/linkcheck.js';

export const LINK_CATEGORIES = [
  ['official', 'Официальные'],
  ['reference', 'Справочники'],
  ['forum', 'Форумы'],
  ['blog', 'Бортжурналы и блоги'],
  ['catalog', 'Каталоги запчастей'],
  ['other', 'Другое'],
];

export default function register(app) {
  app.get('/links', async (req, reply) => {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM links ORDER BY title').all();
    const state = linkCheckState();
    const groups = LINK_CATEGORIES.map(([key, label]) => [label, rows.filter((l) => (LINK_CATEGORIES.some(([k]) => k === l.category) ? l.category : 'other') === key)]).filter(([, l]) => l.length);
    const bad = rows.filter((l) => l.check_result && /^(?!\d{3} OK|\d{3}: автопроверка|автопроверка|соединение сброшено)/.test(l.check_result)).length;
    return reply.html(page({
      title: 'Ссылки',
      active: 'menu',
      flash: flash(req),
      refresh: state.running ? 3 : 0,
      body: h`${backLink('/menu', 'Меню')}${pageTitle('Ссылки')}
<p class="muted">Платный доступ (например, erWin) оформляется на сайте производителя. Ничего из платных баз сюда не копируется.</p>
${state.running
        ? h`<p class="msg ok">Проверка идёт: ${state.done} из ${state.total}. Страница обновляется сама.</p>`
        : h`<form method="post" action="/links/check" class="inline"><button class="btn ghost" type="submit">Проверить, что ссылки открываются</button></form>${bad ? h` <span class="st st-overdue">не открываются: ${bad}</span>` : ''}`}
${groups.length ? groups.map(([label, list]) => h`<h2>${label}</h2><ul class="list">${list.map((l) => h`<li><div class="item">
<a class="t" href="${l.url}" target="_blank" rel="noopener noreferrer">${l.title}</a>
${l.description ? h`<span class="s">${l.description}</span>` : ''}
<span class="s">${l.applies_to ? `Относится к: ${l.applies_to} · ` : ''}${l.check_result ? h`проверено ${fmtDate(l.checked_at)}: ${l.check_result}` : 'не проверялась'}</span>
<span class="s">${l.url}</span>
<span class="actions">${confirmForm(`/links/${l.id}/delete`, 'Удалить', 'Удалить ссылку?', '', 'btn small danger')}</span></div></li>`)}</ul>`) : h`<p class="empty">Ссылок нет.</p>`}
<details><summary class="btn ghost">Добавить ссылку</summary>
<form method="post" action="/links" style="margin-top:12px">
${field('Название', textInput('title', { required: true }))}
${field('Адрес', textInput('url', { type: 'url', required: true, placeholder: 'https://' }))}
${field('Раздел', selectInput('category', LINK_CATEGORIES, 'reference'))}
${field('Описание своими словами', textInput('description'))}
${field('К чему относится', textInput('applies_to', { placeholder: 'Passat B5, ARG, …' }))}
<button class="btn block" type="submit">Добавить</button></form></details>`,
    }));
  });

  app.post('/links', async (req, reply) => {
    const db = getDb();
    const b = req.body ?? {};
    const url = txt(b.url);
    if (!txt(b.title) || !url || !/^https?:\/\//i.test(url)) return go(reply, '/links', 'Нужны название и адрес, начинающийся с http:// или https://');
    try {
      db.prepare("INSERT INTO links (title, url, category, description, applies_to, status) VALUES (?, ?, ?, ?, ?, 'unverified')")
        .run(txt(b.title), url, b.category || 'other', txt(b.description), txt(b.applies_to));
    } catch (e) {
      if (/UNIQUE/.test(e.message)) return go(reply, '/links', 'Такая ссылка уже есть');
      throw e;
    }
    return go(reply, '/links', 'Ссылка добавлена');
  });

  app.post('/links/check', async (req, reply) => {
    const started = startLinkCheck(getDb());
    return go(reply, '/links', started ? 'Проверка запущена' : 'Проверка уже идёт');
  });

  app.post('/links/:id/delete', async (req, reply) => {
    getDb().prepare('DELETE FROM links WHERE id = ?').run(Number(req.params.id));
    return go(reply, '/links', 'Ссылка удалена');
  });
}
