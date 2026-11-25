import { getDb, tx, lastId } from '../db.js';
import { h, raw, fmtDate, txt } from '../lib/html.js';
import { page, pageTitle, backLink } from '../views/layout.js';
import { field, textInput, textArea, systemSelect, statusBadge, verifyForm, sourcesBlock, confirmForm, emptyState } from '../lib/ui.js';
import { flash, go } from '../lib/web.js';
import { renderMarkdown } from '../lib/markdown.js';
import { loadSpecMap, findSpecKeys, specIsFilled } from '../lib/specs.js';
import { indexOne, removeIndex, search } from '../lib/search.js';

function articleForm(db, a = {}, action, preview = null) {
  return h`<form method="post" action="${action}">
${field('Заголовок', textInput('title', { value: a.title, required: true }))}
<div class="row">${field('Система', systemSelect(db, 'system_id', a.system_id))}${field('К чему относится', textInput('applies_to', { value: a.applies_to, placeholder: 'ARG, Passat B5, …' }))}</div>
${field('Текст (Markdown)', textArea('body_md', a.body_md, 18), 'Пересказ своими словами, ссылки на источники ставьте в конце. Критичные цифры не пишите: вставляйте {{spec:ключ}} (список ключей — в разделе «Критичные параметры»).')}
${preview ? h`<h2>Предпросмотр</h2><article class="card md">${preview}</article>` : ''}
<div class="actions"><button class="btn" type="submit" name="action" value="save">Сохранить</button><button class="btn ghost" type="submit" name="action" value="preview">Предпросмотр</button></div>
</form>`;
}

export default function register(app) {
  app.get('/kb', async (req, reply) => {
    const db = getDb();
    const { q = '', system = '' } = req.query;
    const where = [];
    const params = [];
    if (system) { where.push('a.system_id = ?'); params.push(Number(system)); }
    let hits = null;
    if (q.trim()) {
      hits = new Map(search(db, q, { kinds: ['article'], limit: 300 }).map((x) => [x.id, x]));
      where.push(`a.id IN (${hits.size ? [...hits.keys()].join(',') : '0'})`);
    }
    const rows = db.prepare(
      `SELECT a.id, a.title, a.status, a.applies_to, s.name AS system_name, s.sort FROM articles a LEFT JOIN systems s ON s.id = a.system_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.sort, a.title`,
    ).all(...params);
    const groups = new Map();
    for (const r of rows) {
      const k = r.system_name || 'Без системы';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    return reply.html(page({
      title: 'База знаний',
      active: 'menu',
      flash: flash(req),
      body: h`${pageTitle('База знаний', h`<a class="btn small" href="/kb/new">+ Статья</a>`)}
<form method="get" action="/kb" class="filter">
${textInput('q', { value: q, placeholder: 'Поиск по статьям' })}
<select name="system" data-autosubmit aria-label="Система"><option value="">Все системы</option>${db.prepare('SELECT id, name FROM systems ORDER BY sort').all().map((s) => h`<option value="${s.id}"${String(s.id) === String(system) ? raw(' selected') : ''}>${s.name}</option>`)}</select>
<button class="btn ghost" type="submit">Найти</button>
</form>
<p class="muted">Статей: ${rows.length}. Все черновики — пересказ со ссылками на источники, статус «не проверено».</p>
${rows.length ? [...groups].map(([name, items]) => h`<h2>${name}</h2><ul class="list">${items.map((a) => h`<li><a class="item" href="/kb/${a.id}"><span class="t">${a.title}</span><span class="s">${a.applies_to || ''}</span>${hits?.get(a.id) ? h`<span class="snip">${hits.get(a.id).snippet}</span>` : ''}${statusBadge(a.status)}</a></li>`)}</ul>`) : emptyState('Статей не найдено.')}`,
    }));
  });

  app.get('/kb/new', async (req, reply) => reply.html(page({
    title: 'Новая статья',
    active: 'menu',
    flash: flash(req),
    body: h`${backLink('/kb', 'База знаний')}${pageTitle('Новая статья')}${articleForm(getDb(), {}, '/kb')}`,
  })));

  app.post('/kb', async (req, reply) => {
    const db = getDb();
    const b = req.body ?? {};
    if (!txt(b.title)) return go(reply, '/kb/new', 'Укажите заголовок');
    if (b.action === 'preview') {
      return reply.html(page({
        title: 'Новая статья', active: 'menu',
        body: h`${backLink('/kb', 'База знаний')}${pageTitle('Новая статья')}${articleForm(db, { ...b, system_id: Number(b.system_id) || null }, '/kb', renderMarkdown(b.body_md ?? '', loadSpecMap(db)))}`,
      }));
    }
    let id;
    tx(db, () => {
      id = lastId(db.prepare("INSERT INTO articles (title, system_id, body_md, applies_to, status) VALUES (?, ?, ?, ?, 'unverified')")
        .run(txt(b.title), Number(b.system_id) || null, String(b.body_md ?? ''), txt(b.applies_to)));
      indexOne(db, 'article', id);
    });
    return go(reply, `/kb/${id}`, 'Статья добавлена');
  });

  app.get('/kb/:id', async (req, reply) => {
    const db = getDb();
    const id = Number(req.params.id);
    const a = db.prepare('SELECT a.*, s.name AS system_name FROM articles a LEFT JOIN systems s ON s.id = a.system_id WHERE a.id = ?').get(id);
    if (!a) return reply.callNotFound();
    const specs = loadSpecMap(db);
    const keys = [...new Set(findSpecKeys(a.body_md))];
    const sources = db.prepare("SELECT * FROM sources WHERE owner_kind = 'article' AND owner_id = ? ORDER BY id").all(id);
    const back = `/kb/${id}`;
    return reply.html(page({
      title: a.title,
      active: 'menu',
      flash: flash(req),
      body: h`${backLink('/kb', 'База знаний')}${pageTitle(a.title)}
<p>${statusBadge(a.status)} <span class="muted">${a.system_name || ''}${a.applies_to ? ` · относится к: ${a.applies_to}` : ''} · обновлено ${fmtDate(a.updated_at)}</span></p>
<article class="md">${renderMarkdown(a.body_md, specs)}</article>
${keys.length ? h`<section class="card"><h3>Критичные параметры из статьи</h3><ul class="plain">${keys.map((k) => {
        const s = specs.get(k);
        return h`<li><a href="/specs#${k}">${s?.name ?? k}</a>: ${specIsFilled(s) ? `${s.value} ${s.unit ?? ''}` : 'уточнить по официальной документации'}</li>`;
      })}</ul></section>` : ''}
${sourcesBlock(sources)}
<details><summary class="btn ghost">Добавить источник</summary>
<form method="post" action="/sources" style="margin-top:12px">
<input type="hidden" name="owner_kind" value="article"><input type="hidden" name="owner_id" value="${id}"><input type="hidden" name="back" value="${back}">
${field('Ссылка', textInput('url', { type: 'url', required: true }))}${field('Название', textInput('title'))}${field('К чему относится', textInput('applies_to'))}${field('Что пересказано', textInput('note'))}
<button class="btn block" type="submit">Добавить</button></form></details>
<div class="actions"><a class="btn" href="/kb/${id}/edit">Изменить</a>${verifyForm('article', id, a.status, back)}${confirmForm(`/kb/${id}/delete`, 'Удалить', 'Удалить статью?')}</div>`,
    }));
  });

  app.get('/kb/:id/edit', async (req, reply) => {
    const db = getDb();
    const a = db.prepare('SELECT * FROM articles WHERE id = ?').get(Number(req.params.id));
    if (!a) return reply.callNotFound();
    return reply.html(page({
      title: 'Изменить статью',
      active: 'menu',
      flash: flash(req),
      body: h`${backLink(`/kb/${a.id}`, 'К статье')}${pageTitle('Изменить статью')}${articleForm(db, a, `/kb/${a.id}`)}`,
    }));
  });

  app.post('/kb/:id', async (req, reply) => {
    const db = getDb();
    const id = Number(req.params.id);
    const b = req.body ?? {};
    if (!db.prepare('SELECT 1 FROM articles WHERE id = ?').get(id)) return reply.callNotFound();
    if (!txt(b.title)) return go(reply, `/kb/${id}/edit`, 'Укажите заголовок');
    if (b.action === 'preview') {
      return reply.html(page({
        title: 'Изменить статью', active: 'menu',
        body: h`${backLink(`/kb/${id}`, 'К статье')}${pageTitle('Изменить статью')}${articleForm(db, { ...b, id, system_id: Number(b.system_id) || null }, `/kb/${id}`, renderMarkdown(b.body_md ?? '', loadSpecMap(db)))}`,
      }));
    }
    tx(db, () => {
      db.prepare("UPDATE articles SET title = ?, system_id = ?, body_md = ?, applies_to = ?, updated_at = datetime('now') WHERE id = ?")
        .run(txt(b.title), Number(b.system_id) || null, String(b.body_md ?? ''), txt(b.applies_to), id);
      indexOne(db, 'article', id);
    });
    return go(reply, `/kb/${id}`, 'Сохранено');
  });

  app.post('/kb/:id/delete', async (req, reply) => {
    const db = getDb();
    const id = Number(req.params.id);
    tx(db, () => {
      db.prepare("DELETE FROM sources WHERE owner_kind = 'article' AND owner_id = ?").run(id);
      db.prepare('DELETE FROM articles WHERE id = ?').run(id);
      removeIndex(db, 'article', id);
    });
    return go(reply, '/kb', 'Статья удалена');
  });
}
