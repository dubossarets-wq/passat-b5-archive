// Раздача файлов и превью, просмотр PDF, а также служебные обработчики:
// отметка «проверено мной» и добавление/удаление источников у любого факта.
import fs from 'node:fs';
import { getDb } from '../db.js';
import { h, today } from '../lib/html.js';
import { page, pageTitle, backLink } from '../views/layout.js';
import { absFile, absThumb, makeThumb, isInlineMime, isImage, deleteFile } from '../lib/files.js';
import { go, safeBack } from '../lib/web.js';
import { txt } from '../lib/html.js';

const STATUS_TABLES = {
  article: 'articles', code: 'dtc_codes', maintenance: 'maintenance_items', part: 'parts',
  document: 'documents', spec: 'specs', link: 'links',
};
const SOURCE_OWNERS = new Set(['maintenance', 'article', 'code', 'part']);

function contentDisposition(kind, name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function sendFileWithRange(req, reply, abs, mime, disposition) {
  const stat = fs.statSync(abs);
  reply.header('Accept-Ranges', 'bytes');
  reply.header('Content-Type', mime);
  reply.header('Content-Disposition', disposition);
  reply.header('Cache-Control', 'private, max-age=3600');
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (m && (m[1] || m[2])) {
    let start = m[1] === '' ? Math.max(0, stat.size - Number(m[2])) : Number(m[1]);
    let end = m[1] === '' || m[2] === '' ? stat.size - 1 : Math.min(Number(m[2]), stat.size - 1);
    if (start > end || start >= stat.size) {
      return reply.code(416).header('Content-Range', `bytes */${stat.size}`).send();
    }
    reply.code(206).header('Content-Range', `bytes ${start}-${end}/${stat.size}`).header('Content-Length', end - start + 1);
    return reply.send(fs.createReadStream(abs, { start, end }));
  }
  reply.header('Content-Length', stat.size);
  return reply.send(fs.createReadStream(abs));
}

export default function register(app) {
  app.get('/files/:id', async (req, reply) => {
    const db = getDb();
    const f = db.prepare('SELECT * FROM files WHERE id = ?').get(Number(req.params.id));
    if (!f) return reply.callNotFound();
    const abs = absFile(f.rel_path);
    if (!fs.existsSync(abs)) return reply.callNotFound();
    const inline = isInlineMime(f.mime) && !req.query.download;
    return sendFileWithRange(req, reply, abs, inline ? f.mime : 'application/octet-stream', contentDisposition(inline ? 'inline' : 'attachment', f.orig_name));
  });

  app.get('/thumbs/:id', async (req, reply) => {
    const db = getDb();
    const f = db.prepare('SELECT * FROM files WHERE id = ?').get(Number(req.params.id));
    if (!f) return reply.callNotFound();
    let thumb = absThumb(f.id);
    if (!fs.existsSync(thumb) && isImage(f.mime)) thumb = (await makeThumb(db, f)) ?? thumb;
    if (fs.existsSync(thumb)) return sendFileWithRange(req, reply, thumb, 'image/jpeg', 'inline');
    // Превью сделать не удалось (например, HEIC) — отдаём оригинал, если браузер его покажет.
    const abs = absFile(f.rel_path);
    if (isInlineMime(f.mime) && fs.existsSync(abs)) return sendFileWithRange(req, reply, abs, f.mime, 'inline');
    return reply.callNotFound();
  });

  app.get('/view/:id', async (req, reply) => {
    const db = getDb();
    const f = db.prepare('SELECT * FROM files WHERE id = ?').get(Number(req.params.id));
    if (!f) return reply.callNotFound();
    if (f.mime !== 'application/pdf') return reply.redirect(`/files/${f.id}`);
    const back = f.owner_kind === 'document' ? `/docs/${f.owner_id}` : f.owner_kind === 'record' ? `/journal/${f.owner_id}` : '/docs';
    return reply.html(page({
      title: f.orig_name,
      active: 'menu',
      body: h`${backLink(back, 'Назад')}
<h1 style="font-size:20px">${f.orig_name}</h1>
<div class="pdfbar">
<button class="btn small ghost" type="button" id="pdf-zoom-out" aria-label="Уменьшить">−</button>
<button class="btn small ghost" type="button" id="pdf-zoom-in" aria-label="Увеличить">+</button>
<span id="pdf-info" class="muted">Загрузка…</span>
<a class="btn small ghost" href="/files/${f.id}?download=1">Скачать</a>
</div>
<div id="pdf-scroll" style="overflow-x:auto"><div id="pdf-pages" data-src="/files/${f.id}"></div></div>
<p id="pdf-error" class="msg err" hidden></p>
<script type="module" src="/static/pdfviewer.js"></script>`,
    }));
  });

  app.post('/files/:id/delete', async (req, reply) => {
    const db = getDb();
    deleteFile(db, Number(req.params.id));
    return go(reply, safeBack(req.body?.back, '/'), 'Файл удалён');
  });

  app.post('/status', async (req, reply) => {
    const db = getDb();
    const { kind, id, value, back } = req.body ?? {};
    const table = STATUS_TABLES[kind];
    if (!table || !['verified', 'unverified'].includes(value)) return reply.code(400).send('Неверный запрос');
    db.prepare(`UPDATE ${table} SET status = ? WHERE id = ?`).run(value, Number(id));
    return go(reply, safeBack(back, '/'), value === 'verified' ? 'Отмечено: проверено мной' : 'Отметка снята');
  });

  app.post('/sources', async (req, reply) => {
    const db = getDb();
    const b = req.body ?? {};
    const back = safeBack(b.back, '/');
    if (!SOURCE_OWNERS.has(b.owner_kind)) return reply.code(400).send('Неверный запрос');
    const url = txt(b.url);
    if (!url || !/^https?:\/\//i.test(url)) return go(reply, back, 'Нужна ссылка, начинающаяся с http:// или https://');
    db.prepare('INSERT INTO sources (owner_kind, owner_id, url, title, accessed, applies_to, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(b.owner_kind, Number(b.owner_id), url, txt(b.title), today(), txt(b.applies_to), txt(b.note));
    return go(reply, back, 'Источник добавлен');
  });

  app.post('/sources/:id/delete', async (req, reply) => {
    getDb().prepare('DELETE FROM sources WHERE id = ?').run(Number(req.params.id));
    return go(reply, safeBack(req.body?.back, '/'), 'Источник удалён');
  });
}
