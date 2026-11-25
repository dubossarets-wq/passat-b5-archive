import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { paths } from './config.js';
import { MIGRATIONS } from './schema.js';

let current = null;

export function openDb(file = paths.db()) {
  // Прежнее соединение закрываем: на Windows открытая база не даёт переименовать или заменить файл.
  if (file !== ':memory:') {
    closeDb();
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  current = db;
  return db;
}

export function getDb() {
  return current ?? openDb();
}

export function closeDb() {
  if (current) {
    try { current.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* уже закрыта */ }
    current.close();
    current = null;
  }
}

function migrate(db) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      if (v === 0) {
        db.exec("INSERT INTO vehicle (id, name, engine_code) VALUES (1, 'VW Passat B5', 'ARG')");
        const defaults = { currency: 'RUB', soon_km: '1000', soon_days: '30' };
        const ins = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
        for (const [k, val] of Object.entries(defaults)) ins.run(k, val);
      }
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

export function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(db, key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value == null ? null : String(value));
}

// Выполнить функцию в транзакции.
export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  }
}

export const lastId = (res) => Number(res.lastInsertRowid);
