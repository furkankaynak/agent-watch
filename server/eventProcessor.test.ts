import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { initSchema } from "./database";
import type { LogEvent } from "../src/shared/logTypes";

describe("eventProcessor", () => {
  let db: Database.Database;

  function makeEvent(overrides: Partial<LogEvent>): LogEvent {
    return {
      lineNumber: 1,
      timestamp: "2026-06-04T00:00:00.000Z",
      eventType: "tool_start",
      fields: {},
      raw: "",
      ...overrides,
    };
  }

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    vi.resetModules();
  });

  afterEach(() => {
    db.close();
  });

  it("creates run and agent on first tool_start Task", async () => {
    const { processEvent } = await import("./eventProcessor");

    processEvent(
      db,
      makeEvent({
        eventType: "tool_start",
        fields: {
          tool_name: "Task",
          tool_use_id: "task_1",
          conversation_id: "conv1",
          input_subagent_type: "agent",
        },
      }),
    );

    const run = db.prepare("SELECT * FROM runs").get() as any;
    expect(run).toBeTruthy();
    expect(run.status).toBe("running");

    const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get("task_1") as any;
    expect(agent).toBeTruthy();
    expect(agent.run_id).toBe(run.id);
    expect(agent.status).toBe("incoming");
    expect(agent.label).toBe("Agent");
    expect(agent.agent_type).toBe("agent");
  });

  it("binds subagent_start to the correct agent via subagent_id", async () => {
    const { processEvent } = await import("./eventProcessor");

    processEvent(
      db,
      makeEvent({
        lineNumber: 1,
        eventType: "tool_start",
        fields: {
          tool_name: "Task",
          tool_use_id: "task_1",
          conversation_id: "conv1",
          input_subagent_type: "agent",
        },
      }),
    );

    processEvent(
      db,
      makeEvent({
        lineNumber: 2,
        timestamp: "2026-06-04T00:00:01.000Z",
        eventType: "subagent_start",
        fields: {
          subagent_id: "task_1",
          subagent_type: "agent",
          agent_label: "Test Agent",
          subagent_model: "gpt-4",
          conversation_id: "conv2",
          generation_id: "gen1",
        },
      }),
    );

    const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get("task_1") as any;
    expect(agent.status).toBe("running");
    expect(agent.label).toBe("Test Agent");
    expect(agent.model).toBe("gpt-4");
    expect(agent.last_seen_at).toBe("2026-06-04T00:00:01.000Z");
  });

  it("creates tool_call on tool_start (non-Task)", async () => {
    const { processEvent } = await import("./eventProcessor");

    processEvent(
      db,
      makeEvent({
        lineNumber: 1,
        eventType: "tool_start",
        fields: {
          tool_name: "Task",
          tool_use_id: "task_1",
          conversation_id: "conv1",
          input_subagent_type: "agent",
        },
      }),
    );

    processEvent(
      db,
      makeEvent({
        lineNumber: 2,
        timestamp: "2026-06-04T00:00:01.000Z",
        eventType: "subagent_start",
        fields: {
          subagent_id: "task_1",
          conversation_id: "conv2",
          generation_id: "gen1",
        },
      }),
    );

    processEvent(
      db,
      makeEvent({
        lineNumber: 3,
        timestamp: "2026-06-04T00:00:02.000Z",
        eventType: "tool_start",
        fields: {
          tool_name: "Read",
          tool_use_id: "read_1",
          conversation_id: "conv2",
          generation_id: "gen1",
        },
      }),
    );

    const toolCall = db.prepare("SELECT * FROM tool_calls WHERE id = ?").get("read_1") as any;
    expect(toolCall).toBeTruthy();
    expect(toolCall.agent_id).toBe("task_1");
    expect(toolCall.tool_name).toBe("Read");
    expect(toolCall.status).toBe("started");

    const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get("task_1") as any;
    expect(agent.status).toBe("running");
  });

  it("marks tool_call done and sets agent idle", async () => {
    const { processEvent } = await import("./eventProcessor");

    processEvent(
      db,
      makeEvent({
        lineNumber: 1,
        eventType: "tool_start",
        fields: {
          tool_name: "Task",
          tool_use_id: "task_1",
          conversation_id: "conv1",
          input_subagent_type: "agent",
        },
      }),
    );

    processEvent(
      db,
      makeEvent({
        lineNumber: 2,
        timestamp: "2026-06-04T00:00:01.000Z",
        eventType: "subagent_start",
        fields: {
          subagent_id: "task_1",
          conversation_id: "conv2",
          generation_id: "gen1",
        },
      }),
    );

    processEvent(
      db,
      makeEvent({
        lineNumber: 3,
        timestamp: "2026-06-04T00:00:02.000Z",
        eventType: "tool_start",
        fields: {
          tool_name: "Read",
          tool_use_id: "read_1",
          conversation_id: "conv2",
          generation_id: "gen1",
        },
      }),
    );

    processEvent(
      db,
      makeEvent({
        lineNumber: 4,
        timestamp: "2026-06-04T00:00:03.000Z",
        eventType: "tool_done",
        fields: {
          tool_use_id: "read_1",
          tool_name: "Read",
          ok: "true",
          conversation_id: "conv2",
          generation_id: "gen1",
        },
      }),
    );

    const toolCall = db.prepare("SELECT * FROM tool_calls WHERE id = ?").get("read_1") as any;
    expect(toolCall.status).toBe("done");
    expect(toolCall.ok).toBe(1);
    expect(toolCall.duration_ms).toBe(1000);

    const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get("task_1") as any;
    expect(agent.status).toBe("idle");
  });

  it("marks agent failed on tool_done with ok=false", async () => {
    const { processEvent } = await import("./eventProcessor");

    processEvent(
      db,
      makeEvent({
        lineNumber: 1,
        eventType: "tool_start",
        fields: {
          tool_name: "Task",
          tool_use_id: "task_1",
          conversation_id: "conv1",
          input_subagent_type: "agent",
        },
      }),
    );

    processEvent(
      db,
      makeEvent({
        lineNumber: 2,
        timestamp: "2026-06-04T00:00:01.000Z",
        eventType: "subagent_start",
        fields: {
          subagent_id: "task_1",
          conversation_id: "conv2",
          generation_id: "gen1",
        },
      }),
    );

    processEvent(
      db,
      makeEvent({
        lineNumber: 3,
        timestamp: "2026-06-04T00:00:02.000Z",
        eventType: "tool_start",
        fields: {
          tool_name: "Read",
          tool_use_id: "read_1",
          conversation_id: "conv2",
          generation_id: "gen1",
        },
      }),
    );

    processEvent(
      db,
      makeEvent({
        lineNumber: 4,
        timestamp: "2026-06-04T00:00:03.000Z",
        eventType: "tool_done",
        fields: {
          tool_use_id: "read_1",
          tool_name: "Read",
          ok: "false",
          error_message: "File not found",
          conversation_id: "conv2",
          generation_id: "gen1",
        },
      }),
    );

    const toolCall = db.prepare("SELECT * FROM tool_calls WHERE id = ?").get("read_1") as any;
    expect(toolCall.status).toBe("done");
    expect(toolCall.ok).toBe(0);
    expect(toolCall.error_message).toBe("File not found");

    const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get("task_1") as any;
    expect(agent.status).toBe("failed");
  });

  it("inserts chip on skill_read and binds conversation via FIFO", async () => {
    const { processEvent } = await import("./eventProcessor");

    processEvent(
      db,
      makeEvent({
        lineNumber: 1,
        eventType: "tool_start",
        fields: {
          tool_name: "Task",
          tool_use_id: "task_1",
          conversation_id: "conv1",
          input_subagent_type: "agent",
        },
      }),
    );

    processEvent(
      db,
      makeEvent({
        lineNumber: 2,
        timestamp: "2026-06-04T00:00:01.000Z",
        eventType: "subagent_start",
        fields: {
          subagent_id: "task_1",
          conversation_id: "conv2",
          generation_id: "gen1",
        },
      }),
    );

    processEvent(
      db,
      makeEvent({
        lineNumber: 3,
        timestamp: "2026-06-04T00:00:02.000Z",
        eventType: "skill_read",
        fields: {
          skill: "typescript",
          conversation_id: "conv2",
          generation_id: "gen1",
        },
      }),
    );

    const chip = db.prepare("SELECT * FROM agent_chips").get() as any;
    expect(chip).toBeTruthy();
    expect(chip.agent_id).toBe("task_1");
    expect(chip.chip_type).toBe("skill");
    expect(chip.chip_value).toBe("typescript");
  });

  it("marks agent completed on session_end with final_status=completed", async () => {
    const { processEvent } = await import("./eventProcessor");

    processEvent(
      db,
      makeEvent({
        lineNumber: 1,
        eventType: "tool_start",
        fields: {
          tool_name: "Task",
          tool_use_id: "task_1",
          conversation_id: "conv1",
          input_subagent_type: "agent",
        },
      }),
    );

    processEvent(
      db,
      makeEvent({
        lineNumber: 2,
        timestamp: "2026-06-04T00:00:01.000Z",
        eventType: "subagent_start",
        fields: {
          subagent_id: "task_1",
          conversation_id: "conv2",
          generation_id: "gen1",
        },
      }),
    );

    processEvent(
      db,
      makeEvent({
        lineNumber: 3,
        timestamp: "2026-06-04T00:00:02.000Z",
        eventType: "session_end",
        fields: {
          final_status: "completed",
          conversation_id: "conv2",
          generation_id: "gen1",
        },
      }),
    );

    const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get("task_1") as any;
    expect(agent.status).toBe("completed");
    expect(agent.completed_at).toBeTruthy();

    const run = db.prepare("SELECT * FROM runs").get() as any;
    expect(run.status).toBe("completed");
    expect(run.ended_at).toBeTruthy();
  });

  it("sets parent_agent_id for nested Task agents", async () => {
    const { processEvent } = await import("./eventProcessor");

    processEvent(
      db,
      makeEvent({
        lineNumber: 1,
        eventType: "tool_start",
        fields: {
          tool_name: "Task",
          tool_use_id: "parent_1",
          conversation_id: "conv1",
          input_subagent_type: "agent",
        },
      }),
    );

    processEvent(
      db,
      makeEvent({
        lineNumber: 2,
        timestamp: "2026-06-04T00:00:01.000Z",
        eventType: "subagent_start",
        fields: {
          subagent_id: "parent_1",
          conversation_id: "conv2",
          generation_id: "gen1",
        },
      }),
    );

    processEvent(
      db,
      makeEvent({
        lineNumber: 3,
        timestamp: "2026-06-04T00:00:02.000Z",
        eventType: "tool_start",
        fields: {
          tool_name: "Task",
          tool_use_id: "child_1",
          conversation_id: "conv2",
          generation_id: "gen1",
          input_subagent_type: "agent",
        },
      }),
    );

    const child = db.prepare("SELECT * FROM agents WHERE id = ?").get("child_1") as any;
    expect(child.parent_agent_id).toBe("parent_1");
  });

  it("creates a new run when no agents are active", async () => {
    const { processEvent } = await import("./eventProcessor");

    processEvent(
      db,
      makeEvent({
        lineNumber: 1,
        eventType: "tool_start",
        fields: {
          tool_name: "Task",
          tool_use_id: "root_1",
          conversation_id: "conv1",
          input_subagent_type: "agent",
        },
      }),
    );

    processEvent(
      db,
      makeEvent({
        lineNumber: 2,
        timestamp: "2026-06-04T00:00:01.000Z",
        eventType: "subagent_start",
        fields: {
          subagent_id: "root_1",
          conversation_id: "conv2",
          generation_id: "gen1",
        },
      }),
    );

    processEvent(
      db,
      makeEvent({
        lineNumber: 3,
        timestamp: "2026-06-04T00:00:02.000Z",
        eventType: "session_end",
        fields: {
          final_status: "completed",
          conversation_id: "conv2",
          generation_id: "gen1",
        },
      }),
    );

    const run1 = db.prepare("SELECT * FROM runs").get() as any;
    expect(run1.status).toBe("completed");

    processEvent(
      db,
      makeEvent({
        lineNumber: 4,
        timestamp: "2026-06-04T00:00:03.000Z",
        eventType: "tool_start",
        fields: {
          tool_name: "Task",
          tool_use_id: "root_2",
          conversation_id: "conv3",
          input_subagent_type: "agent",
        },
      }),
    );

    const allRuns = db.prepare("SELECT * FROM runs ORDER BY id").all() as any[];
    expect(allRuns.length).toBe(2);
    expect(allRuns[1].status).toBe("running");
    expect(allRuns[1].id).not.toBe(run1.id);
  });

  it("marks agent completed on hook_event subagentStop", async () => {
    const { processEvent } = await import("./eventProcessor");

    processEvent(
      db,
      makeEvent({
        lineNumber: 1,
        eventType: "tool_start",
        fields: {
          tool_name: "Task",
          tool_use_id: "agent_1",
          conversation_id: "conv1",
          input_subagent_type: "agent",
        },
      }),
    );

    processEvent(
      db,
      makeEvent({
        lineNumber: 2,
        timestamp: "2026-06-04T00:00:01.000Z",
        eventType: "subagent_start",
        fields: {
          subagent_id: "agent_1",
          conversation_id: "conv2",
          generation_id: "gen1",
        },
      }),
    );

    processEvent(
      db,
      makeEvent({
        lineNumber: 3,
        timestamp: "2026-06-04T00:00:02.000Z",
        eventType: "hook_event",
        fields: {
          hook_event_name: "subagentStop",
          status: "completed",
          conversation_id: "conv2",
          generation_id: "gen1",
        },
      }),
    );

    const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get("agent_1") as any;
    expect(agent.status).toBe("completed");
  });

  it("marks agent failed on hook_event stop", async () => {
    const { processEvent } = await import("./eventProcessor");

    processEvent(
      db,
      makeEvent({
        lineNumber: 1,
        eventType: "tool_start",
        fields: {
          tool_name: "Task",
          tool_use_id: "agent_s",
          conversation_id: "conv1",
          input_subagent_type: "agent",
        },
      }),
    );

    processEvent(
      db,
      makeEvent({
        lineNumber: 2,
        timestamp: "2026-06-04T00:00:01.000Z",
        eventType: "subagent_start",
        fields: {
          subagent_id: "agent_s",
          conversation_id: "conv_s",
          generation_id: "gen_s",
        },
      }),
    );

    processEvent(
      db,
      makeEvent({
        lineNumber: 3,
        timestamp: "2026-06-04T00:00:02.000Z",
        eventType: "hook_event",
        fields: {
          hook_event_name: "stop",
          status: "error",
          conversation_id: "conv_s",
          generation_id: "gen_s",
        },
      }),
    );

    const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get("agent_s") as any;
    expect(agent.status).toBe("failed");
  });

  it("completes run when root agent receives hook_event stop completed", async () => {
    const { processEvent } = await import("./eventProcessor");

    processEvent(
      db,
      makeEvent({
        lineNumber: 1,
        eventType: "tool_start",
        fields: {
          tool_name: "Task",
          tool_use_id: "root_h",
          conversation_id: "conv_h",
          input_subagent_type: "agent",
        },
      }),
    );

    processEvent(
      db,
      makeEvent({
        lineNumber: 2,
        timestamp: "2026-06-04T00:00:01.000Z",
        eventType: "subagent_start",
        fields: {
          subagent_id: "root_h",
          conversation_id: "conv_hs",
          generation_id: "gen_hs",
        },
      }),
    );

    processEvent(
      db,
      makeEvent({
        lineNumber: 3,
        timestamp: "2026-06-04T00:00:02.000Z",
        eventType: "hook_event",
        fields: {
          hook_event_name: "stop",
          status: "completed",
          conversation_id: "conv_hs",
          generation_id: "gen_hs",
        },
      }),
    );

    const run = db.prepare("SELECT * FROM runs").get() as any;
    expect(run.status).toBe("completed");
  });

  it("touches agent on generic hook_event without changing status", async () => {
    const { processEvent } = await import("./eventProcessor");

    processEvent(
      db,
      makeEvent({
        lineNumber: 1,
        eventType: "tool_start",
        fields: {
          tool_name: "Task",
          tool_use_id: "agent_g",
          conversation_id: "conv_g",
          input_subagent_type: "agent",
        },
      }),
    );

    processEvent(
      db,
      makeEvent({
        lineNumber: 2,
        timestamp: "2026-06-04T00:00:01.000Z",
        eventType: "subagent_start",
        fields: {
          subagent_id: "agent_g",
          conversation_id: "conv_gs",
          generation_id: "gen_gs",
        },
      }),
    );

    processEvent(
      db,
      makeEvent({
        lineNumber: 3,
        timestamp: "2026-06-04T00:00:02.000Z",
        eventType: "hook_event",
        fields: {
          hook_event_name: "beforeReadFile",
          conversation_id: "conv_gs",
          generation_id: "gen_gs",
        },
      }),
    );

    const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get("agent_g") as any;
    expect(agent.status).toBe("running");
    expect(agent.last_seen_at).toBe("2026-06-04T00:00:02.000Z");
  });
});
