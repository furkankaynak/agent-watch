import type { Stats } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { LogEvent } from "../src/shared/logTypes";
import { parseLogLine } from "../src/shared/parseLogLine";

const TAIL_SIGNATURE_BYTES = 64;

export type LogChunkState = {
  nextLineNumber: number;
  pending: string;
};

export type LogFileCursor = {
  offset: number;
  state: LogChunkState;
  fileId: FileIdentity | null;
  tailSignature: Buffer;
  decoder: StringDecoder;
};

type FileIdentity = {
  dev: number;
  ino: number;
};

function loadEnvFile(path: string): Record<string, string> {
  const vars: Record<string, string> = {};

  try {
    const content = readFileSync(path, "utf8");

    for (const line of content.split("\n")) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const eqIndex = trimmed.indexOf("=");

      if (eqIndex === -1) {
        continue;
      }

      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();

      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      if (key) {
        vars[key] = value;
      }
    }
  } catch {
    // .env doesn't exist or can't be read — ignore
  }

  return vars;
}

export function resolveActivityLogPath() {
  const envVar = process.env.ACTIVITY_LOG_PATH;

  if (envVar) {
    return resolve(envVar);
  }

  const envFile = loadEnvFile(resolve(process.cwd(), ".env"));
  const envFileValue = envFile.ACTIVITY_LOG_PATH;

  if (envFileValue) {
    return resolve(envFileValue);
  }

  return resolve(process.cwd(), "activity.log");
}

export async function readLogSnapshot(logPath: string): Promise<LogEvent[]> {
  try {
    return parseLogContent(await readFile(logPath, "utf8"));
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }

    throw error;
  }
}

export function parseLogChunk(chunk: string, state: LogChunkState) {
  const text = `${state.pending}${chunk}`;
  const parts = text.split("\n");
  const pending = text.endsWith("\n") ? "" : parts.pop() ?? "";
  const completeLines = text.endsWith("\n") ? parts.slice(0, -1) : parts;
  const events: LogEvent[] = [];
  let nextLineNumber = state.nextLineNumber;

  for (const line of completeLines) {
    const event = parseLogLine(stripTrailingCarriageReturn(line), nextLineNumber);

    if (event) {
      events.push(event);
    }

    nextLineNumber += 1;
  }

  return {
    events,
    state: { nextLineNumber, pending }
  };
}

export async function createLogFileCursor(logPath: string): Promise<LogFileCursor> {
  try {
    const stats = await stat(logPath);
    const content = await readFile(logPath);
    const decoder = new StringDecoder("utf8");
    const parsed = parseLogChunk(decoder.write(content), { nextLineNumber: 1, pending: "" });

    return {
      offset: content.byteLength,
      state: parsed.state,
      fileId: toFileIdentity(stats),
      tailSignature: getTailSignature(content),
      decoder
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return createEmptyCursor();
    }

    throw error;
  }
}

export async function readAppendedLogEvents(logPath: string, cursor: LogFileCursor) {
  try {
    const stats = await stat(logPath);
    const activeCursor = await getActiveCursor(logPath, stats, cursor);

    if (stats.size === activeCursor.offset) {
      return { events: [], cursor: activeCursor };
    }

    const file = await open(logPath, "r");

    try {
      const buffer = Buffer.alloc(stats.size - activeCursor.offset);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, activeCursor.offset);
      const chunk = buffer.subarray(0, bytesRead);
      const parsed = parseLogChunk(activeCursor.decoder.write(chunk), activeCursor.state);

      return {
        events: parsed.events,
        cursor: {
          offset: activeCursor.offset + bytesRead,
          state: parsed.state,
          fileId: toFileIdentity(stats),
          tailSignature: updateTailSignature(activeCursor.tailSignature, chunk),
          decoder: activeCursor.decoder
        }
      };
    } finally {
      await file.close();
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      return { events: [], cursor: createEmptyCursor() };
    }

    throw error;
  }
}

export function formatActivityEvent(event: LogEvent) {
  return `event: activity\ndata: ${JSON.stringify(event)}\n\n`;
}

export function formatHeartbeat() {
  return ": ping\n\n";
}

function parseLogContent(content: string) {
  return parseLogChunk(content.endsWith("\n") ? content : `${content}\n`, {
    nextLineNumber: 1,
    pending: ""
  }).events;
}

function createEmptyCursor(): LogFileCursor {
  return {
    offset: 0,
    state: { nextLineNumber: 1, pending: "" },
    fileId: null,
    tailSignature: Buffer.alloc(0),
    decoder: new StringDecoder("utf8")
  };
}

async function getActiveCursor(logPath: string, stats: Stats, cursor: LogFileCursor) {
  if (stats.size < cursor.offset || hasFileIdentityChanged(cursor, stats)) {
    return createEmptyCursor();
  }

  if (!(await tailSignatureMatches(logPath, cursor))) {
    return createEmptyCursor();
  }

  return cursor;
}

function hasFileIdentityChanged(cursor: LogFileCursor, stats: Stats) {
  return cursor.fileId !== null && !sameFileIdentity(cursor.fileId, toFileIdentity(stats));
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity) {
  return left.dev === right.dev && left.ino === right.ino;
}

function toFileIdentity(stats: Stats): FileIdentity {
  return { dev: stats.dev, ino: stats.ino };
}

async function tailSignatureMatches(logPath: string, cursor: LogFileCursor) {
  if (cursor.tailSignature.byteLength === 0) {
    return true;
  }

  const file = await open(logPath, "r");

  try {
    const buffer = Buffer.alloc(cursor.tailSignature.byteLength);
    const { bytesRead } = await file.read(
      buffer,
      0,
      buffer.byteLength,
      cursor.offset - cursor.tailSignature.byteLength
    );

    return bytesRead === cursor.tailSignature.byteLength && buffer.equals(cursor.tailSignature);
  } finally {
    await file.close();
  }
}

function getTailSignature(buffer: Buffer) {
  return Buffer.from(buffer.subarray(Math.max(0, buffer.byteLength - TAIL_SIGNATURE_BYTES)));
}

function updateTailSignature(tailSignature: Buffer, chunk: Buffer) {
  return getTailSignature(Buffer.concat([tailSignature, chunk]));
}

function stripTrailingCarriageReturn(line: string) {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

function isMissingFileError(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
