import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createTcpServer } from "node:net";
import type { LogEvent } from "../src/shared/logTypes";
import { getDb } from "./database";
import { processEvent, restoreRunState } from "./eventProcessor";
import { setupHooks } from "./setupHooks";
import { mapHookToLogEvent, isSessionStartHook, isSessionEndHook } from "./hookMapper";
import { stripHeavyFields } from "./eventFilter";

const HEARTBEAT_MS = 15_000;
const POLL_MS = 1_000;

const PROJECT_ROOT = process.env.PROJECT_ROOT ?? process.cwd();
const port = Number(process.env.PORT || 4317);
const INGEST_PORT = Number(process.env.INGEST_PORT || 4318);

const corsHeaders = {
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Origin": "*"
};

type LogEventRecord = {
  lineNumber: number;
  timestamp: string;
  eventType: string;
  fields: Record<string, string>;
  raw: string;
};

function insertEventAndProcess(event: LogEventRecord, workspaceRoot?: string | null): void {
  const db = getDb();
  const conversationId = event.fields.conversation_id ?? null;
  const wsRoot = workspaceRoot ?? null;
  const info = db.prepare(
    "INSERT INTO raw_events (line_number, timestamp, event_type, fields, raw, conversation_id, workspace_root) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(
    event.lineNumber, event.timestamp, event.eventType,
    JSON.stringify(event.fields), event.raw, conversationId, wsRoot
  );
  processEvent(db, event as Parameters<typeof processEvent>[1], info.lastInsertRowid as number);
}

function handleSessionStart(event: LogEventRecord): void {
  const db = getDb();
  const cid = event.fields.conversation_id;
  if (!cid) return;
  db.prepare(
    `INSERT OR REPLACE INTO sessions (conversation_id, status, started_at, model, cursor_version, workspace_roots)
     VALUES (?, 'active', ?, ?, ?, ?)`
  ).run(
    cid,
    event.timestamp,
    event.fields.model ?? null,
    event.fields.cursor_version ?? null,
    event.fields.workspace_roots ?? null,
  );
}

function handleSessionEnd(event: LogEventRecord): void {
  const db = getDb();
  const cid = event.fields.conversation_id;
  if (!cid) return;
  db.prepare(
    "UPDATE sessions SET status = 'ended', ended_at = ? WHERE conversation_id = ?"
  ).run(event.timestamp, cid);
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString()));
    request.on("error", reject);
  });
}

const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error: unknown) => {
    console.error("Unhandled request error", error);
    if (response.headersSent) {
      response.destroy(error instanceof Error ? error : undefined);
      return;
    }
    writeJson(response, 500, { error: "Internal server error" });
  });
});

async function handleRequest(request: IncomingMessage, response: ServerResponse) {
  const host = typeof request.headers.host === "string" ? request.headers.host : "localhost";
  const url = new URL(request.url ?? "/", `http://${host}`);

  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders);
    response.end();
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/ingest") {
    await handleIngest(request, response);
    return;
  }

  if (request.method !== "GET") {
    writeJson(response, 405, { error: "Method not allowed" });
    return;
  }

  if (url.pathname === "/api/health") {
    writeJson(response, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/sessions") {
    const db = getDb();
    const rows = db.prepare(
      `SELECT s.*, (
         SELECT json_group_array(DISTINCT a.run_id)
         FROM agents a WHERE a.conversation_id = s.conversation_id
       ) as run_ids
       FROM sessions s ORDER BY s.started_at DESC`
    ).all();
    const sessions = (rows as any[]).map((row: any) => ({
      conversation_id: row.conversation_id,
      status: row.status,
      started_at: row.started_at,
      ended_at: row.ended_at,
      model: row.model,
      cursor_version: row.cursor_version,
      workspace_roots: row.workspace_roots,
      run_ids: JSON.parse(row.run_ids ?? "[]"),
    }));
    writeJson(response, 200, sessions);
    return;
  }

  if (url.pathname === "/api/snapshot") {
    const db = getDb();
    const conversationId = url.searchParams.get("conversation_id");
    const runId = url.searchParams.get("run_id");

    let rows;
    if (conversationId) {
      rows = db.prepare(
        "SELECT id, line_number, timestamp, event_type, fields FROM raw_events WHERE conversation_id = ? ORDER BY id LIMIT 5000"
      ).all(conversationId);
    } else if (runId) {
      rows = db.prepare(
        "SELECT id, line_number, timestamp, event_type, fields FROM raw_events WHERE run_id = ? ORDER BY id LIMIT 5000"
      ).all(Number(runId));
    } else {
      rows = db.prepare(
        "SELECT id, line_number, timestamp, event_type, fields FROM raw_events ORDER BY id LIMIT 5000"
      ).all();
    }

    const events = (rows as any[]).map((row: any) => {
      const fields = JSON.parse(row.fields);
      const { fields: strippedFields, _hasHeavy } = stripHeavyFields(fields);
      return {
        lineNumber: row.line_number,
        timestamp: row.timestamp,
        eventType: row.event_type,
        fields: strippedFields,
        _hasHeavy,
      };
    });

    writeJson(response, 200, events);
    return;
  }

  if (url.pathname === "/api/runs") {
    const db = getDb();
    const runs = db.prepare(
      "SELECT id, label, status, started_at, ended_at FROM runs ORDER BY id DESC LIMIT 50"
    ).all();
    writeJson(response, 200, runs);
    return;
  }

  if (url.pathname === "/api/events") {
    streamSseEvents(request, response);
    return;
  }

  if (url.pathname.startsWith("/api/events/")) {
    const idStr = url.pathname.slice("/api/events/".length);
    const id = Number(idStr);
    if (isNaN(id)) {
      writeJson(response, 404, { error: "Not found" });
      return;
    }
    const db = getDb();
    const row = db.prepare(
      "SELECT id, line_number, timestamp, event_type, fields, raw FROM raw_events WHERE id = ?"
    ).get(id) as any;
    if (!row) {
      writeJson(response, 404, { error: "Not found" });
      return;
    }
    writeJson(response, 200, {
      id: row.id,
      lineNumber: row.line_number,
      timestamp: row.timestamp,
      eventType: row.event_type,
      fields: JSON.parse(row.fields),
      raw: row.raw,
    });
    return;
  }

  writeJson(response, 404, { error: "Not found" });
}

async function handleIngest(request: IncomingMessage, response: ServerResponse) {
  let body: string;
  try {
    body = await readBody(request);
  } catch {
    writeJson(response, 400, { error: "Invalid body" });
    return;
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body);
  } catch {
    writeJson(response, 400, { error: "Invalid JSON" });
    return;
  }

  const event = mapHookToLogEvent(payload);
  if (!event) {
    writeJson(response, 400, { error: "Missing hook_event_name" });
    return;
  }

  insertEventAndProcess(event as LogEventRecord);

  if (isSessionStartHook(event)) {
    handleSessionStart(event as LogEventRecord);
  } else if (isSessionEndHook(event)) {
    handleSessionEnd(event as LogEventRecord);
  }

  writeJson(response, 200, { ok: true });
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.writeHead(statusCode, {
    ...corsHeaders,
    "Cache-Control": "no-cache",
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
}

function streamSseEvents(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? "/", "http://localhost");
  const conversationId = url.searchParams.get("conversation_id");
  const runId = url.searchParams.get("run_id");

  response.writeHead(200, {
    ...corsHeaders,
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8",
    "X-Accel-Buffering": "no"
  });
  response.flushHeaders();

  let closed = false;
  let lastEventId = 0;

  const query = conversationId
    ? db.prepare("SELECT id, line_number, timestamp, event_type, fields, raw FROM raw_events WHERE id > ? AND conversation_id = ? ORDER BY id")
    : runId
      ? db.prepare("SELECT id, line_number, timestamp, event_type, fields, raw FROM raw_events WHERE id > ? AND run_id = ? ORDER BY id")
      : db.prepare("SELECT id, line_number, timestamp, event_type, fields, raw FROM raw_events WHERE id > ? ORDER BY id");

  const pollTimer = setInterval(() => {
    if (closed) return;

    const db = getDb();
    const params = conversationId
      ? [lastEventId, conversationId]
      : runId
        ? [lastEventId, Number(runId)]
        : [lastEventId];
    const rows = query.all(...params);

    for (const row of rows as any[]) {
      const fields = JSON.parse(row.fields);
      const { fields: strippedFields, _hasHeavy } = stripHeavyFields(fields);
      const eventPayload = {
        id: row.id,
        lineNumber: row.line_number,
        timestamp: row.timestamp,
        eventType: row.event_type,
        fields: strippedFields,
        _hasHeavy,
      };
      const eventData = `event: activity\ndata: ${JSON.stringify(eventPayload)}\n\n`;

      response.write(eventData);
      lastEventId = row.id;
    }

    response.write(": ping\n\n");
  }, POLL_MS);

  const close = () => {
    closed = true;
    clearInterval(pollTimer);
  };

  request.on("close", close);
  response.on("close", close);
}

// ── TCP ingest listener (for plugin hooks via JSONL) ──

function startTcpIngest(): void {
  const tcpServer = createTcpServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const { appName, event: eventData } = JSON.parse(line);
          if (!eventData) continue;
          insertEventAndProcess(
            eventData as LogEventRecord,
            appName || eventData.workspace_root || null,
          );
          const hookName = eventData.fields?.hook_event_name;
          if (hookName === "sessionStart") {
            handleSessionStart(eventData as LogEventRecord);
          } else if (hookName === "sessionEnd") {
            handleSessionEnd(eventData as LogEventRecord);
          }
        } catch (err) {
          console.error("[tcp] parse error:", err);
        }
      }
    });
    socket.on("error", () => {});
  });
  tcpServer.listen(INGEST_PORT, "127.0.0.1", () => {
    console.log(`TCP ingest listener on 127.0.0.1:${INGEST_PORT}`);
  });
}

// ── start ──

const db = getDb();
restoreRunState(db);
startTcpIngest();

server.listen(port, () => {
  console.log(`Agent Office Dashboard server listening on http://localhost:${port}`);
  void setupHooks(PROJECT_ROOT);
});
