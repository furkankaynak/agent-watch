import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type Database from "better-sqlite3";
import {
  createLogFileCursor,
  formatActivityEvent,
  formatHeartbeat,
  readAppendedLogEvents,
  resolveActivityLogPath,
  type LogFileCursor
} from "./logFile";
import { getDb } from "./database";
import { processEvent } from "./eventProcessor";

const HEARTBEAT_MS = 15_000;
const POLL_MS = 1_000;

export const ACTIVITY_LOG_PATH = resolveActivityLogPath();

const port = Number(process.env.PORT || 4317);

const corsHeaders = {
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Origin": "*"
};

let cursor: LogFileCursor | null = null;

async function pollLogFile() {
  try {
    cursor ??= await createLogFileCursor(ACTIVITY_LOG_PATH);
    const result = await readAppendedLogEvents(ACTIVITY_LOG_PATH, cursor);
    cursor = result.cursor;
    const db = getDb();

    for (const event of result.events) {
      db.prepare(
        "INSERT INTO raw_events (line_number, timestamp, event_type, fields, raw) VALUES (?, ?, ?, ?, ?)"
      ).run(
        event.lineNumber, event.timestamp, event.eventType,
        JSON.stringify(event.fields), event.raw
      );
      processEvent(db, event);
    }

    if (cursor) {
      stateUpsert(db, "log_cursor_offset", String(cursor.offset));
    }
  } catch (error) {
    console.error("Error polling log file", error);
  }
}

function stateUpsert(db: Database.Database, key: string, value: string) {
  db.prepare("INSERT OR REPLACE INTO server_state (key, value) VALUES (?, ?)").run(key, value);
}

function stateGet(db: Database.Database, key: string): string | undefined {
  const row = db.prepare("SELECT value FROM server_state WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
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

  if (request.method !== "GET") {
    writeJson(response, 405, { error: "Method not allowed" });
    return;
  }

  if (url.pathname === "/api/health") {
    writeJson(response, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/snapshot") {
    const db = getDb();
    const rows = db.prepare(
      "SELECT id, line_number, timestamp, event_type, fields, raw FROM raw_events ORDER BY id"
    ).all();

    const events = (rows as any[]).map((row: any) => ({
      lineNumber: row.line_number,
      timestamp: row.timestamp,
      eventType: row.event_type,
      fields: JSON.parse(row.fields),
      raw: row.raw,
    }));

    writeJson(response, 200, events);
    return;
  }

  if (url.pathname === "/api/runs") {
    const db = getDb();
    const runs = db.prepare("SELECT id, label, status, started_at, ended_at FROM runs ORDER BY id DESC LIMIT 50").all();
    writeJson(response, 200, runs);
    return;
  }

  if (url.pathname === "/api/events") {
    streamSseEvents(request, response);
    return;
  }

  writeJson(response, 404, { error: "Not found" });
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

  const pollTimer = setInterval(() => {
    if (closed) return;

    const db = getDb();
    const rows = db.prepare(
      "SELECT id, line_number, timestamp, event_type, fields, raw FROM raw_events WHERE id > ? ORDER BY id"
    ).all(lastEventId);

    for (const row of rows as any[]) {
      const event = {
        id: row.id,
        lineNumber: row.line_number,
        timestamp: row.timestamp,
        eventType: row.event_type,
        fields: JSON.parse(row.fields),
        raw: row.raw,
      };
      response.write(formatActivityEvent(event));
      lastEventId = row.id;
    }

    response.write(formatHeartbeat());
  }, POLL_MS);

  const close = () => {
    closed = true;
    clearInterval(pollTimer);
  };

  request.on("close", close);
  response.on("close", close);
}

// Initialize: resume cursor if saved, start background poller
const db = getDb();
const savedOffset = stateGet(db, "log_cursor_offset");
if (savedOffset) {
  cursor = { offset: Number(savedOffset) } as LogFileCursor;
}
const filePollTimer = setInterval(() => { void pollLogFile(); }, POLL_MS);

server.listen(port, () => {
  console.log(`Agent Office Dashboard server listening on http://localhost:${port}`);
  console.log(`Activity log: ${ACTIVITY_LOG_PATH}`);
});
