import type { LogEvent } from "../src/shared/logTypes";

const HOOK_TO_EVENT_TYPE: Record<string, string> = {
  preToolUse: "tool_start",
  postToolUse: "tool_done",
  postToolUseFailure: "tool_done",
  subagentStart: "subagent_start",
};

const SESSION_HOOKS = new Set(["sessionStart", "sessionEnd"]);

let nextLineNumber = 0;

export function mapHookToLogEvent(
  hookPayload: Record<string, unknown>,
): LogEvent | null {
  const hookName = hookPayload.hook_event_name as string | undefined;
  if (!hookName) return null;

  const timestamp = (hookPayload.timestamp as string) || new Date().toISOString();
  const eventType = HOOK_TO_EVENT_TYPE[hookName] ?? "hook_event";

  const fields = flattenFields(hookPayload);

  if (hookName === "postToolUseFailure") {
    fields.ok = "false";
  }
  if (hookName === "postToolUse") {
    fields.ok = "true";
  }

  nextLineNumber++;

  return {
    lineNumber: nextLineNumber,
    timestamp,
    eventType,
    fields,
    raw: JSON.stringify(hookPayload),
  };
}

export function isSessionHook(event: LogEvent): boolean {
  const hookName = event.fields.hook_event_name;
  return hookName ? SESSION_HOOKS.has(hookName) : false;
}

export function isSessionStartHook(event: LogEvent): boolean {
  return event.fields.hook_event_name === "sessionStart";
}

export function isSessionEndHook(event: LogEvent): boolean {
  return event.fields.hook_event_name === "sessionEnd";
}

function flattenFields(
  obj: Record<string, unknown>,
  prefix = "",
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    const fullKey = prefix ? `${prefix}_${key}` : key;

    if (Array.isArray(value)) {
      result[fullKey] = JSON.stringify(value);
    } else if (typeof value === "object") {
      Object.assign(result, flattenFields(value as Record<string, unknown>, fullKey));
    } else {
      result[fullKey] = String(value);
    }
  }

  return result;
}
