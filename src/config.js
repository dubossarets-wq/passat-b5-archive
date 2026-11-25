import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const paths = {
  root: ROOT,
  seed: () => path.join(ROOT, 'seed'),
  public: () => path.join(ROOT, 'public'),
  dist: () => path.join(ROOT, 'dist'),
};

export const config = {
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || '0.0.0.0',
};
