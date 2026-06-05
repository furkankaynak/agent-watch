import { describe, expect, test } from "vitest";
import type { LogEvent } from "./logTypes";
import { reduceWorkflowEvents, selectAgents } from "./workflowReducer";

const START = Date.parse("2026-06-04T00:00:00.000Z");

function timestamp(offsetMs: number): string {
  return new Date(START + offsetMs).toISOString();
}

function event(
  eventType: string,
  offsetMs: number,
  fields: Record<string, string>,
  lineNumber = 1
): LogEvent {
  return {
    lineNumber,
    timestamp: timestamp(offsetMs),
    eventType,
    fields,
    raw: `${eventType} ${lineNumber}`
  };
}

function taskStart(toolUseId: string, offsetMs = 0): LogEvent {
  return event("tool_start", offsetMs, {
    conversation_id: "caller-conversation",
    tool_name: "Task",
    tool_use_id: toolUseId,
    input_subagent_type: "code_reviewer",
    input_description: "Review the reducer implementation"
  });
}

function subagentStart(toolUseId: string, offsetMs = 1): LogEvent {
  return event("subagent_start", offsetMs, {
    conversation_id: "caller-conversation",
    subagent_id: toolUseId,
    subagent_type: "code_reviewer",
    agent_label: "Senior Code Reviewer",
    subagent_model: "composer-2.5"
  });
}

function bindAgent(conversationId: string, offsetMs = 2, generationId = "gen-1"): LogEvent {
  return event("skill_read", offsetMs, {
    conversation_id: conversationId,
    generation_id: generationId,
    skill: "test-driven-development"
  });
}

describe("workflowReducer", () => {
  test("creates an incoming agent and task call for Task tool_start", () => {
    const state = reduceWorkflowEvents([taskStart("task-1")]);

    expect(state.agents["task-1"]).toMatchObject({
      id: "task-1",
      subagentId: "code_reviewer",
      label: "Code Reviewer",
      type: "code_reviewer",
      description: "Review the reducer implementation",
      status: "incoming",
      skills: [],
      rules: [],
      decisions: [],
      activeTools: {},
      lastSeenAt: START,
      errors: []
    });
    expect(state.taskCalls).toEqual([
      {
        id: "task-1",
        conversationId: "caller-conversation",
        subagentType: "code_reviewer",
        description: "Review the reducer implementation",
        timestamp: timestamp(0)
      }
    ]);
  });

  test("subagent_start updates the pending agent and queues it without binding the caller conversation", () => {
    const state = reduceWorkflowEvents([taskStart("task-1"), subagentStart("task-1")]);

    expect(state.agents["task-1"]).toMatchObject({
      id: "task-1",
      subagentId: "task-1",
      label: "Senior Code Reviewer",
      type: "code_reviewer",
      model: "composer-2.5",
      status: "running",
      lastSeenAt: START + 1
    });
    expect(state.unboundAgentIds).toEqual(["task-1"]);
    expect(state.conversationToAgentId["caller-conversation"]).toBeUndefined();
  });

  test("uses subagent_id to update the matching task when multiple incoming agents share a type", () => {
    const state = reduceWorkflowEvents([
      taskStart("task-1", 0),
      taskStart("task-2", 1),
      subagentStart("task-2", 2)
    ]);

    expect(state.agents["task-1"].status).toBe("incoming");
    expect(state.agents["task-2"]).toMatchObject({
      subagentId: "task-2",
      label: "Senior Code Reviewer",
      model: "composer-2.5",
      status: "running"
    });
  });

  test("uses subagent_model for the displayed agent model", () => {
    const state = reduceWorkflowEvents([taskStart("task-1"), subagentStart("task-1")]);

    expect(state.agents["task-1"].model).toBe("composer-2.5");
  });

  test("binds the first unknown conversation to the earliest queued agent before applying resource events", () => {
    const state = reduceWorkflowEvents([
      taskStart("task-1"),
      subagentStart("task-1"),
      bindAgent("child-conversation")
    ]);

    expect(state.conversationToAgentId["child-conversation:gen-1"]).toBe("task-1");
    expect(state.unboundAgentIds).toEqual([]);
    expect(state.agents["task-1"].skills).toEqual(["test-driven-development"]);
  });

  test("binds a reused conversation with a new generation to the newly queued agent", () => {
    const state = reduceWorkflowEvents([
      taskStart("task-1", 0),
      subagentStart("task-1", 1),
      bindAgent("shared-child-conversation", 2, "gen-1"),
      taskStart("task-2", 3),
      subagentStart("task-2", 4),
      bindAgent("shared-child-conversation", 5, "gen-2")
    ]);

    expect(state.conversationToAgentId["shared-child-conversation:gen-1"]).toBe("task-1");
    expect(state.conversationToAgentId["shared-child-conversation:gen-2"]).toBe("task-2");
    expect(state.agents["task-1"].skills).toEqual(["test-driven-development"]);
    expect(state.agents["task-2"].skills).toEqual(["test-driven-development"]);
  });

  test("falls back to the latest bare conversation agent when no unbound agent is queued", () => {
    const state = reduceWorkflowEvents([
      taskStart("task-1", 0),
      subagentStart("task-1", 1),
      bindAgent("child-conversation", 2, "gen-1"),
      event("rule_read", 3, {
        conversation_id: "child-conversation",
        generation_id: "gen-2",
        rule: "same-agent-generation"
      })
    ]);

    expect(state.agents["task-1"].rules).toEqual(["same-agent-generation"]);
  });

  test("appends unique skill, rule, and decision chips to the bound agent", () => {
    const state = reduceWorkflowEvents([
      taskStart("task-1"),
      subagentStart("task-1"),
      bindAgent("child-conversation"),
      event("skill_read", 3, {
        conversation_id: "child-conversation",
        skill: "test-driven-development"
      }),
      event("skill_read", 4, {
        conversation_id: "child-conversation",
        skill: "brainstorming"
      }),
      event("rule_read", 5, {
        conversation_id: "child-conversation",
        rule: "no-commit"
      }),
      event("rule_read", 6, {
        conversation_id: "child-conversation",
        rule: "no-commit"
      }),
      event("decisions_read", 7, {
        conversation_id: "child-conversation",
        decision: "Use a pure reducer"
      }),
      event("decisions_read", 8, {
        conversation_id: "child-conversation",
        decision: "Use a pure reducer"
      })
    ]);

    expect(state.agents["task-1"].skills).toEqual([
      "test-driven-development",
      "brainstorming"
    ]);
    expect(state.agents["task-1"].rules).toEqual(["no-commit"]);
    expect(state.agents["task-1"].decisions).toEqual(["Use a pure reducer"]);
  });

  test("tracks bound active tools and last action details from paths", () => {
    const state = reduceWorkflowEvents([
      taskStart("task-1"),
      subagentStart("task-1"),
      bindAgent("child-conversation"),
      event("tool_start", 3, {
        conversation_id: "child-conversation",
        tool_name: "Read",
        tool_use_id: "read-1",
        input_file_path: "/Users/furkan/project/src/App.tsx"
      })
    ]);

    expect(state.agents["task-1"].activeTools).toEqual({ "read-1": "Read" });
    expect(state.agents["task-1"].lastAction).toBe("Read App.tsx");
  });

  test("removes completed tools and marks failed tool completions as errors", () => {
    const state = reduceWorkflowEvents([
      taskStart("task-1"),
      subagentStart("task-1"),
      bindAgent("child-conversation"),
      event("tool_start", 3, {
        conversation_id: "child-conversation",
        tool_name: "Read",
        tool_use_id: "read-1",
        input_file_path: "/Users/furkan/project/src/App.tsx"
      }),
      event("tool_done", 4, {
        conversation_id: "child-conversation",
        tool_name: "Read",
        tool_use_id: "read-1",
        ok: "true"
      }),
      event("tool_start", 5, {
        conversation_id: "child-conversation",
        tool_name: "Shell",
        tool_use_id: "shell-1",
        input_command: "npm test"
      }),
      event("tool_done", 6, {
        conversation_id: "child-conversation",
        hook_event_name: "postToolUseFailure",
        tool_name: "Shell",
        tool_use_id: "shell-1",
        ok: "false",
        error_message: "Command failed"
      })
    ]);

    expect(state.agents["task-1"].activeTools).toEqual({});
    expect(state.agents["task-1"].status).toBe("failed");
    expect(state.agents["task-1"].errors).toEqual(["Command failed"]);
  });

  test("maps session_end final statuses without completing generating sessions", () => {
    const state = reduceWorkflowEvents([
      taskStart("completed-task", 0),
      subagentStart("completed-task", 1),
      bindAgent("completed-conversation", 2),
      event("session_end", 3, {
        conversation_id: "completed-conversation",
        final_status: "completed"
      }),
      taskStart("aborted-task", 4),
      subagentStart("aborted-task", 5),
      bindAgent("aborted-conversation", 6),
      event("session_end", 7, {
        conversation_id: "aborted-conversation",
        final_status: "aborted"
      }),
      taskStart("generating-task", 8),
      subagentStart("generating-task", 9),
      bindAgent("generating-conversation", 10),
      event("session_end", 11, {
        conversation_id: "generating-conversation",
        final_status: "generating"
      })
    ]);

    expect(state.agents["completed-task"].status).toBe("completed");
    expect(state.agents["aborted-task"].status).toBe("failed");
    expect(state.agents["generating-task"].status).toBe("running");
  });

  test("selectAgents derives stale status for old running and idle agents only", () => {
    const state = reduceWorkflowEvents([
      taskStart("running-task", 0),
      subagentStart("running-task", 1),
      bindAgent("running-conversation", 2),
      taskStart("idle-task", 3),
      subagentStart("idle-task", 4),
      bindAgent("idle-conversation", 5),
      event("tool_start", 6, {
        conversation_id: "idle-conversation",
        tool_name: "Read",
        tool_use_id: "read-1"
      }),
      event("tool_done", 7, {
        conversation_id: "idle-conversation",
        tool_name: "Read",
        tool_use_id: "read-1",
        ok: "true"
      }),
      taskStart("completed-task", 8),
      subagentStart("completed-task", 9),
      bindAgent("completed-conversation", 10),
      event("session_end", 11, {
        conversation_id: "completed-conversation",
        final_status: "completed"
      }),
      taskStart("failed-task", 12),
      subagentStart("failed-task", 13),
      bindAgent("failed-conversation", 14),
      event("session_end", 15, {
        conversation_id: "failed-conversation",
        final_status: "unknown"
      })
    ]);

    const agents = selectAgents(state, START + 45_100);
    const statuses = Object.fromEntries(agents.map((agent) => [agent.id, agent.status]));

    expect(statuses["running-task"]).toBe("stale");
    expect(statuses["idle-task"]).toBe("stale");
    expect(statuses["completed-task"]).toBe("completed");
    expect(statuses["failed-task"]).toBe("failed");
  });
});
