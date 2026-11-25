// Просмотр справочника на своём компьютере: node src/main.js (или start.bat).
// Данные берутся из папки seed/ при каждом запуске.
import os from 'node:os';
import { openDb } from './db.js';
import { config } from './config.js';
import { buildApp } from './server.js';
import { seedAll } from './lib/seed.js';

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      // 169.254.x.x — адрес без сети, телефону он не поможет
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push(a.address);
    }
  }
  return out;
}

const db = openDb();
const c = seedAll(db);
console.log(`Справочник: кодов ${c.codes}, статей ${c.articles}, схем ${c.schemes}, деталей ${c.parts}, ссылок ${c.links}.`);

const app = await buildApp();
try {
  await app.listen({ port: config.port, host: config.host });
} catch (e) {
  console.error(e.code === 'EADDRINUSE'
    ? `\nПорт ${config.port} уже занят. Возможно, справочник уже открыт в другом окне.`
    : `Не удалось запустить: ${e.message}`);
  process.exit(1);
}
console.log('\nСправочник открыт:');
console.log(`  на этом компьютере:  http://localhost:${config.port}`);
for (const ip of lanAddresses()) console.log(`  в домашней сети:     http://${ip}:${config.port}`);
console.log('\nОстановить: Ctrl+C.');

process.on('SIGINT', async () => { await app.close(); process.exit(0); });
