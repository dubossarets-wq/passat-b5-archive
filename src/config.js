import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Каталог данных можно переопределить (в тестах), по умолчанию — data внутри проекта.
export function dataDir() {
  return process.env.ARCHIVE_DATA_DIR ? path.resolve(process.env.ARCHIVE_DATA_DIR) : path.join(ROOT, 'data');
}

export const paths = {
  root: ROOT,
  data: () => dataDir(),
  db: () => path.join(dataDir(), 'archive.db'),
  files: () => path.join(dataDir(), 'files'),
  thumbs: () => path.join(dataDir(), 'thumbs'),
  backups: () => path.join(dataDir(), 'backups'),
  tmp: () => path.join(ROOT, 'tmp'),
  seed: () => path.join(ROOT, 'seed'),
  public: () => path.join(ROOT, 'public'),
};

export const config = {
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || '0.0.0.0',
  // Включить, когда приложение будет за HTTPS (этап 3): cookie получит флаг Secure.
  secureCookies: process.env.SECURE_COOKIES === '1',
  sessionDays: 30,
  maxUploadBytes: 200 * 1024 * 1024,
  backupsToKeep: 10,
};
