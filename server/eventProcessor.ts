import type Database from "better-sqlite3";
import type { LogEvent } from "../src/shared/logTypes";

const conversationToAgentId: Record<string, string> = {};
const conversationLatestAgentId: Record<string, string> = {};
const unboundAgentIds: string[] = [];

let currentRunId: number | null = null;
let lastActivityAt = 0;

export function processEvent(db: Database.Database, event: LogEvent): void {
  lastActivityAt = Date.now();
  checkStaleRun(db);

  switch (event.eventType) {
    case "tool_start":
      return handleToolStart(db, event);
    case "subagent_start":
      return handleSubagentStart(db, event);
    case "tool_done":
      return handleToolDone(db, event);
    case "skill_read":
    case "rule_read":
    case "decisions_read":
      return handleChipEvent(db, event);
    case "session_end":
      return handleSessionEnd(db, event);
    default:
      return handleDefault(db, event);
  }
}

function ensureRun(db: Database.Database): number {
  if (currentRunId === null) {
    const info = db
      .prepare(
        "INSERT INTO runs (label, status, started_at) VALUES (?, 'running', ?)",
      )
      .run(null, new Date().toISOString());
    currentRunId = info.lastInsertRowid as number;
  }
  return currentRunId;
}

function bindConversation(
  event: LogEvent,
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

  return { agentId: conversationLatestAgentId[conversationId] };
}

function handleToolStart(db: Database.Database, event: LogEvent): void {
  const toolName = event.fields.tool_name;

  if (toolName === "Task") {
    const runId = ensureRun(db);
    const bound = bindConversation(event);
    const agentId = event.fields.tool_use_id;
    if (!agentId) return;

    const subagentType = event.fields.input_subagent_type ?? "agent";
    const description = event.fields.input_description ?? null;
    const label = humanizeLabel(subagentType);

    db.prepare(
      `INSERT INTO agents (id, run_id, label, agent_type, description, parent_agent_id, conversation_id, status, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'incoming', ?, ?)`,
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
    );

    const run = db
      .prepare("SELECT root_agent_id FROM runs WHERE id = ?")
      .get(runId) as any;
    if (!run.root_agent_id) {
      db.prepare("UPDATE runs SET root_agent_id = ? WHERE id = ?").run(
        agentId,
        runId,
      );
    }

    return;
  }

  const bound = bindConversation(event);
  if (!bound.agentId) return;

  const agentId = bound.agentId;
  const toolUseId = event.fields.tool_use_id;
  if (!toolUseId) return;

  db.prepare(
    `INSERT INTO tool_calls (id, agent_id, tool_name, status, started_at)
     VALUES (?, ?, ?, 'started', ?)`,
  ).run(toolUseId, agentId, toolName, event.timestamp);

  db.prepare(
    `UPDATE agents SET last_seen_at = ?,
       status = CASE WHEN status IN ('completed', 'failed') THEN status ELSE 'running' END
     WHERE id = ?`,
  ).run(event.timestamp, agentId);
}

function handleSubagentStart(db: Database.Database, event: LogEvent): void {
  const subagentId = event.fields.subagent_id;
  if (!subagentId) return;

  const agent = db
    .prepare("SELECT * FROM agents WHERE id = ?")
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
  const bound = bindConversation(event);
  if (!bound.agentId) return;

  const toolUseId = event.fields.tool_use_id;
  if (!toolUseId) return;

  const ok = event.fields.ok === "true" ? 1 : 0;

  const toolCall = db
    .prepare("SELECT * FROM tool_calls WHERE id = ?")
    .get(toolUseId) as any;
  let durationMs: number | null = null;
  if (toolCall?.started_at) {
    durationMs =
      Date.parse(event.timestamp) - Date.parse(toolCall.started_at);
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

  const activeToolCount = (
    db
      .prepare(
        "SELECT COUNT(*) as count FROM tool_calls WHERE agent_id = ? AND status = 'started'",
      )
      .get(bound.agentId) as any
  ).count;

  if (ok === 0) {
    db.prepare(
      "UPDATE agents SET status = 'failed', last_seen_at = ? WHERE id = ?",
    ).run(event.timestamp, bound.agentId);
  } else {
    const newStatus = activeToolCount > 0 ? "running" : "idle";
    db.prepare(
      `UPDATE agents SET status = ?, last_seen_at = ?
       WHERE id = ? AND status NOT IN ('completed', 'failed')`,
    ).run(newStatus, event.timestamp, bound.agentId);
  }
}

function handleChipEvent(db: Database.Database, event: LogEvent): void {
  const bound = bindConversation(event);
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

  db.prepare(
    `UPDATE agents SET last_seen_at = ?,
       status = CASE WHEN status IN ('completed', 'failed') THEN status ELSE 'running' END
     WHERE id = ?`,
  ).run(event.timestamp, bound.agentId);
}

function handleSessionEnd(db: Database.Database, event: LogEvent): void {
  const bound = bindConversation(event);
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
    newStatus = agent.status === "idle" ? "idle" : "running";
  }

  const isTerminal =
    newStatus === "completed" || newStatus === "failed";

  db.prepare(
    `UPDATE agents SET status = ?, last_seen_at = ?, completed_at = ? WHERE id = ?`,
  ).run(
    newStatus,
    event.timestamp,
    isTerminal ? event.timestamp : null,
    bound.agentId,
  );

  if (currentRunId !== null && isTerminal) {
    const run = db
      .prepare("SELECT root_agent_id FROM runs WHERE id = ?")
      .get(currentRunId) as any;
    if (run?.root_agent_id === bound.agentId) {
      db.prepare(
        "UPDATE runs SET status = 'completed', ended_at = ? WHERE id = ?",
      ).run(event.timestamp, currentRunId);
      currentRunId = null;
    }
  }
}

function handleDefault(db: Database.Database, event: LogEvent): void {
  const bound = bindConversation(event);
  if (!bound.agentId) return;

  db.prepare(
    `UPDATE agents SET last_seen_at = ?,
       status = CASE WHEN status IN ('completed', 'failed') THEN status ELSE 'running' END
     WHERE id = ?`,
  ).run(event.timestamp, bound.agentId);
}

function checkStaleRun(db: Database.Database): void {
  if (
    currentRunId !== null &&
    Date.now() - lastActivityAt > 60_000
  ) {
    const activeAgents = db
      .prepare(
        "SELECT COUNT(*) as count FROM agents WHERE run_id = ? AND status NOT IN ('completed', 'failed')",
      )
      .get(currentRunId) as any;

    if (activeAgents.count === 0) {
      db.prepare(
        "UPDATE runs SET status = 'completed', ended_at = ? WHERE id = ?",
      ).run(new Date().toISOString(), currentRunId);
      currentRunId = null;
    }
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
