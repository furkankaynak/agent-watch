import initSqlJs from "sql.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";

const agentsWatchRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_DB_PATH = join(agentsWatchRoot, ".db", "agents-watch.db");
const DB_PATH = process.env.DB_PATH ?? DEFAULT_DB_PATH;

const SQL = await initSqlJs();

type SqlValue = number | string | null;

class Statement {
  private db: initSqlJs.Database;
  private sql: string;
  private owner: DatabaseWrapper;

  constructor(db: initSqlJs.Database, sql: string, owner: DatabaseWrapper) {
    this.db = db;
    this.sql = sql;
    this.owner = owner;
  }

  run(...params: SqlValue[]): { changes: number; lastInsertRowid: number } {
    const stmt = this.db.prepare(this.sql);
    stmt.bind(params.length > 0 ? params : null);
    stmt.step();
    stmt.free();
    this.owner.markDirty();
    const lastInsertRowid = Number(
      (this.db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] ?? 0) as number
    );
    return {
      changes: this.db.getRowsModified(),
      lastInsertRowid,
    };
  }

  get(...params: SqlValue[]): Record<string, SqlValue> | undefined {
    const stmt = this.db.prepare(this.sql);
    stmt.bind(params.length > 0 ? params : null);
    if (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, SqlValue>;
      stmt.free();
      return row;
    }
    stmt.free();
    return undefined;
  }

  all(...params: SqlValue[]): Record<string, SqlValue>[] {
    const stmt = this.db.prepare(this.sql);
    stmt.bind(params.length > 0 ? params : null);
    const rows: Record<string, SqlValue>[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as Record<string, SqlValue>);
    }
    stmt.free();
    return rows;
  }
}

function isMemoryPath(path: string): boolean {
  return path === ":memory:" || path === ":memory";
}

export class DatabaseWrapper {
  private db: initSqlJs.Database;
  private filePath: string;
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(path: string) {
    this.filePath = path;
    if (isMemoryPath(path)) {
      this.db = new SQL.Database();
    } else {
      const dir = dirname(path);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      if (existsSync(path)) {
        const buffer = readFileSync(path);
        this.db = new SQL.Database(buffer);
      } else {
        this.db = new SQL.Database();
      }
    }
  }

  prepare(sql: string): Statement {
    return new Statement(this.db, sql, this);
  }

  exec(sql: string): void {
    this.db.exec(sql);
    this.markDirty();
  }

  pragma(str: string): void {
    if (str.startsWith("journal_mode")) return;
    this.db.exec(`PRAGMA ${str}`);
  }

  close(): void {
    this.saveNow();
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.db.close();
  }

  markDirty(): void {
    if (isMemoryPath(this.filePath)) return;
    this.dirty = true;
    if (!this.saveTimer) {
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        this.saveNow();
      }, 1000);
    }
  }

  private saveNow(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const data = this.db.export();
    writeFileSync(this.filePath, Buffer.from(data));
  }
}

export type { DatabaseWrapper as Database };

let dbInstance: DatabaseWrapper;

export function getDb(): DatabaseWrapper {
  if (!dbInstance) {
    dbInstance = new DatabaseWrapper(DB_PATH);
    dbInstance.exec("PRAGMA journal_mode = WAL");
    dbInstance.exec("PRAGMA foreign_keys = ON");
    initSchema(dbInstance);
  }
  return dbInstance;
}

export function initSchema(database: DatabaseWrapper): void {
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

function migrate(database: DatabaseWrapper): void {
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

  try {
    database.exec("ALTER TABLE raw_events ADD COLUMN workspace_root TEXT");
  } catch {
    // already exists
  }
  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_raw_events_ws ON raw_events(workspace_root)"
  );

  try {
    database.exec("ALTER TABLE runs ADD COLUMN workspace_root TEXT");
  } catch {
    // already exists
  }
  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_runs_ws ON runs(workspace_root)"
  );

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
  if (dbInstance) {
    dbInstance.close();
    dbInstance = undefined as unknown as DatabaseWrapper;
  }
}
