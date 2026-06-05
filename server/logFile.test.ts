import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  createLogFileCursor,
  formatActivityEvent,
  formatHeartbeat,
  parseLogChunk,
  readAppendedLogEvents,
  readLogSnapshot
} from "./logFile";

const toolStartLine =
  '2026-06-04T01:38:44.985Z | tool_start | conversation_id=ee826 generation_id=eda tool_name=Task input_description="Feature: SSE server"';

const toolDoneLine =
  "2026-06-04T01:38:55.547Z | tool_done | conversation_id=ee826 generation_id=eda tool_name=Task duration_ms=12 ok=true";

const rotatedOriginalLine =
  "2026-06-04T01:38:44.985Z | tool_start | conversation_id=aaaa generation_id=1111 tool_name=Task";

const rotatedReplacementLine =
  "2026-06-04T01:38:44.985Z | tool_start | conversation_id=bbbb generation_id=2222 tool_name=Task";

const tempDirs: string[] = [];

async function tempPath(fileName: string) {
  const dir = await mkdtemp(join(tmpdir(), "agents-watch-"));
  tempDirs.push(dir);
  return join(dir, fileName);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("readLogSnapshot", () => {
  test("returns an empty array when the log file is missing", async () => {
    await expect(readLogSnapshot(await tempPath("missing.log"))).resolves.toEqual([]);
  });

  test("parses valid lines and skips malformed lines", async () => {
    const logPath = await tempPath("activity.log");

    await writeFile(logPath, `${toolStartLine}\nnot an activity log line\n`, "utf8");

    await expect(readLogSnapshot(logPath)).resolves.toEqual([
      {
        lineNumber: 1,
        timestamp: "2026-06-04T01:38:44.985Z",
        eventType: "tool_start",
        fields: {
          conversation_id: "ee826",
          generation_id: "eda",
          tool_name: "Task",
          input_description: "Feature: SSE server"
        },
        raw: toolStartLine
      }
    ]);

    await expect(readFile(logPath, "utf8")).resolves.toContain("not an activity log line");
  });
});

describe("parseLogChunk", () => {
  test("parses only newly completed lines and keeps incomplete text pending", () => {
    const first = parseLogChunk(`${toolStartLine}\nnot complete yet`, {
      nextLineNumber: 7,
      pending: ""
    });

    expect(first.events.map((event) => event.lineNumber)).toEqual([7]);
    expect(first.state).toEqual({ nextLineNumber: 8, pending: "not complete yet" });

    const second = parseLogChunk(` and malformed\n${toolDoneLine}\n`, first.state);

    expect(second.events).toEqual([
      {
        lineNumber: 9,
        timestamp: "2026-06-04T01:38:55.547Z",
        eventType: "tool_done",
        fields: {
          conversation_id: "ee826",
          generation_id: "eda",
          tool_name: "Task",
          duration_ms: "12",
          ok: "true"
        },
        raw: toolDoneLine
      }
    ]);
    expect(second.state).toEqual({ nextLineNumber: 10, pending: "" });
  });
});

describe("readAppendedLogEvents", () => {
  test("waits for a missing file and reads lines after it appears", async () => {
    const logPath = await tempPath("activity.log");
    const cursor = await createLogFileCursor(logPath);

    await writeFile(logPath, `${toolStartLine}\n`, "utf8");

    await expect(readAppendedLogEvents(logPath, cursor)).resolves.toMatchObject({
      events: [
        {
          lineNumber: 1,
          eventType: "tool_start",
          raw: toolStartLine
        }
      ],
      cursor: {
        state: { nextLineNumber: 2, pending: "" }
      }
    });
  });

  test("starts from the current end and emits only appended complete parsed lines", async () => {
    const logPath = await tempPath("activity.log");
    await writeFile(logPath, `${toolStartLine}\n`, "utf8");
    const cursor = await createLogFileCursor(logPath);

    await appendFile(logPath, "not complete yet", "utf8");

    const first = await readAppendedLogEvents(logPath, cursor);
    expect(first.events).toEqual([]);
    expect(first.cursor.state).toEqual({ nextLineNumber: 2, pending: "not complete yet" });

    await appendFile(logPath, ` and malformed\n${toolDoneLine}\n`, "utf8");

    await expect(readAppendedLogEvents(logPath, first.cursor)).resolves.toMatchObject({
      events: [
        {
          lineNumber: 3,
          eventType: "tool_done",
          raw: toolDoneLine
        }
      ],
      cursor: {
        state: { nextLineNumber: 4, pending: "" }
      }
    });
  });

  test("preserves an existing partial-start line when creating a cursor", async () => {
    const logPath = await tempPath("activity.log");
    const splitAt = toolStartLine.indexOf("tool_name=Task");
    const prefix = toolStartLine.slice(0, splitAt);
    const suffix = toolStartLine.slice(splitAt);

    await writeFile(logPath, prefix, "utf8");
    const cursor = await createLogFileCursor(logPath);
    await appendFile(logPath, `${suffix}\n`, "utf8");

    await expect(readAppendedLogEvents(logPath, cursor)).resolves.toMatchObject({
      events: [
        {
          lineNumber: 1,
          eventType: "tool_start",
          raw: toolStartLine,
          fields: {
            conversation_id: "ee826",
            generation_id: "eda",
            tool_name: "Task",
            input_description: "Feature: SSE server"
          }
        }
      ],
      cursor: {
        state: { nextLineNumber: 2, pending: "" }
      }
    });
  });

  test("emits from the beginning after a same-size log rewrite", async () => {
    expect(rotatedReplacementLine).toHaveLength(rotatedOriginalLine.length);

    const logPath = await tempPath("activity.log");
    await writeFile(logPath, `${rotatedOriginalLine}\n`, "utf8");
    const cursor = await createLogFileCursor(logPath);

    await writeFile(logPath, `${rotatedReplacementLine}\n`, "utf8");

    await expect(readAppendedLogEvents(logPath, cursor)).resolves.toMatchObject({
      events: [
        {
          lineNumber: 1,
          eventType: "tool_start",
          raw: rotatedReplacementLine,
          fields: {
            conversation_id: "bbbb",
            generation_id: "2222"
          }
        }
      ],
      cursor: {
        state: { nextLineNumber: 2, pending: "" }
      }
    });
  });

  test("preserves split UTF-8 multibyte characters across poll chunks", async () => {
    const logPath = await tempPath("activity.log");
    const multibyteLine =
      '2026-06-04T01:38:44.985Z | tool_start | conversation_id=utf8 generation_id=test tool_name=Task input_description="Feature café server"';
    const bytes = Buffer.from(`${multibyteLine}\n`, "utf8");
    const marker = Buffer.from("é", "utf8");
    const splitAt = bytes.indexOf(marker) + 1;

    const cursor = await createLogFileCursor(logPath);
    await writeFile(logPath, bytes.subarray(0, splitAt));
    const first = await readAppendedLogEvents(logPath, cursor);

    expect(first.events).toEqual([]);

    await appendFile(logPath, bytes.subarray(splitAt));

    await expect(readAppendedLogEvents(logPath, first.cursor)).resolves.toMatchObject({
      events: [
        {
          lineNumber: 1,
          eventType: "tool_start",
          raw: multibyteLine,
          fields: {
            input_description: "Feature café server"
          }
        }
      ]
    });
  });
});

describe("formatActivityEvent", () => {
  test("formats parsed log events as named SSE activity events", () => {
    expect(
      formatActivityEvent({
        lineNumber: 3,
        timestamp: "2026-06-04T01:38:44.985Z",
        eventType: "tool_start",
        fields: { tool_name: "Task" },
        raw: "raw line"
      })
    ).toBe(
      'event: activity\ndata: {"lineNumber":3,"timestamp":"2026-06-04T01:38:44.985Z","eventType":"tool_start","fields":{"tool_name":"Task"},"raw":"raw line"}\n\n'
    );
  });
});

describe("formatHeartbeat", () => {
  test("formats SSE heartbeat comments", () => {
    expect(formatHeartbeat()).toBe(": ping\n\n");
  });
});
