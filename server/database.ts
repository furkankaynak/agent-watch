import Database from "better-sqlite3";
import { join } from "node:path";

const DB_PATH = process.env.DB_PATH ?? join(process.cwd(), "agents-watch.db");

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initSchema(db);
  }
  return db;
}

export function initSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      started_at TEXT NOT NULL,
      ended_at TEXT,
      root_agent_id TEXT
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      run_id INTEGER NOT NULL REFERENCES runs(id),
      label TEXT NOT NULL,
      agent_type TEXT NOT NULL,
      model TEXT,
      description TEXT,
      parent_agent_id TEXT REFERENCES agents(id),
      conversation_id TEXT,
      status TEXT NOT NULL DEFAULT 'incoming',
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS tool_calls (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      tool_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'started',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      duration_ms INTEGER,
      ok INTEGER,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_chips (
      agent_id TEXT NOT NULL REFERENCES agents(id),
      chip_type TEXT NOT NULL,
      chip_value TEXT NOT NULL,
      seen_at TEXT NOT NULL,
      PRIMARY KEY (agent_id, chip_type, chip_value)
    );

    CREATE TABLE IF NOT EXISTS raw_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER REFERENCES runs(id),
      line_number INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      event_type TEXT NOT NULL,
      fields TEXT NOT NULL,
      raw TEXT NOT NULL
    );
  `);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = undefined as unknown as Database.Database;
  }
}
