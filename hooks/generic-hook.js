#!/usr/bin/env node
const http = require("http");

const INGEST_PORT = process.env.AGENTS_WATCH_PORT || 4317;

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString());

  const timestamp = new Date().toISOString().replace("T", " ").slice(0, 23) + "Z";

  const fields = flattenFields(input, "", {});
  const payload = {
    hook_event_name: input.hook_event_name,
    timestamp,
    ...fields,
  };

  const body = JSON.stringify(payload);

  await new Promise((resolve) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: INGEST_PORT,
        path: "/api/ingest",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        res.resume();
        res.on("end", resolve);
      }
    );
    req.on("error", () => resolve());
    req.write(body);
    req.end();
  });

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

main().catch(() => process.exit(0));
