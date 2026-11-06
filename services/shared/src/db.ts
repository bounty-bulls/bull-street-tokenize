/** SQLite store shared by the API and the workers (node only). WAL mode lets both processes use one file. */
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { repoRoot } from "./node";

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS world_roles (
  nullifier TEXT PRIMARY KEY, role INTEGER NOT NULL, wallet TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS broker_profiles (
  wallet TEXT PRIMARY KEY, bo_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS dep_accounts (
  bo_id TEXT PRIMARY KEY, owner_wallet TEXT, name TEXT NOT NULL, depository TEXT NOT NULL DEFAULT 'CDSL',
  standing_auto_accept INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS dep_accounts_wallet ON dep_accounts(owner_wallet);
CREATE TABLE IF NOT EXISTS dep_holdings (
  bo_id TEXT NOT NULL, isin TEXT NOT NULL, free INTEGER NOT NULL DEFAULT 0, pledged INTEGER NOT NULL DEFAULT 0,
  pledgee_balance INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (bo_id, isin)
);
CREATE TABLE IF NOT EXISTS dep_pledges (
  psn TEXT PRIMARY KEY, pledgor TEXT NOT NULL, pledgee TEXT NOT NULL, isin TEXT NOT NULL, qty INTEGER NOT NULL,
  invoked INTEGER NOT NULL DEFAULT 0, released INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL,
  agreement_no TEXT NOT NULL, exec_date TEXT NOT NULL, closure_date TEXT, guided INTEGER NOT NULL DEFAULT 0,
  process_after INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS dep_pledges_agreement ON dep_pledges(agreement_no);
CREATE INDEX IF NOT EXISTS dep_pledges_pledgee ON dep_pledges(pledgee);
CREATE TABLE IF NOT EXISTS dep_inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT, bo_id TEXT NOT NULL, ts INTEGER NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT, wallet TEXT NOT NULL, ts INTEGER NOT NULL, kind TEXT NOT NULL,
  title TEXT NOT NULL, body TEXT NOT NULL, link TEXT, ref TEXT UNIQUE, read INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS notices_wallet ON notices(wallet, ts);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  block INTEGER NOT NULL, tx TEXT NOT NULL, log_index INTEGER NOT NULL, ts INTEGER NOT NULL,
  contract TEXT NOT NULL, name TEXT NOT NULL, args TEXT NOT NULL, PRIMARY KEY (tx, log_index)
);
CREATE INDEX IF NOT EXISTS events_name ON events(name, block);
`;

let cached: DB | undefined;

/** One database per chain, so a local run never leaks depository records or events into a testnet run */
export function openDb(path = process.env.DB_PATH || `data/bullstreet-${process.env.CHAIN_ID ?? "31337"}.sqlite`): DB {
  if (cached) return cached;
  const file = isAbsolute(path) ? path : join(repoRoot, path);
  mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(SCHEMA);
  cached = db;
  return db;
}

export const now = () => Math.floor(Date.now() / 1000);

export function kvGet(db: DB, key: string): string | undefined {
  return (db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined)?.value;
}

export function kvSet(db: DB, key: string, value: string): void {
  db.prepare("INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

export function addNotice(
  db: DB,
  n: { wallet: string; kind: string; title: string; body: string; link?: string; ref?: string },
): void {
  db.prepare(
    "INSERT OR IGNORE INTO notices(wallet, ts, kind, title, body, link, ref) VALUES(?, ?, ?, ?, ?, ?, ?)",
  ).run(n.wallet.toLowerCase(), now(), n.kind, n.title, n.body, n.link ?? null, n.ref ?? null);
}
