// Сервер справочника (только чтение). Используется для просмотра на своём компьютере
// и как «печатный станок» для статического сайта (см. src/build.js).
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { paths } from './config.js';
import { page, pageTitle } from './views/layout.js';
import { h } from './lib/html.js';

import homeRoutes from './routes/home.js';
import searchRoutes from './routes/search.js';
import codesRoutes from './routes/codes.js';
import kbRoutes from './routes/kb.js';
import schemesRoutes from './routes/schemes.js';
import partsRoutes from './routes/parts.js';
import maintenanceRoutes from './routes/maintenance.js';
import linksRoutes from './routes/links.js';

const CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export function notFoundPage() {
  return page({ title: 'Не найдено', body: h`${pageTitle('Страница не найдена')}<p><a href="/">На главную</a></p>` });
}

export async function buildApp({ logger = false } = {}) {
  const app = Fastify({ logger, ignoreTrailingSlash: true });

  app.decorateReply('html', function html(markup) {
    return this.type('text/html; charset=utf-8').send(markup);
  });

  await app.register(fastifyStatic, { root: paths.public(), prefix: '/static/', maxAge: '1h' });

  // Справочник только для чтения: любые запросы, кроме GET и HEAD, отклоняются.
  app.addHook('onRequest', async (req, reply) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return reply.code(405).send('Только чтение');
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('Content-Security-Policy', CSP);
    return payload;
  });

  app.get('/favicon.ico', async (_req, reply) => reply.redirect('/static/favicon.svg'));

  for (const register of [homeRoutes, searchRoutes, codesRoutes, kbRoutes, schemesRoutes, partsRoutes, maintenanceRoutes, linksRoutes]) {
    register(app);
  }

  app.setNotFoundHandler((_req, reply) => reply.code(404).html(notFoundPage()));

  return app;
}
