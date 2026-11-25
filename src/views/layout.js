import { h, raw, str } from '../lib/html.js';

// Цветовые шкалы Radix Colors: серая (slate), акцент (blue) и смысловые цвета для статусов.
const RADIX_COLORS = ['slate', 'blue', 'red', 'amber', 'green'];

const NAV = [
  { id: 'home', href: '/', label: 'Главная' },
  { id: 'quick', href: '/journal/quick', label: '+ Запись' },
  { id: 'search', href: '/search', label: 'Поиск' },
  { id: 'menu', href: '/menu', label: 'Меню' },
];

/**
 * Полная HTML-страница.
 * @param {object} o
 * @param {string} o.title
 * @param {*} o.body       Safe-разметка
 * @param {string} [o.active]  id пункта нижнего меню
 * @param {string} [o.flash]   сообщение вверху
 * @param {boolean} [o.bare]   без нижнего меню (вход, печать)
 */
export function page({ title, body, active = '', flash = '', error = '', bare = false, printOnly = false, refresh = 0 }) {
  return str(h`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#0090ff">
<title>${title} · Passat B5</title>
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
<script src="/static/theme.js"></script>
<link rel="stylesheet" href="/static/radix/base.css">
${RADIX_COLORS.map((c) => h`<link rel="stylesheet" href="/static/radix/colors/${c}.css">`)}
<link rel="stylesheet" href="/static/app.css">
${refresh ? h`<meta http-equiv="refresh" content="${refresh}">` : ''}
</head>
<body class="radix-themes ${printOnly ? 'print-page' : ''}" data-accent-color="blue" data-gray-color="slate" data-radius="medium" data-scaling="100%" data-has-background="true">
<main class="wrap">
${error ? h`<p class="msg err" role="alert">${error}</p>` : ''}
${flash ? h`<p class="msg ok" role="status">${flash}</p>` : ''}
${body}
</main>
${bare ? '' : h`<nav class="tabs" aria-label="Основное меню">${NAV.map((n) => h`<a href="${n.href}" class="${n.id === active ? 'on' : ''}">${n.label}</a>`)}</nav>`}
<script src="/static/app.js" defer></script>
</body>
</html>`);
}

export const pageTitle = (text, extra = '') => h`<header class="top"><h1>${text}</h1>${extra}</header>`;

export function backLink(href, label = 'Назад') {
  return h`<p class="back"><a href="${href}">← ${label}</a></p>`;
}

export { raw };
