import path from 'node:path';
import { getDb, tx, lastId } from '../db.js';
import { h, raw, fmtDate, txt } from '../lib/html.js';
import { page, pageTitle, backLink } from '../views/layout.js';
import { field, textInput, textArea, selectInput, systemSelect, statusBadge, verifyForm, fileGrid, fileLink, textStatusLabel, confirmForm, emptyState, pager } from '../lib/ui.js';
import { flash, go, readForm, discardForm, filesOfField } from '../lib/web.js';
import { commitUpload, filesOf, deleteOwnerFiles } from '../lib/files.js';
import { indexOne, removeIndex, search, DOC_TYPE_OPTIONS, docTypeLabel } from '../lib/search.js';

const PAGE_SIZE = 30;

const uploadFields = h`${field('Сфотографировать', raw('<input id="f-cam" type="file" name="files" accept="image/*" capture="environment">'))}
${field('Выбрать файлы (PDF, фото, сканы)', raw('<input id="f-files" type="file" name="files" accept="image/*,application/pdf,text/plain" multiple>'))}`;

function docForm(db, d = {}, action, withFiles) {
  return h`<form method="post" action="${action}" enctype="multipart/form-data">
${withFiles ? uploadFields : ''}
${field('Название', textInput('title', { value: d.title, required: !withFiles ? true : false }), withFiles ? 'Если оставить пустым, возьмётся имя файла.' : '')}
<div class="row">
${field('Тип', selectInput('doc_type', DOC_TYPE_OPTIONS, d.doc_type || 'other'))}
${field('Система', systemSelect(db, 'system_id', d.system_id))}
</div>
${field('Теги', textInput('tags', { value: d.tags, placeholder: 'через запятую' }))}
${field('Источник: ссылка', textInput('source_url', { value: d.source_url, type: 'url' }), 'Откуда файл. Для своих чеков и фото можно оставить пустым.')}
${field('Источник: пояснение', textInput('source_note', { value: d.source_note, placeholder: 'например, распечатка с erWin, куплено 12.03.2026' }))}
<div class="row">
${field('К чему относится', textInput('applies_to', { value: d.applies_to, placeholder: 'ARG, Passat B5, …' }))}
${field('Дата документа', textInput('doc_date', { value: d.doc_date, type: 'date' }))}
</div>
<div class="checks"><label><input type="checkbox" name="verified" value="1"${d.status === 'verified' ? raw(' checked') : ''}> Проверено мной</label></div>
<button class="btn block" type="submit">Сохранить</button>
</form>`;
}

function saveDoc(db, f, id = null, firstFileName = '') {
  const title = txt(f.title) ?? (firstFileName ? path.parse(firstFileName).name : null);
  if (!title) throw Object.assign(new Error('Укажите название'), { statusCode: 400 });
  const vals = [
    title, f.doc_type || 'other', Number(f.system_id) || null, txt(f.tags), txt(f.source_url), txt(f.source_note),
    txt(f.applies_to), txt(f.doc_date), f.verified ? 'verified' : 'unverified',
  ];
  if (id) {
    db.prepare(
      `UPDATE documents SET title = ?, doc_type = ?, system_id = ?, tags = ?, source_url = ?, source_note = ?, applies_to = ?,
       doc_date = ?, status = ? WHERE id = ?`,
    ).run(...vals, id);
    return id;
  }
  return lastId(db.prepare(
    `INSERT INTO documents (title, doc_type, system_id, tags, source_url, source_note, applies_to, doc_date, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(...vals));
}

export default function register(app) {
  app.get('/docs', async (req, reply) => {
    const db = getDb();
    const { q = '', system = '', type = '' } = req.query;
    const pg = Math.max(1, Number(req.query.page) || 1);
    const where = [];
    const params = [];
    if (system) { where.push('d.system_id = ?'); params.push(Number(system)); }
    if (type) { where.push('d.doc_type = ?'); params.push(type); }
    let hits = null;
    if (q.trim()) {
      hits = new Map(search(db, q, { kinds: ['document'], limit: 500 }).map((x) => [x.id, x]));
      where.push(`d.id IN (${hits.size ? [...hits.keys()].join(',') : '0'})`);
    }
    const rows = db.prepare(
      `SELECT d.*, s.name AS system_name,
        (SELECT id FROM files f WHERE f.owner_kind = 'document' AND f.owner_id = d.id AND f.mime LIKE 'image/%' ORDER BY f.id LIMIT 1) AS thumb_id,
        (SELECT COUNT(*) FROM files f WHERE f.owner_kind = 'document' AND f.owner_id = d.id) AS nfiles
       FROM documents d LEFT JOIN systems s ON s.id = d.system_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY d.created_at DESC, d.id DESC LIMIT ? OFFSET ?`,
    ).all(...params, PAGE_SIZE + 1, (pg - 1) * PAGE_SIZE);
    const more = rows.length > PAGE_SIZE;
    const shown = rows.slice(0, PAGE_SIZE);
    const base = `/docs?${new URLSearchParams({ q, system, type }).toString()}`;
    return reply.html(page({
      title: 'Документы',
      active: 'menu',
      flash: flash(req),
      body: h`${pageTitle('Документы', h`<a class="btn small" href="/docs/new">+ Загрузить</a>`)}
<form method="get" action="/docs" class="filter">
${textInput('q', { value: q, placeholder: 'Поиск по названию, тегам и тексту внутри PDF' })}
<div class="row">
<select name="system" data-autosubmit aria-label="Система"><option value="">Все системы</option>${db.prepare('SELECT id, name FROM systems ORDER BY sort').all().map((s) => h`<option value="${s.id}"${String(s.id) === String(system) ? raw(' selected') : ''}>${s.name}</option>`)}</select>
<select name="type" data-autosubmit aria-label="Тип"><option value="">Все типы</option>${DOC_TYPE_OPTIONS.map(([v, l]) => h`<option value="${v}"${v === type ? raw(' selected') : ''}>${l}</option>`)}</select>
</div>
<button class="btn ghost" type="submit">Найти</button>
</form>
${shown.length ? h`<ul class="list">${shown.map((d) => h`<li><a class="item" href="/docs/${d.id}"><span class="t">${d.title}</span>
<span class="s">${docTypeLabel(d.doc_type)}${d.system_name ? ` · ${d.system_name}` : ''}${d.nfiles ? ` · файлов: ${d.nfiles}` : ''}</span>
${d.tags ? h`<span class="tags">${d.tags}</span>` : ''}
${hits?.get(d.id) ? h`<span class="snip">${hits.get(d.id).snippet}</span>` : ''}
${statusBadge(d.status)}</a></li>`)}</ul>` : emptyState('Документов не найдено.', h`<p><a class="btn" href="/docs/new">Загрузить первый документ</a></p>`)}
${pager(base, pg, more)}`,
    }));
  });

  app.get('/docs/new', async (req, reply) => reply.html(page({
    title: 'Новый документ',
    active: 'menu',
    flash: flash(req),
    body: h`${backLink('/docs', 'Документы')}${pageTitle('Загрузить документ')}${docForm(getDb(), {}, '/docs', true)}`,
  })));

  app.post('/docs', async (req, reply) => {
    const db = getDb();
    const form = await readForm(req);
    const files = filesOfField(form, 'files');
    try {
      if (!files.length) {
        discardForm(form);
        return go(reply, '/docs/new', 'Выберите хотя бы один файл');
      }
      let id;
      tx(db, () => {
        id = saveDoc(db, form.fields, null, files[0].rec.origName);
        for (const { rec } of files) commitUpload(db, rec, { ownerKind: 'document', ownerId: id });
        indexOne(db, 'document', id);
      });
      return go(reply, `/docs/${id}`, 'Документ загружен. Текст из PDF извлекается в фоне, поиск по нему заработает через несколько секунд.');
    } catch (e) {
      discardForm(form);
      if (e.statusCode === 400) return go(reply, '/docs/new', e.message);
      throw e;
    }
  });

  app.get('/docs/:id', async (req, reply) => {
    const db = getDb();
    const id = Number(req.params.id);
    const d = db.prepare('SELECT d.*, s.name AS system_name FROM documents d LEFT JOIN systems s ON s.id = d.system_id WHERE d.id = ?').get(id);
    if (!d) return reply.callNotFound();
    const files = filesOf(db, 'document', id);
    const images = files.filter((f) => /^image\//.test(f.mime));
    const rest = files.filter((f) => !/^image\//.test(f.mime));
    return reply.html(page({
      title: d.title,
      active: 'menu',
      flash: flash(req),
      body: h`${backLink('/docs', 'Документы')}${pageTitle(d.title)}
<p>${statusBadge(d.status)}</p>
<dl class="kv">
<dt>Тип</dt><dd>${docTypeLabel(d.doc_type)}</dd>
<dt>Система</dt><dd>${d.system_name || '—'}</dd>
<dt>Теги</dt><dd>${d.tags || '—'}</dd>
<dt>Источник</dt><dd>${d.source_url ? h`<a href="${d.source_url}" target="_blank" rel="noopener noreferrer">${d.source_url}</a>` : ''}${d.source_note ? h`<br>${d.source_note}` : ''}${!d.source_url && !d.source_note ? '—' : ''}</dd>
<dt>Относится к</dt><dd>${d.applies_to || '—'}</dd>
<dt>Дата документа</dt><dd>${d.doc_date ? fmtDate(d.doc_date) : '—'}</dd>
<dt>Добавлен</dt><dd>${fmtDate(d.created_at)}</dd>
</dl>
<h2>Файлы</h2>
${rest.length ? h`<ul class="filelist">${rest.map((f) => h`<li>${fileLink(f)}<span class="note">${textStatusLabel[f.text_status] ?? ''}</span>
<form method="post" action="/files/${f.id}/delete" class="inline" data-confirm="Удалить файл?"><input type="hidden" name="back" value="/docs/${id}"><button class="btn small danger" type="submit">Удалить</button></form></li>`)}</ul>` : ''}
${images.length ? fileGrid(images, { deletable: true, back: `/docs/${id}` }) : ''}
${!files.length ? h`<p class="empty">Файлов нет.</p>` : ''}
<form method="post" action="/docs/${id}/files" enctype="multipart/form-data">${uploadFields}<button class="btn ghost block" type="submit">Добавить файлы</button></form>
<div class="actions"><a class="btn" href="/docs/${id}/edit">Изменить</a>${verifyForm('document', id, d.status, `/docs/${id}`)}${confirmForm(`/docs/${id}/delete`, 'Удалить', 'Удалить документ вместе с файлами?')}</div>`,
    }));
  });

  app.get('/docs/:id/edit', async (req, reply) => {
    const db = getDb();
    const d = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
    if (!d) return reply.callNotFound();
    return reply.html(page({
      title: 'Изменить документ',
      active: 'menu',
      flash: flash(req),
      body: h`${backLink(`/docs/${d.id}`, 'К документу')}${pageTitle('Изменить документ')}${docForm(db, d, `/docs/${d.id}`, false)}`,
    }));
  });

  app.post('/docs/:id', async (req, reply) => {
    const db = getDb();
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM documents WHERE id = ?').get(id)) return reply.callNotFound();
    const form = await readForm(req);
    try {
      tx(db, () => {
        saveDoc(db, form.fields, id);
        indexOne(db, 'document', id);
      });
      return go(reply, `/docs/${id}`, 'Сохранено');
    } catch (e) {
      discardForm(form);
      if (e.statusCode === 400) return go(reply, `/docs/${id}/edit`, e.message);
      throw e;
    }
  });

  app.post('/docs/:id/files', async (req, reply) => {
    const db = getDb();
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM documents WHERE id = ?').get(id)) return reply.callNotFound();
    const form = await readForm(req);
    try {
      const files = filesOfField(form, 'files');
      tx(db, () => {
        for (const { rec } of files) commitUpload(db, rec, { ownerKind: 'document', ownerId: id });
      });
      return go(reply, `/docs/${id}`, files.length ? 'Файлы добавлены' : 'Файлы не выбраны');
    } catch (e) {
      discardForm(form);
      throw e;
    }
  });

  app.post('/docs/:id/delete', async (req, reply) => {
    const db = getDb();
    const id = Number(req.params.id);
    tx(db, () => {
      deleteOwnerFiles(db, 'document', id);
      db.prepare('UPDATE specs SET source_document_id = NULL WHERE source_document_id = ?').run(id);
      db.prepare('DELETE FROM documents WHERE id = ?').run(id);
      removeIndex(db, 'document', id);
    });
    return go(reply, '/docs', 'Документ удалён');
  });
}
