import { describe, it, expect } from "vitest";
import { mapHookToLogEvent, isSessionHook, isSessionStartHook, isSessionEndHook } from "./hookMapper";

describe("mapHookToLogEvent", () => {
  it("maps preToolUse to tool_start", () => {
    const event = mapHookToLogEvent({
      hook_event_name: "preToolUse",
      timestamp: "2026-06-09T00:00:00Z",
      tool_name: "Read",
      tool_use_id: "abc-123",
      conversation_id: "conv-1",
      tool_input: { file_path: "/test.ts" },
    });
    expect(event).toBeTruthy();
    expect(event!.eventType).toBe("tool_start");
    expect(event!.fields.tool_name).toBe("Read");
    expect(event!.fields.tool_input_file_path).toBe("/test.ts");
    expect(event!.fields.conversation_id).toBe("conv-1");
  });

  it("maps postToolUse to tool_done with ok=true", () => {
    const event = mapHookToLogEvent({
      hook_event_name: "postToolUse",
      timestamp: "2026-06-09T00:00:00Z",
      tool_name: "Read",
      conversation_id: "conv-1",
    });
    expect(event).toBeTruthy();
    expect(event!.eventType).toBe("tool_done");
    expect(event!.fields.ok).toBe("true");
  });

  it("maps postToolUseFailure to tool_done with ok=false", () => {
    const event = mapHookToLogEvent({
      hook_event_name: "postToolUseFailure",
      timestamp: "2026-06-09T00:00:00Z",
      tool_name: "Read",
      error_message: "timeout",
    });
    expect(event).toBeTruthy();
    expect(event!.eventType).toBe("tool_done");
    expect(event!.fields.ok).toBe("false");
    expect(event!.fields.error_message).toBe("timeout");
  });

  it("maps subagentStart to subagent_start", () => {
    const event = mapHookToLogEvent({
      hook_event_name: "subagentStart",
      timestamp: "2026-06-09T00:00:00Z",
      subagent_id: "sub-1",
      subagent_type: "explore",
    });
    expect(event).toBeTruthy();
    expect(event!.eventType).toBe("subagent_start");
    expect(event!.fields.subagent_id).toBe("sub-1");
  });

  it("maps unknown hooks to hook_event", () => {
    const event = mapHookToLogEvent({
      hook_event_name: "beforeReadFile",
      timestamp: "2026-06-09T00:00:00Z",
      file_path: "/test.ts",
    });
    expect(event).toBeTruthy();
    expect(event!.eventType).toBe("hook_event");
    expect(event!.fields.hook_event_name).toBe("beforeReadFile");
  });

  it("returns null when hook_event_name is missing", () => {
    const event = mapHookToLogEvent({
      timestamp: "2026-06-09T00:00:00Z",
    });
    expect(event).toBeNull();
  });

  it("flattens nested objects in fields", () => {
    const event = mapHookToLogEvent({
      hook_event_name: "preToolUse",
      timestamp: "2026-06-09T00:00:00Z",
      tool_input: {
        command: "npm test",
        working_directory: "/project",
      },
    });
    expect(event).toBeTruthy();
    expect(event!.fields.tool_input_command).toBe("npm test");
    expect(event!.fields.tool_input_working_directory).toBe("/project");
  });

  it("stringifies arrays in fields", () => {
    const event = mapHookToLogEvent({
      hook_event_name: "subagentStop",
      timestamp: "2026-06-09T00:00:00Z",
      modified_files: ["src/auth.ts", "src/login.ts"],
    });
    expect(event).toBeTruthy();
    expect(event!.fields.modified_files).toBe('["src/auth.ts","src/login.ts"]');
  });

  it("skips null and undefined values", () => {
    const event = mapHookToLogEvent({
      hook_event_name: "preToolUse",
      timestamp: "2026-06-09T00:00:00Z",
      nullField: null,
      undefinedField: undefined,
      validField: "value",
    });
    expect(event).toBeTruthy();
    expect(event!.fields.validField).toBe("value");
    expect(event!.fields.nullField).toBeUndefined();
    expect(event!.fields.undefinedField).toBeUndefined();
  });
});

describe("session hook detection", () => {
  it("detects sessionStart as session hook", () => {
    const event = mapHookToLogEvent({
      hook_event_name: "sessionStart",
      timestamp: "2026-06-09T00:00:00Z",
      conversation_id: "conv-1",
    });
    expect(isSessionHook(event!)).toBe(true);
    expect(isSessionStartHook(event!)).toBe(true);
    expect(isSessionEndHook(event!)).toBe(false);
  });

  it("detects sessionEnd as session hook", () => {
    const event = mapHookToLogEvent({
      hook_event_name: "sessionEnd",
      timestamp: "2026-06-09T00:00:00Z",
      conversation_id: "conv-1",
    });
    expect(isSessionHook(event!)).toBe(true);
    expect(isSessionStartHook(event!)).toBe(false);
    expect(isSessionEndHook(event!)).toBe(true);
  });

  it("does not detect other hooks as session hooks", () => {
    const event = mapHookToLogEvent({
      hook_event_name: "preToolUse",
      timestamp: "2026-06-09T00:00:00Z",
    });
    expect(isSessionHook(event!)).toBe(false);
  });
});
