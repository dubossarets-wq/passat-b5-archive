// Минимум скриптов: подтверждения, автоотправка фильтров, печать, добавление строк деталей.
document.addEventListener('submit', (e) => {
  const msg = e.target.getAttribute && e.target.getAttribute('data-confirm');
  if (msg && !window.confirm(msg)) e.preventDefault();
});

document.addEventListener('change', (e) => {
  if (e.target.matches && e.target.matches('[data-autosubmit]')) e.target.form.submit();
});

document.addEventListener('click', (e) => {
  const t = e.target.closest ? e.target.closest('[data-print]') : null;
  if (t) { e.preventDefault(); window.print(); }

  const add = e.target.closest ? e.target.closest('[data-add-part]') : null;
  if (add) {
    e.preventDefault();
    const box = document.getElementById('partrows');
    const first = box.querySelector('.partrow');
    const copy = first.cloneNode(true);
    copy.querySelectorAll('input').forEach((i) => { i.value = ''; });
    box.appendChild(copy);
    const input = copy.querySelector('input[name="part_name"]');
    if (input) input.focus();
  }
});

// Показать, сколько файлов выбрано (удобно на телефоне после съёмки).
document.addEventListener('change', (e) => {
  const input = e.target;
  if (!(input.matches && input.matches('input[type=file]'))) return;
  let note = input.parentElement.querySelector('.picked');
  if (!note) {
    note = document.createElement('small');
    note.className = 'hint picked';
    input.parentElement.appendChild(note);
  }
  note.textContent = input.files.length ? `Выбрано файлов: ${input.files.length}` : '';
});
