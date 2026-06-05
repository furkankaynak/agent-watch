import { useCallback, useEffect, useRef, useState } from "react";
import type { LogEvent } from "../shared/logTypes";
import { applyWorkflowEvent, createInitialWorkflowState } from "../shared/workflowReducer";
import type { WorkflowState } from "../shared/workflowTypes";

const MIN_TIMEOUT_MS = 100;

export type ReplayControls = {
  replayState: WorkflowState;
  currentTime: string | null;
  totalDuration: { start: string; end: string } | null;
  isPlaying: boolean;
  isReplayMode: boolean;
  seek: (eventIndex: number) => void;
  goLive: () => void;
};

export function useReplay(eventBuffer: LogEvent[]): ReplayControls {
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [replayState, setReplayState] = useState<WorkflowState>(createInitialWorkflowState());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isReplayMode = playhead !== null;

  const totalDuration = eventBuffer.length > 0
    ? { start: eventBuffer[0].timestamp, end: eventBuffer[eventBuffer.length - 1].timestamp }
    : null;

  const currentTime = playhead !== null && playhead < eventBuffer.length
    ? eventBuffer[playhead].timestamp
    : null;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleNext = useCallback((idx: number, events: LogEvent[]) => {
    if (idx >= events.length - 1) return;

    const current = events[idx].timestamp;
    const next = events[idx + 1].timestamp;
    const diff = Date.parse(next) - Date.parse(current);
    const delay = Math.max(diff, MIN_TIMEOUT_MS);

    timerRef.current = setTimeout(() => {
      const nextIdx = idx + 1;
      setPlayhead(nextIdx);
      setReplayState((prev) => applyWorkflowEvent(prev, events[nextIdx]));
    }, delay);
  }, []);

  const seek = useCallback((eventIndex: number) => {
    clearTimer();
    const clampedIndex = Math.max(0, Math.min(eventIndex, eventBuffer.length - 1));
    const state = eventBuffer
      .slice(0, clampedIndex + 1)
      .reduce(applyWorkflowEvent, createInitialWorkflowState());

    setReplayState(state);
    setPlayhead(clampedIndex);
  }, [eventBuffer, clearTimer]);

  const goLive = useCallback(() => {
    clearTimer();
    setPlayhead(null);
    setReplayState(createInitialWorkflowState());
  }, [clearTimer]);

  useEffect(() => {
    if (playhead === null || !eventBuffer.length) return;
    scheduleNext(playhead, eventBuffer);
    return () => clearTimer();
  }, [playhead, eventBuffer, scheduleNext, clearTimer]);

  return {
    replayState,
    currentTime,
    totalDuration,
    isPlaying: playhead !== null && playhead < eventBuffer.length - 1,
    isReplayMode,
    seek,
    goLive
  };
}
