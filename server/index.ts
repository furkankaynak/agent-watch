import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  createLogFileCursor,
  formatActivityEvent,
  formatHeartbeat,
  readAppendedLogEvents,
  readLogSnapshot,
  resolveActivityLogPath,
  type LogFileCursor
} from "./logFile";

const HEARTBEAT_MS = 15_000;
const POLL_MS = 1_000;

export const ACTIVITY_LOG_PATH = resolveActivityLogPath();

const port = Number(process.env.PORT || 4317);

const corsHeaders = {
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Origin": "*"
};

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
    writeJson(response, 200, await readLogSnapshot(ACTIVITY_LOG_PATH));
    return;
  }

  if (url.pathname === "/api/events") {
    streamLogEvents(request, response);
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

function streamLogEvents(request: IncomingMessage, response: ServerResponse) {
  response.writeHead(200, {
    ...corsHeaders,
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8",
    "X-Accel-Buffering": "no"
  });
  response.flushHeaders();

  let closed = false;
  let cursor: LogFileCursor | null = null;
  let polling = false;

  const poll = async () => {
    if (closed || polling) {
      return;
    }

    polling = true;

    try {
      cursor ??= await createLogFileCursor(ACTIVITY_LOG_PATH);

      if (closed) {
        return;
      }

      const result = await readAppendedLogEvents(ACTIVITY_LOG_PATH, cursor);
      cursor = result.cursor;

      if (closed) {
        return;
      }

      for (const event of result.events) {
        response.write(formatActivityEvent(event));
      }
    } catch (error) {
      console.error("Error tailing activity log", error);
    } finally {
      polling = false;
    }
  };

  const pollTimer = setInterval(() => {
    void poll();
  }, POLL_MS);
  const heartbeatTimer = setInterval(() => {
    if (!closed) {
      response.write(formatHeartbeat());
    }
  }, HEARTBEAT_MS);

  const close = () => {
    closed = true;
    clearInterval(pollTimer);
    clearInterval(heartbeatTimer);
  };

  request.on("close", close);
  response.on("close", close);
  void poll();
}

server.listen(port, () => {
  console.log(`Agent Office Dashboard server listening on http://localhost:${port}`);
  console.log(`Activity log: ${ACTIVITY_LOG_PATH}`);
});
