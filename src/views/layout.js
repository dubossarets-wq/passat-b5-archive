import { h, raw, str } from '../lib/html.js';
import { icon } from '../lib/icons.js';

// Цветовые шкалы Radix Colors: серая (slate), акцент (blue) и смысловые цвета для статусов.
const RADIX_COLORS = ['slate', 'blue', 'red', 'amber', 'green'];

// Разделы справочника: путь, название, иконка.
export const SECTIONS = [
  ['/', 'Главная', 'home'],
  ['/codes', 'Коды ошибок', 'codes'],
  ['/kb', 'База знаний', 'kb'],
  ['/schemes', 'Электросхемы', 'schemes'],
  ['/parts', 'Запчасти', 'parts'],
  ['/maintenance', 'Регламент ТО', 'maintenance'],
  ['/links', 'Ссылки', 'links'],
];

// Нижнее меню на телефоне.
const TABS = [
  { id: 'home', href: '/', label: 'Главная', icon: 'home' },
  { id: 'search', href: '/search', label: 'Поиск', icon: 'search' },
  { id: 'codes', href: '/codes', label: 'Коды', icon: 'codes' },
  { id: 'menu', href: '/menu', label: 'Разделы', icon: 'menu' },
];

/**
 * Полная HTML-страница. Телефон: нижнее меню. Компьютер (от 900 px): боковая панель слева.
 * @param {{title:string, body:*, active?:string}} o  active — id вкладки нижнего меню
 */
export function page({ title, body, active = '' }) {
  return str(h`<!doctype html>
<html lang="ru" data-base="/">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light">
<meta name="theme-color" content="#ffffff">
<title>${title} · Passat B5</title>
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/static/radix/base.css">
${RADIX_COLORS.map((c) => h`<link rel="stylesheet" href="/static/radix/colors/${c}.css">`)}
<link rel="stylesheet" href="/static/app.css">
</head>
<body class="radix-themes has-side" data-accent-color="blue" data-gray-color="slate" data-radius="medium" data-scaling="100%" data-has-background="true">
<aside class="side" aria-label="Разделы">
<a class="brand" href="/">VW Passat B5<small>1.8 20V · ARG · справочник</small></a>
<form method="get" action="/search" class="side-search" role="search"><input type="search" name="q" placeholder="Поиск по справочнику" aria-label="Поиск по справочнику"></form>
<nav>${SECTIONS.map(([href, label, ic]) => h`<a href="${href}">${icon(ic)}${label}</a>`)}</nav>
</aside>
<main class="wrap">
${body}
</main>
<nav class="tabs" aria-label="Основное меню">${TABS.map((n) => h`<a href="${n.href}" class="${n.id === active ? 'on' : ''}">${icon(n.icon, { size: '1.4em' })}<span>${n.label}</span></a>`)}</nav>
<script src="/static/app.js" defer></script>
</body>
</html>`);
}

export const pageTitle = (text, extra = '') => h`<header class="top"><h1>${text}</h1>${extra}</header>`;

export function backLink(href, label = 'Назад') {
  return h`<p class="back"><a href="${href}">← ${label}</a></p>`;
}

export { raw };
