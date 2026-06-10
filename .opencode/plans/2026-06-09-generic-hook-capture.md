# Generic Cursor Hook Capture Plan

> **Status:** Plan | **Date:** 2026-06-09

## Motivation

Cursor supports **21 hook events** across three categories (Agent, Tab, App Lifecycle). Currently only 9 appear in `activity.log` via Cursor's auto-logging. The remaining 12 require explicit `.cursor/hooks.json` configuration. We want a **single generic hook script** that captures ALL 21 hooks, writes them to the same `activity.log` in a unified format, stores them in SQLite, and displays them in the dashboard.

## Complete Cursor Hook Inventory (21 hooks)

### Agent Hooks (18)

| # | Hook | Auto-logged? | Description |
|---|------|-------------|-------------|
| 1 | `sessionStart` | Yes | Agent session begins |
| 2 | `sessionEnd` | Yes | Agent session ends |
| 3 | `preToolUse` | Yes | Before any tool execution (Shell, Read, Write, MCP, Task, etc.) |
| 4 | `postToolUse` | Yes | After successful tool execution |
| 5 | `postToolUseFailure` | Yes | After tool fails, times out, or is denied |
| 6 | `subagentStart` | Yes | Before Task tool spawns subagent |
| 7 | `subagentStop` | No | After subagent completes/errors/aborts |
| 8 | `beforeShellExecution` | Yes | Before shell command runs |
| 9 | `afterShellExecution` | Yes | After shell command completes |
| 10 | `beforeMCPExecution` | No | Before MCP tool executes |
| 11 | `afterMCPExecution` | No | After MCP tool executes |
| 12 | `beforeReadFile` | Yes | Before agent reads a file |
| 13 | `afterFileEdit` | Yes | After agent edits a file |
| 14 | `beforeSubmitPrompt` | No | Before user prompt is submitted |
| 15 | `preCompact` | No | Before context window compaction |
| 16 | `stop` | No | Agent completes (fires with status: completed/aborted/error) |
| 17 | `afterAgentResponse` | No | After agent sends a response message |
| 18 | `afterAgentThought` | No | After agent emits a thinking block |

### Tab Hooks (2)

| # | Hook | Auto-logged? | Description |
|---|------|-------------|-------------|
| 19 | `beforeTabFileRead` | No | Before Tab (inline completion) reads a file |
| 20 | `afterTabFileEdit` | No | After Tab edits a file |

### App Lifecycle Hooks (1)

| # | Hook | Auto-logged? | Description |
|---|------|-------------|-------------|
| 21 | `workspaceOpen` | No | When Cursor opens or changes workspace |

---

## Architecture

```
Cursor Agent Loop
       │
       ▼
  .cursor/hooks/generic-hook.js  ◄── registered for ALL 21 hooks via hooks.json
       │                             reads JSON from stdin, flattens fields
       │                             appends to activity.log
       ▼
  activity.log ──(file-tail)──► Server (logFile.ts)
       │                             parseLogLine() → LogEvent
       │                             eventType: "hook_event"
       ▼
  SQLite Event Processor (eventProcessor.ts)
       │                             INSERT INTO raw_events
       │                             UPDATE agent statuses from hook data
       ▼
  HTTP API + SSE ─────────────► Dashboard
                                     EventFeed → shows hook events
                                     InspectorPanel → hook stats per agent
```

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Hook script language | Node.js | Already an npm project, shares ecosystem, no new runtime |
| Log destination | Same activity.log | Existing file-tail pipeline picks it up automatically |
| Auto-logged hooks | Unified: register ALL 21 | Single code path, deduplication handled in event processor |
| Event type | `hook_event` | Distinct from Cursor's internal types (tool_start, etc.) |
| Hook script behavior | Fail-open (always exit 0) | A hook crash must never block Cursor |

---

## Phase 1: Generic Hook Script + Setup

agents-watch is a **library**, not the project being developed in Cursor. The hook script ships with agents-watch and the user's `.cursor/hooks.json` references it by absolute path. A setup utility auto-generates the config.

### 1a. `hooks/generic-hook.js` (ships with agents-watch)

Located at `<agents-watch>/hooks/generic-hook.js`. The user's `.cursor/hooks.json` references it with an absolute path:

```json
{
  "version": 1,
  "hooks": {
    "sessionStart":         [{ "command": "node /path/to/agents-watch/hooks/generic-hook.js" }],
    "sessionEnd":           [{ "command": "node /path/to/agents-watch/hooks/generic-hook.js" }],
    "preToolUse":           [{ "command": "node /path/to/agents-watch/hooks/generic-hook.js" }],
    "postToolUse":          [{ "command": "node /path/to/agents-watch/hooks/generic-hook.js" }],
    "postToolUseFailure":   [{ "command": "node /path/to/agents-watch/hooks/generic-hook.js" }],
    "subagentStart":        [{ "command": "node /path/to/agents-watch/hooks/generic-hook.js" }],
    "subagentStop":         [{ "command": "node /path/to/agents-watch/hooks/generic-hook.js" }],
    "beforeShellExecution": [{ "command": "node /path/to/agents-watch/hooks/generic-hook.js" }],
    "afterShellExecution":  [{ "command": "node /path/to/agents-watch/hooks/generic-hook.js" }],
    "beforeMCPExecution":   [{ "command": "node /path/to/agents-watch/hooks/generic-hook.js" }],
    "afterMCPExecution":    [{ "command": "node /path/to/agents-watch/hooks/generic-hook.js" }],
    "beforeReadFile":       [{ "command": "node /path/to/agents-watch/hooks/generic-hook.js" }],
    "afterFileEdit":        [{ "command": "node /path/to/agents-watch/hooks/generic-hook.js" }],
    "beforeSubmitPrompt":   [{ "command": "node /path/to/agents-watch/hooks/generic-hook.js" }],
    "preCompact":           [{ "command": "node /path/to/agents-watch/hooks/generic-hook.js" }],
    "stop":                 [{ "command": "node /path/to/agents-watch/hooks/generic-hook.js" }],
    "afterAgentResponse":   [{ "command": "node /path/to/agents-watch/hooks/generic-hook.js" }],
    "afterAgentThought":    [{ "command": "node /path/to/agents-watch/hooks/generic-hook.js" }],
    "beforeTabFileRead":    [{ "command": "node /path/to/agents-watch/hooks/generic-hook.js" }],
    "afterTabFileEdit":     [{ "command": "node /path/to/agents-watch/hooks/generic-hook.js" }],
    "workspaceOpen":        [{ "command": "node /path/to/agents-watch/hooks/generic-hook.js" }]
  }
}
```

### 1b. `server/setupHooks.ts` (auto-setup utility)

On server startup, derives the project root from `ACTIVITY_LOG_PATH` and checks if `.cursor/hooks.json` exists. If missing, writes it with the correct absolute path to agents-watch's hook script.

Single Node.js script, no dependencies. Reads hook input via stdin, flattens nested fields, appends to activity.log.

```js
#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString());

  const now = new Date();
  const timestamp = now.toISOString().replace("T", " ").slice(0, 23) + "Z";

  const fields = flattenFields(input, "", {});
  const fieldStr = Object.entries(fields)
    .map(([k, v]) => formatField(k, v))
    .join(" ");

  const line = `${timestamp} | hook_event | ${fieldStr}\n`;

  const logPath = process.env.ACTIVITY_LOG_PATH
    || path.join(process.cwd(), "activity.log");

  fs.appendFileSync(logPath, line, "utf8");
  process.exit(0);
}

function flattenFields(obj, prefix, result) {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}_${key}` : key;
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      result[fullKey] = JSON.stringify(value);
    } else if (typeof value === "object") {
      flattenFields(value, fullKey, result);
    } else {
      result[fullKey] = String(value);
    }
  }
  return result;
}

function formatField(key, value) {
  if (/\s/.test(value) || value.includes('"')) {
    return `${key}="${value.replace(/"/g, '\\"')}"`;
  }
  return `${key}=${value}`;
}

main().catch(() => process.exit(0));
```

**Design choices:**
- Nested objects flattened with `_` separator (e.g., `edits_0_old_string`)
- Arrays JSON-stringified
- Values with spaces double-quoted (matches existing activity.log format)
- Always exits 0 (fail-open) — must never block Cursor
- Zero external dependencies — Node.js built-ins only

---

## Phase 2: Activity Log Format

### Format

```
{ISO_timestamp} | hook_event | hook_event_name=X field1=val1 field2="val with spaces" ...
```

### Examples

```
2026-06-09T14:32:01.123Z | hook_event | hook_event_name=subagentStop subagent_type=generalPurpose status=completed task="Explore auth flow" duration_ms=45000 message_count=12 tool_call_count=8 loop_count=0 modified_files="[\"src/auth.ts\"]" conversation_id=conv-456 generation_id=gen-789
```

```
2026-06-09T14:32:01.456Z | hook_event | hook_event_name=preCompact conversation_id=conv-456 generation_id=gen-789 model=claude-sonnet-4
```

```
2026-06-09T14:32:01.789Z | hook_event | hook_event_name=workspaceOpen workspace_roots="[\"/Users/x/project\"]" user_email=user@example.com cursor_version=1.7.2
```

### Parser compatibility

The existing `parseLogLine` regexes already handle this format:
- `LINE_PATTERN`: matches `timestamp | eventType | fields` — `hook_event` fits
- `FIELD_PATTERN`: handles quoted strings with escaped quotes and unquoted values

**No parser changes required.** The `eventType` will be `"hook_event"` and all hook-specific fields are in the `fields` Record.

---

## Phase 3: Type Utilities

### `src/shared/logTypes.ts` additions

```typescript
// Helper: extract hook_event_name from fields
export function hookEventName(event: LogEvent): string | undefined {
  return event.fields.hook_event_name;
}

// Helper: check if event is a hook_event type
export function isHookEvent(event: LogEvent): boolean {
  return event.eventType === "hook_event";
}
```

Keep `LogEvent` interface unchanged to avoid breaking existing code.

### `src/shared/hookTypes.ts` (new file)

```typescript
export const HOOK_EVENT_LABELS: Record<string, string> = {
  sessionStart: "Session Start",
  sessionEnd: "Session End",
  preToolUse: "Pre Tool Use",
  postToolUse: "Post Tool Use",
  postToolUseFailure: "Tool Failed",
  subagentStart: "Subagent Started",
  subagentStop: "Subagent Stopped",
  beforeShellExecution: "Before Shell",
  afterShellExecution: "After Shell",
  beforeMCPExecution: "Before MCP",
  afterMCPExecution: "After MCP",
  beforeReadFile: "Before Read",
  afterFileEdit: "After Edit",
  beforeSubmitPrompt: "Before Submit",
  preCompact: "Context Compact",
  stop: "Agent Stopped",
  afterAgentResponse: "Agent Response",
  afterAgentThought: "Agent Thought",
  beforeTabFileRead: "Tab Before Read",
  afterTabFileEdit: "Tab After Edit",
  workspaceOpen: "Workspace Open",
};

export const HOOK_CATEGORY: Record<string, "agent" | "tab" | "lifecycle"> = {
  sessionStart: "agent", sessionEnd: "agent", preToolUse: "agent",
  postToolUse: "agent", postToolUseFailure: "agent", subagentStart: "agent",
  subagentStop: "agent", beforeShellExecution: "agent", afterShellExecution: "agent",
  beforeMCPExecution: "agent", afterMCPExecution: "agent", beforeReadFile: "agent",
  afterFileEdit: "agent", beforeSubmitPrompt: "agent", preCompact: "agent",
  stop: "agent", afterAgentResponse: "agent", afterAgentThought: "agent",
  beforeTabFileRead: "tab", afterTabFileEdit: "tab",
  workspaceOpen: "lifecycle",
};
```

---

## Phase 4: SQLite Event Processor

### Schema (no changes needed)

The existing `raw_events` table from the SQLite persistence plan already handles our format:

```sql
CREATE TABLE raw_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER REFERENCES runs(id),
  line_number INTEGER NOT NULL,
  timestamp TEXT NOT NULL,
  event_type TEXT NOT NULL,     -- "hook_event" for our events
  fields TEXT NOT NULL,          -- JSON of all key=value pairs
  raw TEXT NOT NULL
);
```

### New case in eventProcessor.ts

```typescript
case "hook_event":
  return applyHookEvent(state, event);
```

### Hook-specific handling

| hook_event_name | Action |
|----------------|--------|
| `subagentStop` | UPDATE agent status (completed/error/aborted), record summary/duration/stats |
| `stop` | UPDATE agent status from stop hook's `status` field, check run completion |
| `beforeMCPExecution` | INSERT tool_call (mcp, started) |
| `afterMCPExecution` | UPDATE tool_call (done, with duration + result) |
| `preCompact` | INSERT compaction event (informational) |
| `workspaceOpen` | Create/increment run (new workspace = new session context) |
| `afterAgentResponse` | Log response event (informational) |
| `afterAgentThought` | Log thought event (informational) |
| `beforeTabFileRead` | Log tab read (informational) |
| `afterTabFileEdit` | Log tab edit (informational) |
| `beforeSubmitPrompt` | Log prompt submission (informational) |
| *auto-logged hooks* | INSERT raw_event only (state changes already handled by primary tool_start/tool_done events) |

---

## Phase 5: Workflow Reducer

### Add `hook_event` dispatch

```typescript
// src/shared/workflowReducer.ts
case "hook_event":
  return applyHookEvent(nextState, event);
```

### Hook sub-handlers

```typescript
function applyHookEvent(state: WorkflowState, event: LogEvent): WorkflowState {
  const hookName = event.fields.hook_event_name;
  if (!hookName) return state;

  switch (hookName) {
    case "subagentStop":
      return applySubagentStopHook(state, event);
    case "stop":
      return applyStopHook(state, event);
    case "preCompact":
      return applyPreCompactHook(state, event);
    // Informational hooks: just touch bound agent
    default:
      return touchBoundAgent(state, event);
  }
}
```

Key handlers:
- **`subagentStop`**: Updates subagent status to completed/error/aborted, records summary and stats on the agent node
- **`stop`**: Marks agent as completed/aborted/error based on the hook's `status` field
- **`preCompact`**: Logs context compaction (could add a `compactions` counter to AgentNode)

---

## Phase 6: Dashboard

### EventFeed

- `hook_event` entries get distinct styling based on `hook_event_name`
- Filterable by hook type (agent/tab/lifecycle)
- Hook events shown alongside tool events in the live feed

### InspectorPanel

- New "Hooks" section showing per-agent hook timeline
- Hook event counts grouped by hook type
- Latest hook events with timestamps

---

## Implementation Tasks

### Task 1: Create hooks.json and generic-hook.js
**Files:** `.cursor/hooks.json`, `.cursor/hooks/generic-hook.js`
**Verify:** Manual — run Cursor with hooks configured, check `hook_event` lines appear in activity.log

### Task 2: Add hook type utilities
**Files:** `src/shared/logTypes.ts` (helpers), `src/shared/hookTypes.ts` (new)
**Test:** `src/shared/hookTypes.test.ts`

### Task 3: Add hook_event to workflowReducer
**Files:** `src/shared/workflowReducer.ts`
**Test:** `src/shared/workflowReducer.test.ts` — add hook event test cases

### Task 4: Add hook_event to eventProcessor (SQLite)
**Files:** `server/eventProcessor.ts`
**Test:** `server/eventProcessor.test.ts` — add hook event test cases

### Task 5: Update EventFeed for hook events
**Files:** `src/components/EventFeed.tsx`, `src/styles.css`
**Test:** Visual — dashboard shows hook events with distinct styling

### Task 6: Add hooks section to InspectorPanel
**Files:** `src/components/InspectorPanel.tsx`
**Test:** Visual — inspector shows hook timeline per agent

### Task 7: End-to-end verification
1. Place `.cursor/hooks.json` + `generic-hook.js` in a Cursor workspace
2. Use Cursor Cmd+K to execute agent tasks
3. Verify activity.log has both auto-logged + `hook_event` lines
4. Start agents-watch: `npm run dev`
5. Verify dashboard shows hook events in EventFeed
6. Verify InspectorPanel shows hook stats per agent
7. Stop/restart server — verify persistence via SQLite

---

## Notes

- **Deduplication:** The 9 auto-logged hooks produce two activity.log entries (Cursor auto-log + our script). Different `eventType` values prevent conflict. The event processor handles both paths and avoids double-counting state changes.
- **Fail-open:** generic-hook.js always exits 0. A crashed hook must never block Cursor agent operations.
- **Performance:** Node.js cold-start per hook (~50ms) is acceptable. If latency is an issue, pre-compile with `pkg` or use a faster runtime later.
- **Cloud agents:** `.cursor/hooks.json` is picked up by cloud agents. 9 of 21 hooks are cloud-compatible (Cursor limitation); the other 12 are silently skipped in cloud, which is fine — we lose nothing vs. today.
