# Agent Office Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a React + Vite browser dashboard that watches `activity.log`, spawns agent cards when agents are called, and clearly shows loaded skills and rules.

**Architecture:** A local Node server tails `activity.log` and streams parsed events to the browser over SSE. Shared TypeScript parsing and reducer code normalizes log lines into workflow state. The UI renders an office workflow board where agent cards appear dynamically, pulse while running, show skill/rule chips, and move to Done when completed.

**Tech Stack:** Vite, React, TypeScript, Node `http`, SSE, Vitest, React Testing Library, CSS animations.

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/styles.css`
- Create: `server/index.ts`

**Steps:**
1. Create a minimal Vite React TypeScript project structure.
2. Add scripts: `dev`, `dev:web`, `dev:server`, `test`, `typecheck`.
3. Configure `ACTIVITY_LOG_PATH` default as `activity.log`.
4. Verify `npm install` and `npm run typecheck`.

---

### Task 2: Log Parser

**Files:**
- Create: `src/shared/logTypes.ts`
- Create: `src/shared/parseLogLine.ts`
- Create: `src/shared/parseLogLine.test.ts`

**Behavior:**
Parse log lines into typed events with `timestamp`, `eventType`, and `fields`. Preserve unknown fields as strings.

**Tests:**
1. Parses basic `tool_start`.
2. Parses quoted values like `agent_label="Senior Pattern Architect"`.
3. Parses Windows paths without breaking on `C:\`.
4. Parses `error_message="File not found: ..."` correctly.
5. Returns `null` for malformed lines.

**Implementation notes:**
Use a tokenizer for `key=value` fields:

```ts
const fieldPattern = /(\w+)=(".*?"|\S+)/g;
```

---

### Task 3: Workflow State Reducer

**Files:**
- Create: `src/shared/workflowTypes.ts`
- Create: `src/shared/workflowReducer.ts`
- Create: `src/shared/workflowReducer.test.ts`

**Reducer rules:**
1. `tool_start tool_name=Task` creates an `incoming` task call.
2. `subagent_start` creates or updates an agent card.
3. `skill_read` appends a skill chip to the bound agent.
4. `rule_read` appends a rule chip to the bound agent.
5. `decisions_read` appends a decision chip to the bound agent.
6. `tool_start` marks an active tool and updates the last action.
7. `tool_done` removes active tool state and records errors when `ok=false`.
8. `session_end final_status=completed` marks the bound agent completed.
9. `session_end final_status=aborted` or `unknown` marks the bound agent failed.
10. `stale` is derived by selector if no event arrives for 45 seconds and the agent is not completed or failed.

**Important limitation:**
Current log does not explicitly include `child_conversation_id` on `subagent_start`. MVP uses `subagent_id`, parent task calls, conversation IDs, and time/FIFO binding. Later hook improvements should add `child_conversation_id` for perfect parent-child mapping.

---

### Task 4: SSE Server

**Files:**
- Create: `server/logFile.ts`
- Modify: `server/index.ts`

**Endpoints:**
- `GET /api/snapshot`: returns parsed current log events.
- `GET /api/events`: SSE stream for appended parsed events.
- `GET /api/health`: returns `{ ok: true }`.

**Behavior:**
1. Resolve log path from `ACTIVITY_LOG_PATH || ./activity.log`.
2. `/api/snapshot` reads the full file and parses lines.
3. `/api/events` watches append changes and sends parsed events.
4. Send a heartbeat comment every 15 seconds.
5. If the log file does not exist, keep the server alive and wait.

---

### Task 5: Stream Hook

**Files:**
- Create: `src/hooks/useWorkflowStream.ts`

**Behavior:**
1. Fetch `/api/snapshot` on mount.
2. Reduce snapshot events into state.
3. Open `EventSource('/api/events')`.
4. Apply incoming events through the reducer.
5. Expose `{ state, connectionStatus, selectedAgentId, setSelectedAgentId }`.
6. Close `EventSource` on unmount.

---

### Task 6: Office Board UI

**Files:**
- Create: `src/components/OfficeBoard.tsx`
- Create: `src/components/AgentCard.tsx`
- Create: `src/components/ResourceChips.tsx`
- Create: `src/components/StatusLight.tsx`

**Layout:**
- Incoming: `incoming` agents.
- Active Desk: `running`, `idle`, `stale` agents except quality agents.
- Quality Desk: `code-reviewer`, `test-engineer`, `accessibility-auditor`, `verifier`.
- Done: `completed` and `failed` agents.

**Agent card content:**
- Agent label.
- Status light.
- Parent label.
- Last action.
- Skill chips.
- Rule chips.
- Error count.

---

### Task 7: Inspector And Event Feed

**Files:**
- Create: `src/components/InspectorPanel.tsx`
- Create: `src/components/EventFeed.tsx`
- Modify: `src/App.tsx`

**Inspector shows:**
- Agent label.
- Subagent type.
- Parent.
- Model.
- Skills.
- Rules.
- Decisions.
- Active tools.
- Errors.
- Last related events.

**Event feed shows:**
- Timestamp.
- Event type.
- Agent label when bound.
- Short message.

---

### Task 8: Styling And Animations

**Files:**
- Modify: `src/styles.css`

**Visual direction:**
Simple office dashboard with light game-like motion, not a heavy fantasy/cyberpunk UI.

**Animations:**
- Spawn: opacity and translateY.
- Pulse: running status dot glow.
- Chip blink: new skill/rule flash.
- Shake: failed card one-time shake.
- Done transition: completed card subtle fade.

---

### Task 9: Optional Hook Improvement

**Files outside this repo if approved later:**
- Existing hook/logger that writes `activity.log`.

**Recommended extra fields:**
- `parent_subagent_id`
- `parent_agent_label`
- `child_conversation_id`
- `agent_run_id`

---

### Task 10: Verification

**Commands:**

```bash
npm run test
npm run typecheck
npm run dev
```

**Manual checks:**
1. Open dashboard.
2. Confirm existing `activity.log` snapshot renders agents.
3. Append a fake `tool_start tool_name=Task` line and confirm an incoming card appears.
4. Append matching `subagent_start` and confirm a card spawns.
5. Append `skill_read` and confirm a skill chip appears.
6. Append `rule_read` and confirm a rule chip appears.
7. Append `session_end final_status=completed` and confirm the card moves to Done.

**Success criteria:**
- Agent cards only appear when called or started.
- Running agents pulse.
- Skill and rule names are immediately visible.
- Failures are visible without noisy UI.
- Dashboard stays readable in an office environment.
