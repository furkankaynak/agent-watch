import { DatabaseWrapper } from "./database";
import { initSchema } from "./database";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("database schema", () => {
  let db: DatabaseWrapper;

  beforeEach(() => {
    db = new DatabaseWrapper(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("creates all required tables", () => {
    initSchema(db);
    const rows = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    expect(rows.map((t) => t.name)).toEqual(
      expect.arrayContaining(["runs", "agents", "tool_calls", "agent_chips", "raw_events", "sessions", "server_state"])
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
