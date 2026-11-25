import { getDb } from '../db.js';
import { h, fmtKm, fmtDate, today, int } from '../lib/html.js';
import { page, pageTitle } from '../views/layout.js';
import { getVehicle, currentOdometer, getReminders } from '../lib/vehicle.js';
import { reminderBadge, field, textInput } from '../lib/ui.js';
import { flash, go } from '../lib/web.js';
import { hasPassword } from '../auth.js';

// Текст «до какого пробега/даты и сколько осталось».
export function dueText(r) {
  const parts = [];
  if (r.dueKm != null) {
    const rem = r.remainingKm;
    parts.push(`${fmtKm(r.dueKm)}: ${rem < 0 ? `просрочено на ${fmtKm(-rem)}` : `осталось ${fmtKm(rem)}`}`);
  }
  if (r.dueDate != null) {
    const rem = r.remainingDays;
    parts.push(`${fmtDate(r.dueDate)}: ${rem < 0 ? `просрочено на ${-rem} дн.` : rem === 0 ? 'срок сегодня' : `через ${rem} дн.`}`);
  }
  return parts.join(' · ');
}

export function reminderCard(r) {
  return h`<div class="card">
<div class="rem"><a href="/maintenance/${r.item.id}"><b>${r.item.name}</b></a>${reminderBadge(r.status)}</div>
${r.status === 'nodata' ? h`<p class="muted">Записи о замене в журнале нет.</p>` : h`<p class="muted">${dueText(r)}</p>`}
<a class="btn small" href="/journal/new?item=${r.item.id}">Выполнено</a>
</div>`;
}

export default function register(app) {
  app.get('/', async (req, reply) => {
    const db = getDb();
    const v = getVehicle(db);
    const cur = currentOdometer(db);
    const rem = getReminders(db);
    const attention = rem.list.filter((r) => r.status === 'overdue' || r.status === 'soon');
    const nodata = rem.list.filter((r) => r.status === 'nodata').length;
    const recent = db.prepare(
      `SELECT r.id, r.date, r.title, r.odometer_km, s.name AS system_name
       FROM records r LEFT JOIN systems s ON s.id = r.system_id ORDER BY r.date DESC, r.id DESC LIMIT 5`,
    ).all();

    return reply.html(page({
      title: 'Главная',
      active: 'home',
      flash: flash(req),
      body: h`${pageTitle(v.name || 'VW Passat B5')}
<p class="muted">${[v.engine_code && `двигатель ${v.engine_code}`, v.gearbox_code && `КПП ${v.gearbox_code}`, v.model_year && `${v.model_year} г.`].filter(Boolean).join(' · ')}${!v.vin ? h` · <a href="/vehicle/edit">заполнить карточку</a>` : ''}</p>

<section class="card">
<h3>Пробег: ${cur ? fmtKm(cur.km) : 'не указан'}</h3>
${cur ? h`<p class="muted">на ${fmtDate(cur.date)}</p>` : ''}
<form method="post" action="/odometer">
${field('Новое показание, км', textInput('km', { inputmode: 'numeric', required: true, placeholder: cur ? String(cur.km) : '' }))}
<button class="btn" type="submit">Обновить пробег</button>
</form>
</section>

<div class="actions"><a class="btn" href="/journal/quick">Быстрая запись с фото</a><a class="btn ghost" href="/journal/new">Подробная запись</a></div>

<h2>Что требует внимания</h2>
${attention.length ? attention.map(reminderCard) : h`<p class="empty">${rem.list.length === 0 ? 'Регламент пуст.' : 'Просроченного и скорого нет.'}</p>`}
${nodata ? h`<p class="muted">Ещё у ${nodata} позиций регламента нет записи о последней замене: <a href="/maintenance">открыть регламент</a>.</p>` : ''}

<h2>Последние записи</h2>
${recent.length ? h`<ul class="list">${recent.map((r) => h`<li><a class="item" href="/journal/${r.id}"><span class="t">${r.title}</span><span class="s">${fmtDate(r.date)}${r.odometer_km != null ? ` · ${fmtKm(r.odometer_km)}` : ''}${r.system_name ? ` · ${r.system_name}` : ''}</span></a></li>`)}</ul>` : h`<p class="empty">Записей пока нет.</p>`}`,
    }));
  });

  app.post('/odometer', async (req, reply) => {
    const db = getDb();
    const km = int(req.body?.km);
    if (km == null || km < 0 || km > 5_000_000) return go(reply, '/', 'Введите пробег числом');
    const cur = currentOdometer(db);
    if (cur && km < cur.km) {
      return go(reply, '/', `Пробег меньше прошлого показания (${fmtKm(cur.km)}). Если ошиблись в прошлый раз, исправьте запись на странице машины.`);
    }
    db.prepare('INSERT INTO odometer (vehicle_id, date, km) VALUES (1, ?, ?)').run(today(), km);
    return go(reply, '/', 'Пробег обновлён');
  });

  app.get('/menu', async (req, reply) => {
    const items = [
      ['/journal', 'Журнал работ'],
      ['/maintenance', 'Регламент и напоминания'],
      ['/docs', 'Документы'],
      ['/parts', 'Запчасти'],
      ['/codes', 'Коды ошибок'],
      ['/events', 'История ошибок на моей машине'],
      ['/kb', 'База знаний'],
      ['/specs', 'Критичные параметры'],
      ['/links', 'Ссылки'],
      ['/vehicle', 'Карточка машины'],
      ['/print', 'Печать и PDF'],
      ['/settings', 'Настройки, копия и восстановление'],
    ];
    return reply.html(page({
      title: 'Меню',
      active: 'menu',
      flash: flash(req),
      body: h`${pageTitle('Меню')}
<nav class="menu">${items.map(([href, label]) => h`<a href="${href}">${label}</a>`)}</nav>
${hasPassword() ? h`<form method="post" action="/logout" style="margin-top:20px"><button class="btn ghost" type="submit">Выйти</button></form>` : ''}`,
    }));
  });
}
