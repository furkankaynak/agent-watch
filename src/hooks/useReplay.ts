import { useCallback, useEffect, useRef, useState } from "react";
import type { LogEvent } from "../shared/logTypes";
import { applyWorkflowEvent, createInitialWorkflowState } from "../shared/workflowReducer";
import type { WorkflowState } from "../shared/workflowTypes";

const MIN_TIMEOUT_MS = 100;
const TICK_INTERVAL_MS = 50;

function interpolateTime(t1: string, t2: string, progress: number): string {
  const t1Ms = Date.parse(t1);
  const t2Ms = Date.parse(t2);
  const interpolated = t1Ms + (t2Ms - t1Ms) * Math.min(1, Math.max(0, progress));
  return new Date(interpolated).toISOString();
}

export type ReplayControls = {
  replayState: WorkflowState;
  currentTime: string | null;
  totalDuration: { start: string; end: string } | null;
  isPlaying: boolean;
  isReplayMode: boolean;
  speed: number;
  seek: (eventIndex: number) => void;
  goLive: () => void;
  setSpeed: (speed: number) => void;
};

export function useReplay(eventBuffer: LogEvent[]): ReplayControls {
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [replayState, setReplayState] = useState<WorkflowState>(createInitialWorkflowState());
  const [speed, setSpeed] = useState(1);
  const [virtualTime, setVirtualTime] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickMetaRef = useRef<{
    startWall: number;
    delay: number;
    fromTs: string;
    toTs: string;
  } | null>(null);

  const isReplayMode = playhead !== null;

  const totalDuration = eventBuffer.length > 0
    ? { start: eventBuffer[0].timestamp, end: eventBuffer[eventBuffer.length - 1].timestamp }
    : null;

  const currentTime = isReplayMode && virtualTime !== null
    ? virtualTime
    : (playhead !== null && playhead < eventBuffer.length
        ? eventBuffer[playhead].timestamp
        : null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    tickMetaRef.current = null;
  }, []);

  const startTick = useCallback((idx: number, events: LogEvent[], currentSpeed: number) => {
    if (idx >= events.length - 1) {
      setVirtualTime(events[idx].timestamp);
      return;
    }

    const fromTs = events[idx].timestamp;
    const toTs = events[idx + 1].timestamp;
    const diff = Date.parse(toTs) - Date.parse(fromTs);
    const delay = Math.max(diff / currentSpeed, MIN_TIMEOUT_MS);

    tickMetaRef.current = { startWall: performance.now(), delay, fromTs, toTs };

    timerRef.current = setInterval(() => {
      const meta = tickMetaRef.current;
      if (!meta) return;

      const elapsed = performance.now() - meta.startWall;
      const progress = elapsed / meta.delay;

      if (progress >= 1) {
        clearTimer();
        const nextIdx = idx + 1;
        setPlayhead(nextIdx);
        setReplayState((prev) => applyWorkflowEvent(prev, events[nextIdx]));
      } else {
        setVirtualTime(interpolateTime(meta.fromTs, meta.toTs, progress));
      }
    }, TICK_INTERVAL_MS);
  }, [clearTimer]);

  const seek = useCallback((eventIndex: number) => {
    clearTimer();
    const clampedIndex = Math.max(0, Math.min(eventIndex, eventBuffer.length - 1));
    const state = eventBuffer
      .slice(0, clampedIndex + 1)
      .reduce(applyWorkflowEvent, createInitialWorkflowState());

    setReplayState(state);
    setPlayhead(clampedIndex);
    setVirtualTime(eventBuffer[clampedIndex]?.timestamp ?? null);
  }, [eventBuffer, clearTimer]);

  const goLive = useCallback(() => {
    clearTimer();
    setPlayhead(null);
    setReplayState(createInitialWorkflowState());
    setVirtualTime(null);
    setSpeed(1);
  }, [clearTimer]);

  const changeSpeed = useCallback((newSpeed: number) => {
    setSpeed(newSpeed);
  }, []);

  useEffect(() => {
    if (playhead === null || !eventBuffer.length) {
      setVirtualTime(null);
      return;
    }
    startTick(playhead, eventBuffer, speed);
    return () => clearTimer();
  }, [playhead, eventBuffer, startTick, clearTimer, speed]);

  useEffect(() => {
    if (playhead === null || !eventBuffer.length) return;
    if (tickMetaRef.current) {
      clearTimer();
      startTick(playhead, eventBuffer, speed);
    }
  }, [speed]);

  return {
    replayState,
    currentTime,
    totalDuration,
    isPlaying: playhead !== null && playhead < eventBuffer.length - 1,
    isReplayMode,
    speed,
    seek,
    goLive,
    setSpeed: changeSpeed
  };
}
