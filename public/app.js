// Картинка схемы не загрузилась с исходного сайта — убираем пустую рамку, ссылка на источник остаётся у записи.
document.addEventListener('error', function (e) {
  var img = e.target;
  if (img && img.tagName === 'IMG' && img.closest && img.closest('.shots')) {
    var fig = img.closest('figure');
    if (fig) fig.style.display = 'none';
  }
  // Плитка галереи с битой картинкой — убираем целиком.
  if (img && img.tagName === 'IMG' && img.closest && img.closest('.g-tile')) {
    img.closest('.g-tile').style.display = 'none';
    return;
  }
  // В превью карточки — вместо битой картинки подпись «нет фото».
  if (img && img.tagName === 'IMG' && img.closest && img.closest('.pv-box')) {
    var empty = document.createElement('span');
    empty.className = 'pv-empty';
    empty.textContent = 'нет фото';
    img.replaceWith(empty);
  }
}, true);

// Боковая панель (компьютер): подсветить раздел, в котором мы сейчас находимся.
(function () {
  var base = document.documentElement.getAttribute('data-base') || '/';
  var p = '/' + location.pathname.slice(base.length).replace(/\/$/, '');
  var best = null;
  document.querySelectorAll('.side nav a').forEach(function (a) {
    var h = '/' + a.pathname.slice(base.length).replace(/\/$/, '');
    var hit = h === '/' ? p === '/' : p === h || p.indexOf(h + '/') === 0;
    if (hit && (!best || h.length > best.h.length)) best = { a: a, h: h };
  });
  if (best) { best.a.classList.add('on'); best.a.setAttribute('aria-current', 'page'); }
})();

// Фильтр «Все / На сайте / За пределами» на странице схем (?where=site|ext).
(function () {
  var bar = document.getElementById('where-filter');
  if (!bar) return;
  var where = new URLSearchParams(location.search).get('where') || '';
  bar.querySelectorAll('a').forEach(function (a) {
    a.classList.toggle('on', (a.getAttribute('data-where') || '') === where);
  });
  if (!where) return;
  document.querySelectorAll('[data-where]').forEach(function (el) {
    if (bar.contains(el)) return;
    el.hidden = el.getAttribute('data-where') !== where;
  });
  // Скрыть заголовки разделов и групп, в которых ничего не осталось.
  var groups = Array.prototype.slice.call(document.querySelectorAll('[data-group]')).reverse();
  groups.forEach(function (g) {
    var items = g.querySelectorAll('[data-where]');
    var visible = Array.prototype.some.call(items, function (i) { return !i.hidden; });
    g.hidden = !visible;
  });
})();
