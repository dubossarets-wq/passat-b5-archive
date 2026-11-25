import { h, raw, str } from '../lib/html.js';
import { icon } from '../lib/icons.js';

// Цветовые шкалы Radix Colors: серая (slate), акцент (blue) и смысловые цвета для статусов.
const RADIX_COLORS = ['slate', 'blue', 'red', 'amber', 'green'];

// Нижнее меню на телефоне: четыре крупные кнопки под большой палец.
const NAV = [
  { id: 'home', href: '/', label: 'Главная', icon: 'home' },
  { id: 'quick', href: '/journal/quick', label: 'Запись', icon: 'plus' },
  { id: 'search', href: '/search', label: 'Поиск', icon: 'search' },
  { id: 'menu', href: '/menu', label: 'Меню', icon: 'menu' },
];

// Боковая панель на компьютере и страница «Меню»: все разделы. Третье поле — иконка.
export const SIDE_ITEMS = [
  ['/', 'Главная', 'home'],
  ['/journal', 'Журнал работ', 'journal'],
  ['/maintenance', 'Регламент', 'maintenance'],
  ['/docs', 'Документы', 'docs'],
  ['/parts', 'Запчасти', 'parts'],
  ['/codes', 'Коды ошибок', 'codes'],
  ['/events', 'История ошибок', 'events'],
  ['/kb', 'База знаний', 'kb'],
  ['/specs', 'Критичные параметры', 'specs'],
  ['/links', 'Ссылки', 'links'],
  ['/vehicle', 'Карточка машины', 'vehicle'],
  ['/print', 'Печать и PDF', 'print'],
  ['/settings', 'Настройки', 'settings'],
];
export const ICON_FOR = Object.fromEntries(SIDE_ITEMS.map(([href, , ic]) => [href, ic]));

/**
 * Полная HTML-страница. Телефон: нижнее меню. Компьютер (от 900 px): боковая панель слева.
 * @param {object} o
 * @param {string} o.title
 * @param {*} o.body       Safe-разметка
 * @param {string} [o.active]  id пункта нижнего меню
 * @param {string} [o.flash]   сообщение вверху
 * @param {boolean} [o.bare]   без меню (вход, печать)
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
<body class="radix-themes ${printOnly ? 'print-page' : ''} ${bare ? '' : 'has-side'}" data-accent-color="blue" data-gray-color="slate" data-radius="medium" data-scaling="100%" data-has-background="true">
${bare ? '' : h`<aside class="side" aria-label="Разделы">
<a class="brand" href="/">VW Passat B5<small>1.8 20V · ARG</small></a>
<form method="get" action="/search" class="side-search" role="search"><input type="search" name="q" placeholder="Поиск по архиву" aria-label="Поиск по архиву"></form>
<a class="btn block" href="/journal/quick">${icon('camera')} Быстрая запись</a>
<nav>${SIDE_ITEMS.map(([href, label, ic]) => h`<a href="${href}">${icon(ic)}${label}</a>`)}</nav>
</aside>`}
<main class="wrap">
${error ? h`<p class="msg err" role="alert">${error}</p>` : ''}
${flash ? h`<p class="msg ok" role="status">${flash}</p>` : ''}
${body}
</main>
${bare ? '' : h`<nav class="tabs" aria-label="Основное меню">${NAV.map((n) => h`<a href="${n.href}" class="${n.id === active ? 'on' : ''}">${icon(n.icon, { size: '1.4em' })}<span>${n.label}</span></a>`)}</nav>`}
<script src="/static/app.js" defer></script>
</body>
</html>`);
}

export const pageTitle = (text, extra = '') => h`<header class="top"><h1>${text}</h1>${extra}</header>`;

export function backLink(href, label = 'Назад') {
  return h`<p class="back"><a href="${href}">← ${label}</a></p>`;
}

export { raw };
