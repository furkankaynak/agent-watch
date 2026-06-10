# SQLite Persistence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace in-memory file-tail state with SQLite-backed persistence, add session-based run navigation, and fix agent hierarchy tracking.

**Architecture:** Server tails activity.log → parses → INSERTs into SQLite (raw_events + derived agent/tool/run state) → serves via HTTP API (snapshot + SSE). Frontend adds run-aware hooks and session sidebar.

**Tech Stack:** Node.js, `better-sqlite3`, React, Vite, SSE

---

### Task 1: Install better-sqlite3 & create database module

**Files:**
- Modify: `package.json`
- Create: `server/database.ts`
- Test: `server/database.test.ts`

**Step 1: Install dependency**

Run: `npm install better-sqlite3` and `npm install --save-dev @types/better-sqlite3`

Expected: packages added to package.json

**Step 2: Write failing test for database.ts**

```typescript
// server/database.test.ts
import Database from "better-sqlite3";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("database schema", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("creates all required tables", () => {
    // To be implemented
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(["runs", "agents", "tool_calls", "agent_chips", "raw_events"])
    );
  });
});
```

Run: `npx vitest run server/database.test.ts`
Expected: FAIL

**Step 3: Implement database module**

```typescript
// server/database.ts
import Database from "better-sqlite3";
import path from "path";

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "agents-watch.db");

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

function initSchema(database: Database.Database): void {
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
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run server/database.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add package.json package-lock.json server/database.ts server/database.test.ts
git commit -m "feat: add better-sqlite3 database module with schema"
```

---

### Task 2: Create event processor

**Files:**
- Create: `server/eventProcessor.ts`
- Test: `server/eventProcessor.test.ts`

This is the core of the change. The event processor reads LogEvent[] and updates SQLite tables.

**Key logic:**

```
onEvent(event):
  INSERT INTO raw_events (run_id, line_number, timestamp, event_type, fields, raw)

  switch event.eventType:
    case "tool_start":
      if tool_name == "Task":
        detectRun() -> creates run if needed
        INSERT agent (incoming, link parent via binding)
      else:
        findBoundAgent() -> INSERT tool_call (started), UPDATE agent last_seen_at

    case "subagent_start":
      find agent by subagent_id -> UPDATE label/type/model/status=running
      if no conversation_id yet, add to FIFO queue

    case "tool_done":
      UPDATE tool_call (ok, duration, status)
      UPDATE agent (status=idle/failed, last_seen_at)

    case "skill_read"|"rule_read"|"decisions_read":
      bindConversation() if needed
      INSERT OR IGNORE agent_chips
      UPDATE agent (last_seen_at)

    case "session_end":
      bindConversation() if needed
      UPDATE agent status based on final_status
      if root agent, UPDATE run status

    default:
      bindConversation() if needed
      UPDATE agent (last_seen_at)
```

**Conversation binding (fixes the FIFO gap):**

The FIFO binding logic is the same as today's reducer (`bindConversationIfNeeded`), but persisted in SQLite:

1. Keep track of `last_seen_conversation_id` per agent
2. When a new conversation_id appears (first time in event), bind it to the agent that produced the last subagent_start
3. Store the binding in agent.conversation_id

Implementation: maintain a `conversation_bindings` in-memory map (or a SQLite table) mapping `conversation_id:generation_id` → agent_id.

**Step 1: Write failing test**

```typescript
// server/eventProcessor.test.ts
import Database from "better-sqlite3";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { LogEvent } from "../src/shared/logTypes";
import { processEvent } from "./eventProcessor";

describe("eventProcessor", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    // init schema
    db.exec(`CREATE TABLE IF NOT EXISTS runs (...)`);
    // ...full schema
  });

  it("creates an agent on tool_start Task", () => {
    const event: LogEvent = {
      lineNumber: 1,
      timestamp: "2026-06-04T01:38:44.985Z",
      eventType: "tool_start",
      fields: {
        tool_name: "Task",
        tool_use_id: "tool_1",
        input_subagent_type: "orchestrator",
        input_description: "Feature X"
      },
      raw: "..."
    };
    processEvent(db, event);
    const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get("tool_1") as any;
    expect(agent).toBeTruthy();
    expect(agent.agent_type).toBe("orchestrator");
    expect(agent.status).toBe("incoming");
  });
});
```

**Step 2-4:** Implement `processEvent` with all event handlers, run tests to pass.

**Step 5: Commit**

```bash
git add server/eventProcessor.ts server/eventProcessor.test.ts
git commit -m "feat: add SQLite event processor with run detection and agent tracking"
```

---

### Task 3: Update server routes for SQLite

**Files:**
- Modify: `server/index.ts`
- Test: manual / curl

**Changes to server/index.ts:**

1. Import `getDb()` and `processEvent()` at the top
2. On server start: open DB via `getDb()`
3. `/api/snapshot`:
   - Query raw_events from SQLite (all or since a given id)
   - Return `{ events: [...], lastEventId: number }`
   - Support `?run_id=X` and `?since=Y` params
4. New `/api/runs`:
   - `SELECT id, label, status, started_at, ended_at FROM runs ORDER BY id DESC`
   - Returns run list for sidebar
5. `/api/events` SSE:
   - Poll SQLite for new raw_events since client's `lastEventId`
   - Stream as SSE events (same format as today)
6. File polling loop:
   - Read new lines from log → parse → call `processEvent(db, parsedEvent)` for each
   - The SSE polling reads from SQLite, not from the in-memory buffer

**Key implementation detail — event streaming:**

```typescript
// SSE endpoint — poll SQLite every 1s
app.get("/api/events", (req, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  let lastId = parseInt(req.query.since as string) || 0;

  const interval = setInterval(() => {
    const rows = db.prepare(
      "SELECT id, timestamp, event_type, fields, raw FROM raw_events WHERE id > ? ORDER BY id"
    ).all(lastId);
    for (const row of rows) {
      res.write(`id: ${row.id}\nevent: activity\ndata: ${JSON.stringify(row)}\n\n`);
      lastId = row.id;
    }
    res.write(": ping\n\n");
  }, 1000);

  req.on("close", () => clearInterval(interval));
});
```

**Step 1:** Modify server/index.ts with imports and new routes
**Step 2:** Run `npm run dev:server` and verify `/api/health` responds
**Step 3:** Verify `/api/runs` returns JSON array
**Step 4:** Verify `/api/snapshot` returns events from DB
**Step 5:** Commit

---

### Task 4: Server restart persistence

**Files:**
- Modify: `server/index.ts`

**Logic:**

On server start:
1. Open SQLite database
2. Query `SELECT COALESCE(MAX(id), 0) as lastEventId FROM raw_events`
3. Also query `SELECT line_number FROM raw_events WHERE id = lastEventId` to get last line processed
4. Initialize file cursor at `offset = lastEventOffset` (or 0 if none)
5. Resume tailing from that point
6. Any lines already in the DB are not re-processed

If the file was rotated/deleted:
- The existing log file cursor validation still handles rotation
- If file is new, cursor resets to 0 and continues

**No re-processing of old events.** The server resumes from where it left off.

---

### Task 5: Create useRuns frontend hook

**Files:**
- Create: `src/hooks/useRuns.ts`
- Test: `src/hooks/useRuns.test.ts`

```typescript
// src/hooks/useRuns.ts
type Run = {
  id: number;
  label: string | null;
  status: "running" | "completed" | "failed";
  started_at: string;
  ended_at: string | null;
};

export function useRuns(): {
  runs: Run[];
  selectedRunId: number | null;
  setSelectedRunId: (id: number | null) => void;
  activeRunId: number | null;
  loading: boolean;
} {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/runs")
      .then((res) => res.json())
      .then((data: Run[]) => {
        setRuns(data);
        const active = data.find((r) => r.status === "running");
        setSelectedRunId((prev) => prev ?? active?.id ?? data[0]?.id ?? null);
        setLoading(false);
      });
  }, []);

  const activeRunId = runs.find((r) => r.status === "running")?.id ?? null;

  return { runs, selectedRunId, setSelectedRunId, activeRunId, loading };
}
```

---

### Task 6: Update useWorkflowStream for run-aware snapshot + SSE

**Files:**
- Modify: `src/hooks/useWorkflowStream.ts`

**Changes:**
- Accept `runId` parameter
- Snapshot: `fetch("/api/snapshot?run_id=" + runId)` → returns events for that run
- SSE: `EventSource("/api/events?run_id=" + runId)` → streams events for that run
- When runId changes, re-fetch snapshot and reset state

The existing reducer logic (`applyWorkflowEvent`, `selectAgents`) stays the same.

---

### Task 7: Create SessionSidebar component

**Files:**
- Create: `src/components/SessionSidebar.tsx`

```typescript
// SessionSidebar.tsx — thin component
type Props = {
  runs: Run[];
  selectedRunId: number | null;
  activeRunId: number | null;
  onSelect: (id: number) => void;
};

export function SessionSidebar({ runs, selectedRunId, activeRunId, onSelect }: Props) {
  return (
    <aside className="session-sidebar">
      <h2>Sessions</h2>
      <ul>
        {runs.map((run) => (
          <li
            key={run.id}
            className={classNames({
              selected: run.id === selectedRunId,
              active: run.id === activeRunId,
              [run.status]: true,
            })}
            onClick={() => onSelect(run.id)}
          >
            <span className="status-dot" />
            <span className="run-label">{run.label ?? `Run #${run.id}`}</span>
            <span className="run-time">{formatTimestamp(run.started_at)}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
```

CSS class naming follows existing `styles.css` conventions. Add session sidebar styles.

---

### Task 8: Add hierarchy to InspectorPanel

**Files:**
- Modify: `src/components/InspectorPanel.tsx`

**Change:** Add a "Hierarchy" section that shows the agent tree:

- Show parent agent link if `agent.parentAgentId` exists
- List child agents (agents whose `parentAgentId` matches this agent)
- Use indentation for tree depth

For V1 this is minimal — just show parent label and child count in the inspector. Full tree view comes later (popup).

---

### Task 9: Wire App.tsx

**Files:**
- Modify: `src/App.tsx`

- Import and use `useRuns` hook
- Import `SessionSidebar` component
- Pass `selectedRunId` to `useWorkflowStream`
- Layout: sidebar on left, board in center, inspector on right
- Auto-select active run (done in useRuns)
- When SSE detects a new run (`run_start` event), auto-select it

---

### Task 10: End-to-end testing

**Test the full flow:**

1. Start server: `npm run dev` (runs Vite + server concurrently)
2. Open browser to localhost:5173
3. Verify: the board shows agents from activity.log
4. Verify: sidebar shows session with "Run #1"
5. Verify: active run is auto-selected
6. Verify: agent hierarchy shows in InspectorPanel
7. Stop server with Ctrl+C
8. Restart server
9. Verify: state is preserved, no duplicate agents

Run `npm run test` to ensure all tests pass.
