import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PLANS } from './config.js';

const migration = fileURLToPath(new URL('../migrations/001_init.sql', import.meta.url));

export function openDatabase(path = process.env.DB_PATH || './aster-meter.db') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
  db.exec(readFileSync(migration, 'utf8'));
  const insert = db.prepare('INSERT INTO plans (id, api_call_limit, token_limit) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET api_call_limit=excluded.api_call_limit, token_limit=excluded.token_limit');
  for (const [id, plan] of Object.entries(PLANS)) insert.run(id, plan.apiCalls, plan.tokens);
  return db;
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
