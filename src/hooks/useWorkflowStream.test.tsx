import { describe, expect, test, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useWorkflowStream } from "./useWorkflowStream";

class MockEventSource {
  url: string;
  readyState: number = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners: Record<string, Array<(event: { data?: string }) => void>> = {};

  constructor(url: string) {
    this.url = url;
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
      const handlers = this.listeners["open"];
      if (handlers) for (const fn of handlers) fn({});
    }, 5);
  }

  addEventListener(type: string, handler: (event: { data?: string }) => void) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(handler);
  }

  close() {
    this.readyState = 2;
  }

  emit(type: string, data?: string) {
    if (type === "open") {
      this.readyState = 1;
      this.onopen?.();
    }
    if (type === "error") {
      this.readyState = 2;
      this.onerror?.();
    }
    const handlers = this.listeners[type];
    if (handlers) {
      for (const fn of handlers) {
        fn({ data });
      }
    }
  }
}

describe("useWorkflowStream", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("sets connectionStatus to live when EventSource opens", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));
    vi.stubGlobal("EventSource", MockEventSource);

    const { result, unmount } = renderHook(() => useWorkflowStream("conv-1"));

    await waitFor(() => {
      expect(result.current.connectionStatus).toBe("live");
    });
    unmount();
  });

  test("fetches snapshot on mount and reduces state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              lineNumber: 1,
              timestamp: "2026-06-04T01:38:44.985Z",
              eventType: "tool_start",
              fields: {
                conversation_id: "main",
                tool_name: "Task",
                tool_use_id: "task-a",
                input_subagent_type: "orchestrator",
                input_description: "Feature: test"
              }
            },
            {
              lineNumber: 2,
              timestamp: "2026-06-04T01:38:47.875Z",
              eventType: "subagent_start",
              fields: {
                conversation_id: "main",
                subagent_id: "task-a",
                subagent_type: "orchestrator",
                agent_label: "Orchestrator",
                subagent_model: "test-model"
              }
            }
          ])
      })
    );
    vi.stubGlobal("EventSource", MockEventSource);

    const { result, unmount } = renderHook(() => useWorkflowStream("conv-1"));

    await waitFor(() => {
      const agents = Object.values(result.current.state.agents);
      expect(agents.length).toBe(1);
    });

    expect(result.current.state.agents["task-a"].label).toBe("Orchestrator");
    expect(result.current.state.agents["task-a"].type).toBe("orchestrator");
    expect(result.current.state.agents["task-a"].model).toBe("test-model");
    expect(result.current.state.agents["task-a"].status).toBe("running");
    unmount();
  });

  test("applies incoming activity events through reducer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));

    let es: MockEventSource | null = null;
    vi.stubGlobal(
      "EventSource",
      class extends MockEventSource {
        constructor(url: string) {
          super(url);
          es = this;
        }
      }
    );

    const { result, unmount } = renderHook(() => useWorkflowStream("conv-1"));

    await waitFor(() => {
      expect(es).not.toBeNull();
    });

    act(() => {
      es!.emit(
        "activity",
        JSON.stringify({
          lineNumber: 1,
          timestamp: "2026-06-04T01:38:44.985Z",
          eventType: "tool_start",
          fields: {
            conversation_id: "main",
            tool_name: "Task",
            tool_use_id: "task-e1",
            input_subagent_type: "implementor",
            input_description: "Build feature"
          }
        })
      );
    });

    await waitFor(() => {
      const agents = Object.values(result.current.state.agents);
      expect(agents.length).toBe(1);
    });

    expect(result.current.state.agents["task-e1"]).toBeDefined();
    expect(result.current.state.agents["task-e1"].type).toBe("implementor");
    unmount();
  });

  test("sets selected agent and exposes it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));
    vi.stubGlobal("EventSource", MockEventSource);

    const { result, unmount } = renderHook(() => useWorkflowStream("conv-1"));

    await waitFor(() => {
      expect(result.current.connectionStatus).toBe("live");
    });

    act(() => {
      result.current.setSelectedAgentId("agent-x");
    });

    expect(result.current.selectedAgentId).toBe("agent-x");
    unmount();
  });

  test("closes EventSource on unmount", async () => {
    let closed = false;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));
    vi.stubGlobal(
      "EventSource",
      class extends MockEventSource {
        close() {
          closed = true;
        }
      }
    );

    const { unmount } = renderHook(() => useWorkflowStream("conv-1"));

    await waitFor(() => {
      expect(true).toBe(true);
    });

    unmount();
    expect(closed).toBe(true);
  });
});
