import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS envelopes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  sender_name TEXT NOT NULL DEFAULT '',
  sender_email TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  sent_at TEXT,
  completed_at TEXT,
  completed_sha256 TEXT
);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  envelope_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  name TEXT NOT NULL,
  pages INTEGER NOT NULL,
  sha256 TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS signers (
  id TEXT PRIMARY KEY,
  envelope_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL,
  signed_at TEXT,
  signed_ip TEXT,
  token_hash TEXT,
  token_expires_at TEXT,
  viewed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS fields (
  id TEXT PRIMARY KEY,
  envelope_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  signer_id TEXT NOT NULL,
  page INTEGER NOT NULL,
  x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL,
  rot INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1,
  label TEXT NOT NULL DEFAULT '',
  value TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  envelope_id TEXT NOT NULL,
  signer_id TEXT,
  type TEXT NOT NULL,
  at TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS documents_env ON documents(envelope_id, idx);
CREATE INDEX IF NOT EXISTS signers_env ON signers(envelope_id, idx);
CREATE INDEX IF NOT EXISTS signers_token ON signers(token_hash);
CREATE INDEX IF NOT EXISTS fields_env ON fields(envelope_id);
CREATE INDEX IF NOT EXISTS events_env ON events(envelope_id, id);
`;

export function openDb(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'pdfview.db'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(SCHEMA);
  return {
    raw: db,
    run: (sql, ...p) => db.prepare(sql).run(...p),
    get: (sql, ...p) => db.prepare(sql).get(...p),
    all: (sql, ...p) => db.prepare(sql).all(...p),
    tx(fn) {
      db.exec('BEGIN');
      try {
        const r = fn();
        db.exec('COMMIT');
        return r;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    }
  };
}
