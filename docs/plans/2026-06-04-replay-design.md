# Replay Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a video-player-like replay timeline to the Agent Office Dashboard, allowing users to rewind through agent activity history and watch it play back in real-time, with a "Live" button to jump back to current activity.

**Architecture:** A new `useReplay` hook consumes the event buffer from `useWorkflowStream`, manages a playhead, and produces a separate `WorkflowState` via the existing reducer. A sticky `ReplayControls` bar at the bottom provides seek, play, and go-live controls. The live state continues updating in the background while replay is active.

**Tech Stack:** React, TypeScript, existing `applyWorkflowEvent` reducer, CSS.

---

### Task 1: Modify `useWorkflowStream` to expose eventBuffer

**Files:**
- Modify: `src/hooks/useWorkflowStream.ts`

**Step 1: Read the file**

Read `src/hooks/useWorkflowStream.ts` to confirm current state.

**Step 2: Add eventBuffer state**

Add `const [eventBuffer, setEventBuffer] = useState<LogEvent[]>([]);` next to the other state declarations.

Update the snapshot fetch to populate the buffer:
```typescript
const res = await globalThis.fetch("/api/snapshot");
const events: LogEvent[] = await res.json();
if (!mountedRef.current) return;
setEventBuffer(events);
setState((prev) => events.reduce(applyWorkflowEvent, prev));
```

Update the SSE handler to append:
```typescript
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
```

**Step 3: Return eventBuffer**

Update the return object:
```typescript
return {
  state,
  eventBuffer,
  connectionStatus,
  selectedAgentId,
  setSelectedAgentId: setSelected
} as const;
```

**Step 4: Verify types**

Run: `npm run typecheck`
Expected: No type errors

---

### Task 2: Create `useReplay` hook

**Files:**
- Create: `src/hooks/useReplay.ts`
- Create: `src/hooks/useReplay.test.ts`

**Step 1: Write the test**

Write `src/hooks/useReplay.test.ts` with these test cases:
- `useReplay` returns `replayState`, `currentTime`, `totalDuration`, `isPlaying`, `seek`, `goLive`
- Given 3 events at timestamps T, T+1s, T+2s, seek to index 1 replays first 2 events into state
- `isPlaying` is true after seek, false on goLive
- `currentTime` updates to the event timestamp at playhead
- `totalDuration` reflects buffer start/end timestamps

Use a renderHook pattern or test the pure logic by extracting the scheduler.

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/hooks/useReplay.test.ts`
Expected: FAIL

**Step 3: Write implementation**

Write `src/hooks/useReplay.ts`:

```typescript
import { useCallback, useEffect, useRef, useState } from "react";
import type { LogEvent } from "../shared/logTypes";
import { createInitialWorkflowState, applyWorkflowEvent } from "../shared/workflowReducer";
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

  const currentTime = playhead !== null && eventBuffer[playhead]
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
    const state = eventBuffer
      .slice(0, eventIndex + 1)
      .reduce(applyWorkflowEvent, createInitialWorkflowState());

    setReplayState(state);
    setPlayhead(eventIndex);
  }, [eventBuffer, clearTimer]);

  const goLive = useCallback(() => {
    clearTimer();
    setPlayhead(null);
    setReplayState(createInitialWorkflowState());
  }, [clearTimer]);

  // Auto-schedule next event when playhead changes
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
```

**Step 4: Run tests to verify they pass**

Run: `npm run test -- src/hooks/useReplay.test.ts`
Expected: PASS

---

### Task 3: Create `ReplayControls` component

**Files:**
- Create: `src/components/ReplayControls.tsx`

**Step 1: Write the component**

```tsx
import type { LogEvent } from "../shared/logTypes";

type Props = {
  eventBuffer: LogEvent[];
  currentTime: string | null;
  totalDuration: { start: string; end: string } | null;
  isPlaying: boolean;
  isReplayMode: boolean;
  onSeek: (eventIndex: number) => void;
  onGoLive: () => void;
};

function formatTime(ts: string | null): string {
  if (!ts) return "--:--:--";
  return ts.slice(11, 19);
}

export function ReplayControls({
  eventBuffer,
  currentTime,
  totalDuration,
  isPlaying,
  isReplayMode,
  onSeek,
  onGoLive
}: Props) {
  if (eventBuffer.length === 0) return null;

  const progress = currentTime && totalDuration
    ? (Date.parse(currentTime) - Date.parse(totalDuration.start)) /
      (Date.parse(totalDuration.end) - Date.parse(totalDuration.start))
    : 0;

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const index = Math.round(ratio * (eventBuffer.length - 1));
    onSeek(index);
  };

  return (
    <div className="replay-controls">
      <div className="replay-controls__inner">
        <button
          className={`replay-controls__live-btn ${!isReplayMode ? "replay-controls__live-btn--active" : ""}`}
          onClick={onGoLive}
        >
          <span className="replay-controls__live-dot" />
          Live
        </button>

        <div className="replay-controls__timeline" onClick={handleClick}>
          <div className="replay-controls__track">
            <div
              className="replay-controls__fill"
              style={{ width: `${Math.min(100, progress * 100)}%` }}
            />
            <div
              className="replay-controls__thumb"
              style={{ left: `${Math.min(100, progress * 100)}%` }}
            />
          </div>
        </div>

        <span className="replay-controls__time">
          {formatTime(currentTime)} / {formatTime(totalDuration?.end ?? null)}
        </span>
      </div>
    </div>
  );
}
```

Replay controls.css değişen App.tsx çağıracak

**Step 2: Verify types**

Run: `npm run typecheck`
Expected: No type errors

---

### Task 4: Add replay styles

**Files:**
- Modify: `src/styles.css`

Add at the end of the file:

```css
/* ---- Replay Controls ---- */

.replay-controls {
  position: sticky;
  bottom: 0;
  background: #fff;
  border-top: 1px solid #d8deea;
  padding: 0.5rem 1rem;
  z-index: 20;
}

.replay-controls__inner {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  max-width: 100%;
}

.replay-controls__live-btn {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.78rem;
  font-weight: 600;
  padding: 0.3rem 0.75rem;
  border-radius: 12px;
  border: 1px solid #d8deea;
  background: #fff;
  cursor: pointer;
  color: #6b7280;
  white-space: nowrap;
  transition: all 0.15s;
}

.replay-controls__live-btn:hover {
  border-color: #93c5fd;
}

.replay-controls__live-btn--active {
  color: #16a34a;
  border-color: #86efac;
  background: #f0fdf4;
}

.replay-controls__live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #9ca3af;
  display: inline-block;
}

.replay-controls__live-btn--active .replay-controls__live-dot {
  background: #22c55e;
  box-shadow: 0 0 6px #22c55e;
}

.replay-controls__timeline {
  flex: 1;
  cursor: pointer;
  padding: 0.25rem 0;
}

.replay-controls__track {
  position: relative;
  height: 6px;
  background: #e5e7eb;
  border-radius: 3px;
}

.replay-controls__fill {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  background: #3b82f6;
  border-radius: 3px;
  transition: width 0.1s linear;
}

.replay-controls__thumb {
  position: absolute;
  top: 50%;
  width: 14px;
  height: 14px;
  background: #3b82f6;
  border: 2px solid #fff;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
  pointer-events: none;
  transition: left 0.1s linear;
}

.replay-controls__time {
  font-size: 0.72rem;
  font-family: monospace;
  color: #6b7280;
  white-space: nowrap;
  min-width: 9em;
  text-align: right;
}
```

---

### Task 5: Wire replay into App.tsx

**Files:**
- Modify: `src/App.tsx`

**Step 1: Modify App.tsx**

```tsx
import { useWorkflowStream } from "./hooks/useWorkflowStream";
import { useReplay } from "./hooks/useReplay";
import { EventFeed } from "./components/EventFeed";
import { InspectorPanel } from "./components/InspectorPanel";
import { OfficeBoard } from "./components/OfficeBoard";
import { ReplayControls } from "./components/ReplayControls";
import { selectAgents } from "./shared/workflowReducer";
import type { AgentNode } from "./shared/workflowTypes";

const connectionLabels: Record<string, string> = {
  connecting: "Connecting...",
  live: "Live",
  reconnecting: "Reconnecting...",
  offline: "Offline"
};

export default function App() {
  const { state, eventBuffer, connectionStatus, selectedAgentId, setSelectedAgentId } =
    useWorkflowStream();

  const { replayState, currentTime, totalDuration, isPlaying, isReplayMode, seek, goLive } =
    useReplay(eventBuffer);

  const displayState = isReplayMode ? replayState : state;
  const agents: AgentNode[] = selectAgents(displayState);

  const selectedAgent = selectedAgentId
    ? agents.find((a) => a.id === selectedAgentId)
    : undefined;

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <span className="eyebrow">Agent Office</span>
          <h1>Dashboard</h1>
        </div>
        <div className={`connection-badge connection-badge--${connectionStatus}`}>
          <span className="connection-dot" />
          {connectionLabels[connectionStatus] ?? connectionStatus}
        </div>
      </header>

      <div className="app-body">
        <main className="app-main">
          <OfficeBoard
            agents={agents}
            selectedAgentId={selectedAgentId}
            onSelectAgent={setSelectedAgentId}
          />
        </main>

        <aside className="app-aside">
          <InspectorPanel agent={selectedAgent} />
          <EventFeed
            events={displayState.events}
            conversationToAgentId={displayState.conversationToAgentId}
            agents={displayState.agents}
          />
        </aside>
      </div>

      <ReplayControls
        eventBuffer={eventBuffer}
        currentTime={currentTime}
        totalDuration={totalDuration}
        isPlaying={isPlaying}
        isReplayMode={isReplayMode}
        onSeek={seek}
        onGoLive={goLive}
      />
    </div>
  );
}
```

**Step 2: Verify types and build**

Run: `npm run typecheck`
Expected: No type errors

Run: `npm run test`
Expected: All existing tests still pass
