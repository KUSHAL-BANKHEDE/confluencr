import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export type LedgerDatabase = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id         TEXT    PRIMARY KEY,
  name       TEXT    NOT NULL CHECK (length(trim(name)) > 0),
  balance    INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at TEXT    NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS transactions (
  id           TEXT    PRIMARY KEY,
  account_id   TEXT    NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  type         TEXT    NOT NULL CHECK (type IN ('credit', 'debit')),
  amount       INTEGER NOT NULL CHECK (amount > 0),
  description  TEXT    NOT NULL DEFAULT '',
  reference_id TEXT    NOT NULL CHECK (length(trim(reference_id)) > 0),
  created_at   TEXT    NOT NULL,
  UNIQUE (account_id, reference_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_transactions_account_created
  ON transactions (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_account_type
  ON transactions (account_id, type);

CREATE TRIGGER IF NOT EXISTS transactions_immutable_update
BEFORE UPDATE ON transactions
BEGIN
  SELECT RAISE(ABORT, 'transactions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS transactions_immutable_delete
BEFORE DELETE ON transactions
BEGIN
  SELECT RAISE(ABORT, 'transactions are immutable');
END;
`;

export function createDatabase(filename = process.env.DB_PATH ?? 'data/ledger.db'): LedgerDatabase {
  if (filename !== ':memory:') {
    mkdirSync(dirname(filename), { recursive: true });
  }

  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  if (filename !== ':memory:') {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }
  db.exec(SCHEMA);

  return db;
}
