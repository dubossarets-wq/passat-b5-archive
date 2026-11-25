// Восстановление из ZIP: node src/cli/restore.js путь\к\архиву.zip
// Сервер на это время должен быть остановлен.
import path from 'node:path';
import fs from 'node:fs';
import { restoreArchive } from '../lib/archive.js';
import { closeDb } from '../db.js';

const file = process.argv[2];
if (!file) {
  console.error('Укажите файл архива: restore.bat путь\\к\\архиву.zip');
  process.exit(1);
}
const abs = path.resolve(file);
if (!fs.existsSync(abs)) {
  console.error(`Файл не найден: ${abs}`);
  process.exit(1);
}
try {
  const res = await restoreArchive(abs);
  console.log(`Восстановлено. Файлов: ${res.files}. Архив создан: ${res.createdAt}`);
  console.log(`Прежние данные сохранены в: ${res.backupDir}`);
  if (res.missing.length) console.log(`Внимание: при создании архива не хватало файлов: ${res.missing.length}`);
} catch (e) {
  console.error('Не удалось восстановить:', e.message);
  process.exitCode = 1;
} finally {
  closeDb();
}
