// Копия всего архива в один ZIP: node src/cli/backup.js [путь\к\файлу.zip]
import path from 'node:path';
import { openDb, closeDb } from '../db.js';
import { paths } from '../config.js';
import { exportArchive, stamp } from '../lib/archive.js';

const out = path.resolve(process.argv[2] ?? path.join(paths.backups(), `archive-${stamp()}.zip`));
const db = openDb();
try {
  const res = await exportArchive(db, out);
  console.log(`Готово: ${out}`);
  console.log(`Файлов: ${res.files}, размер: ${(res.bytes / 1048576).toFixed(1)} МБ`);
  if (res.missing.length) console.log(`Внимание: на диске не найдено файлов: ${res.missing.length}`);
} catch (e) {
  console.error('Не удалось создать копию:', e.message);
  process.exitCode = 1;
} finally {
  closeDb();
}
