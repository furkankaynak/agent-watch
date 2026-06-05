import type { LogEvent } from "./logTypes";

const LINE_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) \| ([^|]+) \| (.*)$/;
const FIELD_PATTERN = /(\w+)=("(?:\\.|[^"\\])*"|\S+)/g;

export function parseLogLine(line: string, lineNumber: number): LogEvent | null {
  const match = line.match(LINE_PATTERN);

  if (!match) {
    return null;
  }

  const [, timestamp, eventType, fieldText] = match;
  const fields: Record<string, string> = {};

  for (const fieldMatch of fieldText.matchAll(FIELD_PATTERN)) {
    const [, key, value] = fieldMatch;
    fields[key] = value.startsWith('"') && value.endsWith('"')
      ? value.slice(1, -1).replace(/\\"/g, '"')
      : value;
  }

  return {
    lineNumber,
    timestamp,
    eventType,
    fields,
    raw: line
  };
}
