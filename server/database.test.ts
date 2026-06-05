import Database from "better-sqlite3";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initSchema } from "./database";

describe("database schema", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("creates all required tables", () => {
    initSchema(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(["runs", "agents", "tool_calls", "agent_chips", "raw_events"])
    );
  });

  it("accepts inserting and querying a run", () => {
    initSchema(db);
    db.prepare("INSERT INTO runs (started_at) VALUES (?)").run("2026-06-04T00:00:00Z");
    const run = db.prepare("SELECT * FROM runs").get() as any;
    expect(run).toBeTruthy();
    expect(run.status).toBe("running");
  });

  it("accepts inserting and querying an agent with FK to run", () => {
    initSchema(db);
    const { lastInsertRowid } = db.prepare("INSERT INTO runs (started_at) VALUES (?)").run("2026-06-04T00:00:00Z");
    db.prepare("INSERT INTO agents (id, run_id, label, agent_type, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("tool_1", lastInsertRowid, "Test Agent", "test", "2026-06-04T00:00:00Z", "2026-06-04T00:00:00Z");
    const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get("tool_1") as any;
    expect(agent).toBeTruthy();
    expect(agent.run_id).toBe(lastInsertRowid);
  });
});
