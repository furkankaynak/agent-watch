# SQLite Persistence & Session Tracking Design

## Motivation

Replace in-memory file-tail approach with SQLite-backed persistence to:
1. Survive server restarts without losing workflow state
2. Enable session-based navigation (past runs sidebar, auto-select active run)
3. Fix agent binding gaps: FIFO conversation binding is fragile; SQLite + direct `subagent_id` matching provides reliable agent hierarchy

## Architecture

```
activity.log ──(poll 1s)──> Server
                              │
                         parseLogLine()
                              │
                        SQLite Event Processor
                     ┌─────────────────────────┐
                     │ INSERT raw_events        │
                     │ UPSERT runs (detect)     │
                     │ UPSERT agents (hierarchy)│
                     │ INSERT tool_calls         │
                     │ UPDATE statuses           │
                     └──────────┬──────────────┘
                                │
                   ┌────────────┼────────────┐
                   ▼                         ▼
            GET /api/snapshot          GET /api/events (SSE)
            (query runs + agents)      (last seen event id → new rows)
                   │                         │
                   ▼                         ▼
              Frontend hooks → UI Components
```

## SQLite Schema

```sql
CREATE TABLE runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT,
  status TEXT NOT NULL DEFAULT 'running',  -- running | completed | failed
  started_at TEXT NOT NULL,
  ended_at TEXT,
  root_agent_id TEXT
);

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  run_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  agent_type TEXT NOT NULL,
  model TEXT,
  description TEXT,
  parent_agent_id TEXT,
  conversation_id TEXT,
  status TEXT NOT NULL DEFAULT 'incoming',  -- incoming|running|idle|completed|failed
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE tool_calls (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'started',  -- started|done|failed
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER,
  ok INTEGER,
  error_message TEXT
);

CREATE TABLE agent_chips (
  agent_id TEXT NOT NULL,
  chip_type TEXT NOT NULL,             -- skill|rule|decision
  chip_value TEXT NOT NULL,
  seen_at TEXT NOT NULL,
  PRIMARY KEY (agent_id, chip_type, chip_value)
);

CREATE TABLE raw_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line_number INTEGER NOT NULL,
  timestamp TEXT NOT NULL,
  event_type TEXT NOT NULL,
  fields TEXT NOT NULL,                -- JSON of all key=value pairs
  raw TEXT NOT NULL
);
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/snapshot` | GET | Returns active run + all its agents |
| `/api/events` | SSE | Streams new SQLite rows (poll via `last_event_id`) |
| `/api/runs` | GET | List all runs for left sidebar |
| `/api/runs/:id` | GET | Full data for a specific run |
| `/api/agents/:id` | GET | Detail for popup (agent + tool_calls + chips) |
| `/api/health` | GET | Liveness check |

## Event Processing

| Log Event | SQL Effect |
|-----------|-----------|
| `tool_start` (Task) | INSERT agent (incoming), detect/create run |
| `subagent_start` | UPDATE agent (label/type/model, status→running, bind via subagent_id) |
| `tool_start` (other) | INSERT tool_call (status=started), UPDATE agent last_seen_at |
| `tool_done` | UPDATE tool_call (status=done/failed), UPDATE agent status |
| `skill_read`/etc. | INSERT agent_chips, UPDATE agent last_seen_at |
| `session_end` | UPDATE agent status→completed/failed, check run completion |

## Run Detection

- **New run**: When `tool_start Task` arrives with no active agents in DB (all terminal)
- **End of run**: Root agent's `session_end` with terminal status, or 60s inactivity timeout
- **Past runs**: Fully stored in SQLite; selectable from sidebar

## Persistence on Restart

- Server reads `max(raw_events.id)` from SQLite
- Checks activity.log for new events beyond that point
- Processes new events, continues polling
- No re-processing of old events

## UI Changes

- **Session sidebar** (left column): lists past runs, auto-selects active run
- **Agent hierarchy** in InspectorPanel: parent→child tree via parent_agent_id
- **Board scoped** to selected run
- AgentCard, StatusLight, ResourceChips unchanged
