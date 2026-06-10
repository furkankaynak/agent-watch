import Database from "better-sqlite3";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, existsSync } from "node:fs";

const agentsWatchRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_DB_PATH = join(agentsWatchRoot, ".db", "agents-watch.db");
const DB_PATH = process.env.DB_PATH ?? DEFAULT_DB_PATH;

function ensureDbDir(): void {
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    ensureDbDir();
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
      root_agent_id TEXT,
      workspace_root TEXT
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
      completed_at TEXT,
      workspace_root TEXT
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
      raw TEXT NOT NULL,
      conversation_id TEXT,
      workspace_root TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      conversation_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'active',
      started_at TEXT NOT NULL,
      ended_at TEXT,
      model TEXT,
      cursor_version TEXT,
      workspace_roots TEXT
    );

    CREATE TABLE IF NOT EXISTS server_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agents_run_status ON agents(run_id, status);
    CREATE INDEX IF NOT EXISTS idx_agents_conversation ON agents(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_agent_status ON tool_calls(agent_id, status);
    CREATE INDEX IF NOT EXISTS idx_raw_events_ws ON raw_events(workspace_root);
    CREATE INDEX IF NOT EXISTS idx_raw_events_conversation ON raw_events(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_runs_ws ON runs(workspace_root);
    CREATE INDEX IF NOT EXISTS idx_agents_ws ON agents(workspace_root);
  `);

  migrate(database);
}

function migrate(database: Database.Database): void {
  // migrate: conversation_id
  try {
    database.exec("ALTER TABLE raw_events ADD COLUMN conversation_id TEXT");
  } catch {
    // already exists
  }
  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_raw_events_conversation ON raw_events(conversation_id)"
  );
  database.exec(
    `UPDATE raw_events
     SET conversation_id = json_extract(fields, '$.conversation_id')
     WHERE conversation_id IS NULL`
  );

  // migrate: workspace_root on raw_events
  try {
    database.exec("ALTER TABLE raw_events ADD COLUMN workspace_root TEXT");
  } catch {
    // already exists
  }
  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_raw_events_ws ON raw_events(workspace_root)"
  );

  // migrate: workspace_root on runs
  try {
    database.exec("ALTER TABLE runs ADD COLUMN workspace_root TEXT");
  } catch {
    // already exists
  }
  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_runs_ws ON runs(workspace_root)"
  );

  // migrate: workspace_root on agents
  try {
    database.exec("ALTER TABLE agents ADD COLUMN workspace_root TEXT");
  } catch {
    // already exists
  }
  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_agents_ws ON agents(workspace_root)"
  );
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = undefined as unknown as Database.Database;
  }
}
