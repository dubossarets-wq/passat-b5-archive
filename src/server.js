import path from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { paths, config, ROOT } from './config.js';
import { registerAuth } from './auth.js';
import { page, pageTitle } from './views/layout.js';
import { h } from './lib/html.js';

import homeRoutes from './routes/home.js';
import vehicleRoutes from './routes/vehicle.js';
import journalRoutes from './routes/journal.js';
import maintenanceRoutes from './routes/maintenance.js';
import docsRoutes from './routes/docs.js';
import partsRoutes from './routes/parts.js';
import codesRoutes from './routes/codes.js';
import kbRoutes from './routes/kb.js';
import linksRoutes from './routes/links.js';
import specsRoutes from './routes/specs.js';
import searchRoutes from './routes/search.js';
import settingsRoutes from './routes/settings.js';
import filesRoutes from './routes/files.js';

const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export async function buildApp({ logger = false } = {}) {
  const app = Fastify({ logger, bodyLimit: 2 * 1024 * 1024 });

  app.decorateReply('html', function html(markup) {
    return this.type('text/html; charset=utf-8').send(markup);
  });

  await app.register(cookie);
  await app.register(formbody);
  await app.register(multipart, {
    // Общий потолок большой — для ZIP при восстановлении; для обычных файлов лимит config.maxUploadBytes задаётся в readForm.
    limits: { fileSize: 64 * 1024 ** 3, files: 40, fields: 200, parts: 260 },
  });
  await app.register(fastifyStatic, { root: paths.public(), prefix: '/static/', decorateReply: false, maxAge: '1h' });
  await app.register(fastifyStatic, {
    root: path.join(ROOT, 'node_modules', 'pdfjs-dist'),
    prefix: '/vendor/pdfjs/',
    decorateReply: false,
    maxAge: '7d',
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('Content-Security-Policy', CSP);
    return payload;
  });

  registerAuth(app);

  app.get('/favicon.ico', async (_req, reply) => reply.redirect('/static/favicon.svg'));

  for (const register of [
    homeRoutes, vehicleRoutes, journalRoutes, maintenanceRoutes, docsRoutes, partsRoutes,
    codesRoutes, kbRoutes, linksRoutes, specsRoutes, searchRoutes, settingsRoutes, filesRoutes,
  ]) {
    register(app);
  }

  app.setNotFoundHandler((_req, reply) => reply.code(404).html(page({
    title: 'Не найдено',
    body: h`${pageTitle('Страница не найдена')}<p><a href="/">На главную</a></p>`,
  })));

  app.setErrorHandler((err, req, reply) => {
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).html(page({
        title: 'Ошибка', error: err.code === 'FST_REQ_FILE_TOO_LARGE' ? 'Файл слишком большой' : err.message,
        body: h`${pageTitle('Не получилось')}<p><a href="javascript:history.back()">Назад</a></p>`,
      }));
    }
    req.log.error(err);
    if (!logger) console.error(err);
    return reply.code(500).html(page({
      title: 'Ошибка',
      body: h`${pageTitle('Что-то пошло не так')}<p class="msg err">${err.message}</p><p><a href="/">На главную</a></p>`,
    }));
  });

  return app;
}
