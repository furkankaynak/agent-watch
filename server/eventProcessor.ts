import type Database from "better-sqlite3";
import type { LogEvent } from "../src/shared/logTypes";

const conversationToAgentId: Record<string, string> = {};
const conversationLatestAgentId: Record<string, string> = {};
const unboundAgentIds: string[] = [];

let currentRunId: number | null = null;
let lastActivityAt = 0;

export function getCurrentRunId(): number | null {
  return currentRunId;
}

export function restoreRunState(db: Database.Database): void {
  const row = db
    .prepare("SELECT value FROM server_state WHERE key = ?")
    .get("current_run_id") as { value: string } | undefined;
  if (row) {
    const id = Number(row.value);
    if (!isNaN(id)) {
      currentRunId = id;
    }
  }
}

function persistRunId(db: Database.Database): void {
  db.prepare("INSERT OR REPLACE INTO server_state (key, value) VALUES (?, ?)").run(
    "current_run_id",
    String(currentRunId),
  );
}

function clearRunId(db: Database.Database): void {
  db.prepare("DELETE FROM server_state WHERE key = ?").run("current_run_id");
}

export function processEvent(db: Database.Database, event: LogEvent, rawEventId?: number): void {
  const now = Date.now();
  if (now - lastActivityAt > 60_000) {
    checkStaleRun(db, now);
  }
  lastActivityAt = now;

  switch (event.eventType) {
    case "tool_start":
      handleToolStart(db, event);
      break;
    case "subagent_start":
      handleSubagentStart(db, event);
      break;
    case "tool_done":
      handleToolDone(db, event);
      break;
    case "file_read":
      handleFileRead(db, event);
      break;
    case "skill_read":
    case "rule_read":
    case "decisions_read":
      handleChipEvent(db, event);
      break;
    case "session_end":
      handleSessionEnd(db, event);
      break;
    case "hook_event":
      handleHookEvent(db, event);
      break;
    default:
      handleDefault(db, event);
      break;
  }

  if (rawEventId !== undefined && currentRunId !== null) {
    db.prepare("UPDATE raw_events SET run_id = ? WHERE id = ?").run(currentRunId, rawEventId);
  }
}

// ── helper queries ────────────────────────────────────────────

function touchAgent(db: Database.Database, agentId: string, timestamp: string): void {
  db.prepare(
    `UPDATE agents SET last_seen_at = ?,
       status = CASE WHEN status IN ('completed', 'failed') THEN status ELSE 'running' END
     WHERE id = ?`,
  ).run(timestamp, agentId);
}

function completeAgent(
  db: Database.Database,
  agentId: string,
  status: string,
  timestamp: string,
  isTerminal: boolean,
): void {
  db.prepare(
    "UPDATE agents SET status = ?, last_seen_at = ?, completed_at = ? WHERE id = ?",
  ).run(status, timestamp, isTerminal ? timestamp : null, agentId);
}

function setRunCompleted(db: Database.Database, runId: number, timestamp: string): void {
  db.prepare(
    "UPDATE runs SET status = 'completed', ended_at = ? WHERE id = ?",
  ).run(timestamp, runId);
}

function isRootAgentForRun(
  db: Database.Database,
  runId: number,
  agentId: string,
): boolean {
  const run = db
    .prepare("SELECT root_agent_id FROM runs WHERE id = ?")
    .get(runId) as any;
  return run?.root_agent_id === agentId;
}

function tryCompleteRun(db: Database.Database, agentId: string, timestamp: string): void {
  if (currentRunId === null) return;
  if (isRootAgentForRun(db, currentRunId, agentId)) {
    setRunCompleted(db, currentRunId, timestamp);
    clearRunId(db);
    currentRunId = null;
  }
}

// ── event handlers ────────────────────────────────────────────

function ensureRun(db: Database.Database, event?: LogEvent): number {
  if (currentRunId === null) {
    const wsRoot = event?.fields?.workspace_root ?? null;
    const info = db
      .prepare("INSERT INTO runs (label, status, started_at, workspace_root) VALUES (?, 'running', ?, ?)")
      .run(null, new Date().toISOString(), wsRoot);
    currentRunId = info.lastInsertRowid as number;
    persistRunId(db);
  }
  return currentRunId;
}

function resolveHookStatus(hookStatus: string | undefined): string | null {
  if (hookStatus === "completed") return "completed";
  if (hookStatus === "error" || hookStatus === "aborted") return "failed";
  return null;
}

function bindConversation(
  event: LogEvent,
  db?: Database.Database,
): { agentId?: string } {
  const conversationId = event.fields.conversation_id;
  if (!conversationId) return {};

  const generationId = event.fields.generation_id;
  const bindingKey = generationId
    ? `${conversationId}:${generationId}`
    : conversationId;
  const existingAgentId = conversationToAgentId[bindingKey];

  if (existingAgentId) {
    return { agentId: existingAgentId };
  }

  if (unboundAgentIds.length > 0) {
    const nextAgentId = unboundAgentIds.shift()!;
    conversationToAgentId[bindingKey] = nextAgentId;
    conversationLatestAgentId[conversationId] = nextAgentId;
    return { agentId: nextAgentId };
  }

  const fallback = conversationLatestAgentId[conversationId];
  if (fallback) {
    return { agentId: fallback };
  }

  if (db) {
    const agent = db
      .prepare("SELECT id FROM agents WHERE conversation_id = ? LIMIT 1")
      .get(conversationId) as { id: string } | undefined;
    if (agent) {
      conversationLatestAgentId[conversationId] = agent.id;
      return { agentId: agent.id };
    }
  }

  return {};
}

function handleToolStart(db: Database.Database, event: LogEvent): void {
  const toolName = event.fields.tool_name;

  if (toolName === "Task") {
    const runId = ensureRun(db, event);
    const bound = bindConversation(event, db);
    const agentId = event.fields.tool_use_id;
    if (!agentId) return;

    const subagentType = event.fields.input_subagent_type ?? "agent";
    const description = event.fields.input_description ?? null;
    const label = humanizeLabel(subagentType);

    const wsRoot = event.fields.workspace_root ?? null;
    db.prepare(
      `INSERT OR REPLACE INTO agents (id, run_id, label, agent_type, description, parent_agent_id, conversation_id, status, created_at, last_seen_at, workspace_root)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'incoming', ?, ?, ?)`,
    ).run(
      agentId,
      runId,
      label,
      subagentType,
      description,
      bound.agentId ?? null,
      event.fields.conversation_id ?? null,
      event.timestamp,
      event.timestamp,
      wsRoot,
    );

    if (!isRootAgentForRun(db, runId, agentId)) {
      db.prepare("UPDATE runs SET root_agent_id = ? WHERE id = ? AND root_agent_id IS NULL").run(agentId, runId);
    }

    return;
  }

  const bound = bindConversation(event, db);
  if (!bound.agentId) return;

  const agentId = bound.agentId;
  const toolUseId = event.fields.tool_use_id;
  if (!toolUseId) return;

  db.prepare(
    `INSERT OR REPLACE INTO tool_calls (id, agent_id, tool_name, status, started_at)
     VALUES (?, ?, ?, 'started', ?)`,
  ).run(toolUseId, agentId, toolName, event.timestamp);

  touchAgent(db, agentId, event.timestamp);
}

function handleSubagentStart(db: Database.Database, event: LogEvent): void {
  const subagentId = event.fields.subagent_id;
  if (!subagentId) return;

  const agent = db
    .prepare("SELECT agent_type FROM agents WHERE id = ?")
    .get(subagentId) as any;
  if (!agent) return;

  const type =
    event.fields.subagent_type ??
    event.fields.agent_type ??
    agent.agent_type;
  const label = event.fields.agent_label ?? humanizeLabel(type);
  const model =
    event.fields.subagent_model ?? event.fields.model ?? null;

  db.prepare(
    `UPDATE agents SET label = ?, agent_type = ?, model = ?, status = 'running', last_seen_at = ?
     WHERE id = ?`,
  ).run(label, type, model, event.timestamp, subagentId);

  if (!unboundAgentIds.includes(subagentId)) {
    unboundAgentIds.push(subagentId);
  }
}

function handleToolDone(db: Database.Database, event: LogEvent): void {
  const bound = bindConversation(event, db);
  if (!bound.agentId) return;

  const toolUseId = event.fields.tool_use_id;
  if (!toolUseId) return;

  const ok = event.fields.ok === "true" ? 1 : 0;

  const toolCall = db
    .prepare("SELECT started_at FROM tool_calls WHERE id = ?")
    .get(toolUseId) as any;
  let durationMs: number | null = null;
  if (toolCall?.started_at) {
    durationMs = Date.parse(event.timestamp) - Date.parse(toolCall.started_at);
  }

  const errorMessage =
    ok === 0
      ? (event.fields.error_message ??
        event.fields.failure_type ??
        `${event.fields.tool_name ?? "Tool"} failed`)
      : null;

  db.prepare(
    `UPDATE tool_calls SET status = 'done', completed_at = ?, duration_ms = ?, ok = ?, error_message = ?
     WHERE id = ?`,
  ).run(event.timestamp, durationMs, ok, errorMessage, toolUseId);

  if (ok === 0) {
    completeAgent(db, bound.agentId, "failed", event.timestamp, true);
    return;
  }

  const activeToolCount = (
    db
      .prepare(
        "SELECT COUNT(*) as count FROM tool_calls WHERE agent_id = ? AND status = 'started'",
      )
      .get(bound.agentId) as any
  ).count;

  const newStatus = activeToolCount > 0 ? "running" : "idle";
  db.prepare(
    `UPDATE agents SET status = ?, last_seen_at = ?
     WHERE id = ? AND status NOT IN ('completed', 'failed')`,
  ).run(newStatus, event.timestamp, bound.agentId);
}

function safeParseArray(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p : [];
  } catch { return []; }
}

function handleFileRead(db: Database.Database, event: LogEvent): void {
  const bound = bindConversation(event, db);
  if (!bound.agentId) return;

  const rules = safeParseArray(event.fields.attachment_rules);
  for (const rule of rules) {
    db.prepare(
      "INSERT OR IGNORE INTO agent_chips (agent_id, chip_type, chip_value, seen_at) VALUES (?, ?, ?, ?)"
    ).run(bound.agentId, "rule", rule, event.timestamp);
  }

  const skills = safeParseArray(event.fields.attachment_skills);
  for (const skill of skills) {
    db.prepare(
      "INSERT OR IGNORE INTO agent_chips (agent_id, chip_type, chip_value, seen_at) VALUES (?, ?, ?, ?)"
    ).run(bound.agentId, "skill", skill, event.timestamp);
  }

  touchAgent(db, bound.agentId, event.timestamp);
}

function handleChipEvent(db: Database.Database, event: LogEvent): void {
  const bound = bindConversation(event, db);
  if (!bound.agentId) return;

  const chipType =
    event.eventType === "skill_read"
      ? "skill"
      : event.eventType === "rule_read"
        ? "rule"
        : "decision";

  const chipValue =
    event.fields[chipType] ??
    (event.eventType === "decisions_read"
      ? (event.fields.decisions ?? (event.fields.path ? basename(event.fields.path) : undefined))
      : event.fields.path
        ? basename(event.fields.path)
        : undefined);
  if (!chipValue) return;

  db.prepare(
    "INSERT OR IGNORE INTO agent_chips (agent_id, chip_type, chip_value, seen_at) VALUES (?, ?, ?, ?)",
  ).run(bound.agentId, chipType, chipValue, event.timestamp);

  touchAgent(db, bound.agentId, event.timestamp);
}

function handleSessionEnd(db: Database.Database, event: LogEvent): void {
  const bound = bindConversation(event, db);
  if (!bound.agentId) return;

  const agent = db
    .prepare("SELECT status FROM agents WHERE id = ?")
    .get(bound.agentId) as any;
  if (!agent) return;

  const finalStatus = event.fields.final_status;
  let newStatus = agent.status;

  if (finalStatus === "completed") {
    newStatus = "completed";
  } else if (finalStatus === "aborted" || finalStatus === "unknown") {
    newStatus = "failed";
  } else if (finalStatus === "generating") {
    newStatus = agent.status === "running" || agent.status === "incoming" ? "running" : agent.status;
  } else if (!finalStatus) {
    // sessionEnd hook from Cursor — no final_status field, always terminal
    newStatus = "completed";
  }

  const isTerminal = newStatus === "completed" || newStatus === "failed";
  completeAgent(db, bound.agentId, newStatus, event.timestamp, isTerminal);

  if (isTerminal) {
    tryCompleteRun(db, bound.agentId, event.timestamp);
  }
}

function handleHookEvent(db: Database.Database, event: LogEvent): void {
  const hookName = event.fields.hook_event_name;
  if (!hookName) return;

  switch (hookName) {
    case "subagentStop":
      handleSubagentStop(db, event);
      break;
    case "stop":
      handleStopHook(db, event);
      break;
    default:
      handleDefault(db, event);
      break;
  }
}

function handleSubagentStop(db: Database.Database, event: LogEvent): void {
  const bound = bindConversation(event, db);
  if (!bound.agentId) return;

  const newStatus = resolveHookStatus(event.fields.status) ?? "completed";

  completeAgent(db, bound.agentId, newStatus, event.timestamp, true);
}

function handleStopHook(db: Database.Database, event: LogEvent): void {
  const bound = bindConversation(event, db);
  if (!bound.agentId) return;

  const newStatus = resolveHookStatus(event.fields.status) ?? "completed";

  const isTerminal = newStatus === "completed" || newStatus === "failed";
  completeAgent(db, bound.agentId, newStatus, event.timestamp, isTerminal);

  if (isTerminal) {
    tryCompleteRun(db, bound.agentId, event.timestamp);
  }
}

function handleDefault(db: Database.Database, event: LogEvent): void {
  const bound = bindConversation(event, db);
  if (!bound.agentId) return;

  touchAgent(db, bound.agentId, event.timestamp);
}

function checkStaleRun(db: Database.Database, now: number): void {
  if (currentRunId === null) return;

  const activeAgents = db
    .prepare(
      "SELECT COUNT(*) as count FROM agents WHERE run_id = ? AND status NOT IN ('completed', 'failed')",
    )
    .get(currentRunId) as any;

  if (activeAgents.count === 0) {
    setRunCompleted(db, currentRunId, new Date(now).toISOString());
    clearRunId(db);
    currentRunId = null;
  }
}

function humanizeLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function basename(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parts = value.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.at(-1) ?? value;
}
