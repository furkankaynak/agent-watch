import { useCallback, useEffect, useRef, useState } from "react";
import type { LogEvent } from "../shared/logTypes";
import { applyWorkflowEvent, createInitialWorkflowState } from "../shared/workflowReducer";
import type { WorkflowState } from "../shared/workflowTypes";

export type ConnectionStatus = "connecting" | "live" | "reconnecting" | "offline";

export function useWorkflowStream() {
  const [state, setState] = useState<WorkflowState>(createInitialWorkflowState());
  const [eventBuffer, setEventBuffer] = useState<LogEvent[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const setSelected = useCallback((id: string | null) => {
    setSelectedAgentId(id);
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    const doFetch = async () => {
      try {
        const res = await globalThis.fetch("/api/snapshot");
        const events: LogEvent[] = await res.json();
        if (!mountedRef.current) return;
        setEventBuffer(events);
        setState((prev) => events.reduce(applyWorkflowEvent, prev));
      } catch {
        if (!mountedRef.current) return;
        setConnectionStatus("offline");
      }
    };
    doFetch();

    const es = new globalThis.EventSource("/api/events");

    es.addEventListener("open", () => {
      if (!mountedRef.current) return;
      setConnectionStatus((prev) => (prev === "offline" ? "offline" : "live"));
    });

    es.addEventListener("error", () => {
      if (!mountedRef.current) return;
      setConnectionStatus("reconnecting");
    });

    es.addEventListener("activity", (e: Event) => {
      if (!mountedRef.current) return;
      const msg = e as MessageEvent;
      try {
        const event: LogEvent = JSON.parse(msg.data);
        setEventBuffer((prev) => [...prev, event]);
        setState((prev) => applyWorkflowEvent(prev, event));
      } catch {
        // skip malformed SSE data
      }
    });

    return () => {
      mountedRef.current = false;
      es.close();
    };
  }, []);

  return {
    state,
    eventBuffer,
    connectionStatus,
    selectedAgentId,
    setSelectedAgentId: setSelected
  } as const;
}
