// Тема Radix: светлая или тёмная по настройке телефона/компьютера. Подключается в <head> без defer,
// чтобы страница не мигала белым при тёмной теме.
(function () {
  var media = window.matchMedia('(prefers-color-scheme: dark)');
  function apply() {
    document.documentElement.classList.toggle('dark', media.matches);
    document.documentElement.classList.toggle('light', !media.matches);
  }
  apply();
  if (media.addEventListener) media.addEventListener('change', apply);
})();
