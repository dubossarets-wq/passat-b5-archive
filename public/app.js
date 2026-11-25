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
