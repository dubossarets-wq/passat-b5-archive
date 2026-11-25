import os from 'node:os';
import { openDb, closeDb } from './db.js';
import { config, paths } from './config.js';
import { buildApp } from './server.js';
import { seedIfFirstRun } from './lib/seed.js';
import { autoBackup } from './lib/archive.js';
import { reindexAll } from './lib/search.js';
import { getSetting } from './db.js';

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      // 169.254.x.x — адрес без сети, телефону он не поможет
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push(a.address);
    }
  }
  const home = (ip) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  return out.sort((a, b) => Number(home(b)) - Number(home(a)));
}

const db = openDb();
console.log(`Данные: ${paths.data()}`);

const seeded = seedIfFirstRun(db);
if (seeded) {
  console.log(`Первый запуск: загружены черновики — кодов ${seeded.codes}, статей ${seeded.articles}, ссылок ${seeded.links}, деталей ${seeded.parts}, позиций регламента ${seeded.maintenance}.`);
} else if (db.prepare('SELECT COUNT(*) AS n FROM search_fts').get().n === 0) {
  reindexAll(db);
}

try {
  autoBackup(db);
} catch (e) {
  console.error('Автокопия базы не создана:', e.message);
}

const app = await buildApp({ logger: false });

try {
  await app.listen({ port: config.port, host: config.host });
} catch (e) {
  if (e.code === 'EADDRINUSE') {
    console.error(`\nПорт ${config.port} уже занят. Возможно, архив уже запущен в другом окне.\nЧтобы запустить на другом порту: set PORT=8081 и снова start.bat`);
  } else {
    console.error('Не удалось запустить сервер:', e.message);
  }
  closeDb();
  process.exit(1);
}

console.log('\nАрхив запущен. Откройте в браузере:');
console.log(`  на этом компьютере:  http://localhost:${config.port}`);
for (const ip of lanAddresses()) console.log(`  с телефона (Wi-Fi):  http://${ip}:${config.port}`);
if (!getSetting(db, 'password_hash')) console.log('\nВход без пароля: архив открыт всем в вашей сети Wi-Fi. Пароль включается в Настройках.');
console.log('\nНе закрывайте это окно, пока работаете. Остановить: Ctrl+C.');

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  console.log('\nОстанавливаю…');
  try { await app.close(); } catch { /* ignore */ }
  closeDb();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
