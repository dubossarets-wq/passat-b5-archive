import { getDb } from '../db.js';
import { h } from '../lib/html.js';
import { page, pageTitle, backLink } from '../views/layout.js';
import { statusBadge, sourcesBlock, emptyState, searchBox, groupBySystem } from '../lib/ui.js';
import { renderMarkdown } from '../lib/markdown.js';
import { getVerify, verifyBadges, verifyBlock, verifyMini } from '../lib/verify.js';

export default function register(app) {
  app.get('/kb', async (req, reply) => {
    const db = getDb();
    const rows = db.prepare(
      'SELECT a.id, a.title, a.applies_to, a.seed_key, s.name AS system_name FROM articles a LEFT JOIN systems s ON s.id = a.system_id ORDER BY s.sort, a.title',
    ).all();
    return reply.html(page({
      title: 'База знаний',
      active: 'menu',
      body: h`${pageTitle('База знаний')}
${searchBox('/search', '', 'Поиск по статьям', 'article')}
<p class="muted">Типовые проблемы, диагностика и порядок работ — пересказ открытых источников со ссылками.</p>
${rows.length ? groupBySystem(rows).map(([name, list]) => h`<h2>${name}</h2><ul class="list">${list.map((a) => h`<li><a class="item" href="/kb/${a.id}"><span class="t">${a.title}</span>
<span class="s">${a.applies_to || ''}${verifyMini(getVerify(db, 'article', a.seed_key))}</span></a></li>`)}</ul>`) : emptyState('Статей нет.')}`,
    }));
  });

  app.get('/kb/:id', async (req, reply) => {
    const db = getDb();
    const a = db.prepare('SELECT a.*, s.name AS system_name FROM articles a LEFT JOIN systems s ON s.id = a.system_id WHERE a.id = ?').get(Number(req.params.id));
    if (!a) return reply.callNotFound();
    const sources = db.prepare("SELECT * FROM sources WHERE owner_kind = 'article' AND owner_id = ? ORDER BY id").all(a.id);
    return reply.html(page({
      title: a.title,
      active: 'menu',
      body: h`${backLink('/kb', 'База знаний')}${pageTitle(a.title)}
<p>${verifyBadges(getVerify(db, 'article', a.seed_key))} <span class="muted">${a.system_name || ''}${a.applies_to ? ` · относится к: ${a.applies_to}` : ''}</span></p>
<article class="md">${renderMarkdown(a.body_md)}</article>
${verifyBlock(getVerify(db, 'article', a.seed_key))}
${sourcesBlock(sources)}`,
    }));
  });
}
