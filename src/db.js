// База справочника: SQLite в памяти, наполняется из seed/ при запуске (см. lib/seed.js).
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA } from './schema.js';

let current = null;

export function openDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  current = db;
  return db;
}

export function getDb() {
  return current ?? openDb();
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
