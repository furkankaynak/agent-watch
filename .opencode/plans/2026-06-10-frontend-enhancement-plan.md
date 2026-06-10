# Frontend Enhancement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show skills/rules on agent nodes, add counter badges to canvas, enrich InspectorPanel with tool/file/shell/MCP details, and format new event types in EventFeed.

**Architecture:** Server-side: extract rule/skill names from `beforeReadFile` attachments, generate `agent_chips` entries. Client-side: extend `AgentNode` type with per-agent counters tracked in `workflowReducer`, pass counters to `AgentNode` component for badge rendering, pass `events[]` to `InspectorPanel` for filtered lists, add `shortMessage()` cases for 12 new event types.

**Tech Stack:** Node.js (CJS ingest hook), TypeScript (server + client), React with ReactFlow, CSS BEM, vitest for tests.

---

### Task 1: Add attachment enrichment to ingest.cjs

**Files:**
- Modify: `cursor-plugin/hooks/ingest.cjs` — `handleBeforeReadFile` function

**Step 1: Update handleBeforeReadFile handler**

Replace the handler to extract rule names from attachments and detect skill files:

```javascript
function handleBeforeReadFile(payload) {
  const appName = extractAppName(payload);
  const ts = new Date().toISOString();
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];

  const rules = attachments
    .filter(a => a.type === 'rule')
    .map(a => path.basename((a.file_path || '').replace(/\.mdc$/, '')));
  const skillFromAttachments = attachments
    .filter(a => a.type === 'file' && (a.file_path || '').includes('/skills/'))
    .map(a => path.basename(path.dirname(a.file_path || '')));
  const isSkillFile = (payload.file_path || '').includes('/skills/') || (payload.file_path || '').endsWith('SKILL.md');
  const skillFromPath = isSkillFile ? [path.basename(path.dirname(payload.file_path || ''))] : [];

  const skills = [...new Set([...skillFromAttachments, ...skillFromPath])];

  const fields = {
    ...commonFields(payload),
    timestamp: ts,
    workspace_root: appName,
    file_path: payload.file_path || null,
    attachment_count: attachments.length,
    attachment_rules: rules.length > 0 ? JSON.stringify(rules) : null,
    attachment_skills: skills.length > 0 ? JSON.stringify(skills) : null,
  };
  sendEvent(appName, {
    lineNumber: 0, timestamp: ts, eventType: 'file_read',
    fields, raw: JSON.stringify(payload),
    conversation_id: payload.conversation_id || null,
  });
  return ALLOW;
}
```

**Step 2: Quick smoke test**

```bash
echo '{"hook_event_name":"beforeReadFile","file_path":"/p/.cursor/skills/my-skill/SKILL.md","workspace_roots":["/p/app"],"attachments":[{"type":"rule","file_path":"/p/.cursor/rules/react.mdc"}]}' | node cursor-plugin/hooks/ingest.cjs
```

Expected output: `{"permission":"allow"}`

---

### Task 2: Add file_read processing to eventProcessor.ts

**Files:**
- Modify: `server/eventProcessor.ts` — add case + handler

**Step 1: Add `safeParseArray` helper** (after `basename` helper at bottom of file)

```typescript
function safeParseArray(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p : [];
  } catch { return []; }
}
```

**Step 2: Add case to `processEvent` switch**

```typescript
case "file_read":
  handleFileRead(db, event);
  break;
```

Insert after existing `case "file_edit":` if exists, or in alphabetical position in the switch.

**Step 3: Add `handleFileRead` function** (before `handleDefault`)

```typescript
function handleFileRead(db: Database.Database, event: LogEvent): void {
  const bound = bindConversation(event, db);
  if (!bound.agentId) return;

  const rules = safeParseArray(event.fields.attachment_rules);
  for (const rule of rules) {
    db.prepare(
      "INSERT OR IGNORE INTO agent_chips (agent_id, chip_type, chip_value, seen_at) VALUES (?, ?, ?, ?)"
    ).run(bound.agentId, "rule", rule, event.timestamp);
  }

  const skills = safeParseArray(event.fields.attachment_skills);
  for (const skill of skills) {
    db.prepare(
      "INSERT OR IGNORE INTO agent_chips (agent_id, chip_type, chip_value, seen_at) VALUES (?, ?, ?, ?)"
    ).run(bound.agentId, "skill", skill, event.timestamp);
  }

  touchAgent(db, bound.agentId, event.timestamp);
}
```

**Step 4: Add test**

In `server/eventProcessor.test.ts`, add a test case:

```typescript
it("creates agent chips from file_read with rules", async () => {
  const { processEvent } = await import("./eventProcessor");

  // set up agent first
  processEvent(db, makeEvent({
    eventType: "tool_start",
    fields: {
      tool_name: "Task",
      input_subagent_type: "generalPurpose",
      input_description: "test agent",
      conversation_id: "test-conv",
      tool_use_id: "agent-1",
    },
  }));

  // fire file_read with attachment_rules
  processEvent(db, makeEvent({
    eventType: "file_read",
    fields: {
      conversation_id: "test-conv",
      generation_id: "gen-1",
      file_path: "/p/src/App.tsx",
      attachment_rules: '["react","testing"]',
      attachment_skills: '["code-reviewer"]',
    },
  }));

  const chips = db.prepare("SELECT * FROM agent_chips WHERE agent_id = ?").all("agent-1") as any[];
  const ruleValues = chips.filter(c => c.chip_type === "rule").map(c => c.chip_value);
  const skillValues = chips.filter(c => c.chip_type === "skill").map(c => c.chip_value);

  expect(ruleValues).toContain("react");
  expect(ruleValues).toContain("testing");
  expect(skillValues).toContain("code-reviewer");
});
```

**Step 5: Run tests**

```bash
npx vitest run server/eventProcessor.test.ts
```

Expected: new test passes, 113 tests total, no regressions.

**Step 6: Commit**

```bash
git add cursor-plugin/hooks/ingest.cjs server/eventProcessor.ts server/eventProcessor.test.ts
git commit -m "feat: generate skill/rule chips from beforeReadFile attachments"
```

---

### Task 3: Extend AgentNode type and workflowReducer counters

**Files:**
- Modify: `src/shared/workflowTypes.ts`
- Modify: `src/shared/workflowReducer.ts`
- Test: `src/shared/workflowReducer.test.ts` (existing test file)

**Step 1: Add counter fields to AgentNode type**

```typescript
export type AgentNode = {
  // ... keep existing fields ...
  toolCallCount: number;
  toolErrorCount: number;
  fileReadCount: number;
  fileEditCount: number;
  shellCommandCount: number;
  mcpCallCount: number;
  subagentCount: number;
  durationMs: number | null;
  lastFile: string | null;
};
```

**Step 2: Initialize counters in agent creation places**

In the reducer, find where agents are created (via `createAgent` helper or inline) and add:

```typescript
toolCallCount: 0,
toolErrorCount: 0,
fileReadCount: 0,
fileEditCount: 0,
shellCommandCount: 0,
mcpCallCount: 0,
subagentCount: 0,
durationMs: null,
lastFile: null,
```

**Step 3: Add counter increments in relevant case blocks**

In each case block, find the agent using `state.agents[agentId]` and update counters via `updateAgent()`:

```typescript
// In tool_start case:
if (agent) {
  state = updateAgent(state, agent.id, { toolCallCount: agent.toolCallCount + 1 });
}

// In tool_done case (only if ok=false):
if (agent && isError) {
  state = updateAgent(state, agent.id, { toolErrorCount: agent.toolErrorCount + 1 });
}

// In file_read case:
if (agent) {
  state = updateAgent(state, agent.id, {
    fileReadCount: agent.fileReadCount + 1,
    lastFile: event.fields.file_path || agent.lastFile,
  });
}
```

Similar patterns for: `file_edit`, `shell_start`, `mcp_start`, `subagent_start`, `subagent_stop` (durationMs), `agent_stop` (durationMs).

**Step 4: Add test case**

```typescript
it("tracks per-agent counters from events", () => {
  const state = createInitialWorkflowState();
  let s = state;

  // start agent
  s = applyWorkflowEvent(s, makeTestEvent("tool_start", {
    tool_name: "Task",
    input_subagent_type: "generalPurpose",
    input_description: "test",
    conversation_id: "c1",
    generation_id: "g1",
    tool_use_id: "a1",
  }));

  // file_read
  s = applyWorkflowEvent(s, makeTestEvent("file_read", {
    conversation_id: "c1",
    generation_id: "g1",
    file_path: "/p/src/App.tsx",
  }));

  // file_edit  
  s = applyWorkflowEvent(s, makeTestEvent("file_edit", {
    conversation_id: "c1",
    generation_id: "g1",
    file_path: "/p/src/App.tsx",
  }));

  // shell_start
  s = applyWorkflowEvent(s, makeTestEvent("shell_start", {
    conversation_id: "c1",
    generation_id: "g1",
    command_summary: "npm test",
  }));

  const agent = s.agents["a1"];
  expect(agent?.toolCallCount).toBe(1);
  expect(agent?.fileReadCount).toBe(1);
  expect(agent?.fileEditCount).toBe(1);
  expect(agent?.shellCommandCount).toBe(1);
  expect(agent?.lastFile).toBe("/p/src/App.tsx");
});
```

**Step 5: Run tests**

```bash
npx vitest run src/shared/workflowReducer.test.ts
```

Expected: new test passes, existing tests pass.

**Step 6: Commit**

```bash
git add src/shared/workflowTypes.ts src/shared/workflowReducer.ts src/shared/workflowReducer.test.ts
git commit -m "feat: add per-agent counters (tools, files, shell, MCP) to WorkflowState"
```

---

### Task 4: AgentNode badge rendering

**Files:**
- Modify: `src/components/AgentNode.tsx`
- Modify: `src/styles.css`

**Step 1: Extend AgentNodeData interface**

```typescript
type AgentNodeData = {
  label: string;
  type: string;
  status: AgentStatus;
  errors: string[];
  toolCallCount: number;
  toolErrorCount: number;
  fileEditCount: number;
  fileReadCount: number;
  durationMs: number | null;
};
```

**Step 2: Add formatDuration helper + stats row JSX**

```typescript
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
```

Stats row (after type line, before bottom handle):

```tsx
const fileCount = data.fileEditCount + data.fileReadCount;
const hasStats = data.toolCallCount > 0 || fileCount > 0 || data.toolErrorCount > 0 || data.durationMs != null;

{hasStats && (
  <div className="agent-node__stats">
    {data.toolCallCount > 0 && (
      <span className="agent-node__badge agent-node__badge--tools">🔧 {data.toolCallCount}</span>
    )}
    {fileCount > 0 && (
      <span className="agent-node__badge agent-node__badge--files">📄 {fileCount}</span>
    )}
    {data.toolErrorCount > 0 && (
      <span className="agent-node__badge agent-node__badge--errors">⚠ {data.toolErrorCount}</span>
    )}
    {data.durationMs != null && (
      <span className="agent-node__badge agent-node__badge--time">{formatDuration(data.durationMs)}</span>
    )}
  </div>
)}
```

**Step 3: Update AgentCanvas layoutNodes to pass counter fields**

In `layoutNodes()`, add to node data:

```typescript
data: {
  ...existing,
  toolCallCount: agent.toolCallCount,
  toolErrorCount: agent.toolErrorCount,
  fileEditCount: agent.fileEditCount,
  fileReadCount: agent.fileReadCount,
  durationMs: agent.durationMs,
}
```

**Step 4: Add CSS**

```css
.agent-node__stats { display: flex; gap: 4px; margin-top: 4px; flex-wrap: wrap; }
.agent-node__badge { font-size: 10px; padding: 1px 5px; border-radius: 3px; font-family: monospace; }
.agent-node__badge--tools  { background: rgba(59, 130, 246, 0.12); color: #60a5fa; }
.agent-node__badge--files  { background: rgba(34, 197, 94, 0.10); color: #4ade80; }
.agent-node__badge--errors { background: rgba(239, 68, 68, 0.12); color: #f87171; }
.agent-node__badge--time   { background: rgba(148, 163, 184, 0.10); color: #94a3b8; }
```

**Step 5: Verify visually** — start dev server, send test events, check canvas nodes show badges.

**Step 6: Commit**

```bash
git add src/components/AgentNode.tsx src/components/AgentCanvas.tsx src/styles.css
git commit -m "feat: add colored stat badges to agent canvas nodes"
```

---

### Task 5: InspectorPanel enrichment

**Files:**
- Modify: `src/components/InspectorPanel.tsx`
- Modify: `src/App.tsx`

**Step 1: Add `events` and `agents` props to InspectorPanel**

```typescript
type Props = {
  agent: AgentNode | undefined;
  events: LogEvent[];
  agents: Record<string, AgentNode>;
};
```

**Step 2: Add filter helpers**

```typescript
function getAgentToolCalls(agentId: string, events: LogEvent[]) {
  const toolIds = new Set<string>();
  const calls: { toolName: string; ok: boolean; durationMs: number | null }[] = [];
  for (const ev of events) {
    if (ev.eventType === 'tool_start' && ev.fields.tool_use_id) {
      toolIds.add(ev.fields.tool_use_id);
      calls.push({
        toolName: ev.fields.tool_name || 'unknown',
        ok: true,
        durationMs: null,
      });
    } else if (ev.eventType === 'tool_done' && ev.fields.tool_use_id && toolIds.has(ev.fields.tool_use_id)) {
      const existing = calls.find(c => c.durationMs === null);
      if (existing) {
        existing.ok = ev.fields.ok !== 'false';
        existing.durationMs = Number(ev.fields.duration_ms) || null;
      }
    }
  }
  return calls;
}
```

Similar helpers for file ops, shell commands, MCP calls, subagents.

**Step 3: Render sections**

After existing chips/hooks sections, add:

```tsx
{agent && events.length > 0 && (
  <>
    <ToolCallsSection agent={agent} events={events} />
    <FileOpsSection agent={agent} events={events} />
    <ShellSection agent={agent} events={events} />
    <MCPSection agent={agent} events={events} />
    <SubagentSection agent={agent} agents={agents} />
  </>
)}
```

Each section is a conditionally rendered block:

```tsx
function ToolCallsSection({ agent, events }: { agent: AgentNode; events: LogEvent[] }) {
  const calls = getAgentToolCalls(agent.id, events);
  if (calls.length === 0) return null;
  return (
    <div className="inspector__section">
      <h4 className="inspector__section-title">Tool Calls ({calls.length})</h4>
      <ul className="inspector__list">
        {calls.slice(-10).reverse().map((c, i) => (
          <li key={i} className={c.ok ? '' : 'inspector__item--error'}>
            <span>{c.toolName}</span>
            <span>{c.ok ? '✓' : '✗'}</span>
            {c.durationMs != null && <span>{c.durationMs}ms</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

**Step 4: Update App.tsx to pass events + agents to InspectorPanel**

```tsx
<InspectorPanel
  agent={selectedAgent}
  events={displayState.events}
  agents={displayState.agents}
/>
```

**Step 5: Add CSS**

```css
.inspector__section { margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.05); }
.inspector__section-title { font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 4px; }
.inspector__list { list-style: none; padding: 0; margin: 0; font-size: 11px; }
.inspector__list li { display: flex; gap: 8px; padding: 2px 0; align-items: center; }
.inspector__list li span:first-child { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.inspector__item--error { color: #ef4444; }
```

**Step 6: Commit**

```bash
git add src/components/InspectorPanel.tsx src/App.tsx src/styles.css
git commit -m "feat: enrich InspectorPanel with tool calls, file ops, shell, MCP sections"
```

---

### Task 6: EventFeed new event type formatting

**Files:**
- Modify: `src/components/EventFeed.tsx` — `shortMessage` function
- Modify: `src/styles.css` — badge colors

**Step 1: Add shortMessage cases**

```typescript
case 'session_start': {
  const model = event.fields.model;
  return model ? `${agentLabel}: session started (${model})` : 'Session started';
}
case 'subagent_stop': {
  const status = event.fields.status || 'done';
  const dur = event.fields.duration_ms;
  const fc = event.fields.files_changed;
  const parts = [status];
  if (dur) parts.push(`${dur}ms`);
  if (fc) parts.push(`${fc} files`);
  return `${agentLabel}: ${parts.join(' · ')}`;
}
case 'mcp_start': {
  const tn = event.fields.tool_name || 'MCP';
  return `${agentLabel}: MCP ${tn}`;
}
case 'mcp_done': {
  const tn = event.fields.tool_name || 'MCP';
  const dur = event.fields.duration_ms;
  return `${agentLabel}: MCP ${tn} done${dur ? ` (${dur}ms)` : ''}`;
}
case 'prompt_submit':
  return `${agentLabel}: prompt submitted`;
case 'context_compact':
  return `${agentLabel}: context compacted`;
case 'agent_stop': {
  const status = event.fields.status || 'stopped';
  const loops = event.fields.loop_count;
  return `${agentLabel}: ${status}${loops ? ` · ${loops} loops` : ''}`;
}
case 'agent_response':
  return `${agentLabel}: agent responded`;
case 'agent_thought':
  return `${agentLabel}: agent thought`;
case 'tab_file_read': {
  const fp = event.fields.file_path;
  const bn = fp ? fp.split('/').pop() || fp : 'file';
  return `${agentLabel}: tab read ${bn}`;
}
case 'tab_file_edit': {
  const fp = event.fields.file_path;
  const bn = fp ? fp.split('/').pop() || fp : 'file';
  const ec = event.fields.edit_count || '0';
  return `${agentLabel}: tab edited ${bn} (${ec} edits)`;
}
case 'workspace_open': {
  const ws = event.fields.workspace_root || 'unknown';
  return `Workspace opened: ${ws}`;
}
```

**Step 2: Add CSS badge colors for new types**

```css
.event-feed__type--session_start   { background: rgba(168,85,247,0.12); color: #a78bfa; }
.event-feed__type--subagent_stop   { background: rgba(59,130,246,0.12); color: #60a5fa; }
.event-feed__type--mcp_start       { background: rgba(236,72,153,0.12); color: #f472b6; }
.event-feed__type--mcp_done        { background: rgba(236,72,153,0.12); color: #f472b6; }
.event-feed__type--prompt_submit   { background: rgba(168,85,247,0.12); color: #a78bfa; }
.event-feed__type--context_compact { background: rgba(148,163,184,0.10); color: #94a3b8; }
.event-feed__type--agent_stop      { background: rgba(239,68,68,0.12);   color: #f87171; }
.event-feed__type--agent_response  { background: rgba(34,197,94,0.10);  color: #4ade80; }
.event-feed__type--agent_thought   { background: rgba(250,204,21,0.10); color: #facc15; }
.event-feed__type--tab_file_read   { background: rgba(250,204,21,0.10); color: #facc15; }
.event-feed__type--tab_file_edit   { background: rgba(249,115,22,0.12); color: #fb923c; }
.event-feed__type--workspace_open  { background: rgba(148,163,184,0.10); color: #94a3b8; }
```

**Step 3: Commit**

```bash
git add src/components/EventFeed.tsx src/styles.css
git commit -m "feat: add shortMessage formatting and badges for 12 new event types"
```

---

### Task 7: Final verification

**Step 1: Run full test suite**

```bash
npm run typecheck && npm run test
```

Expected: typecheck clean, all tests pass.

**Step 2: Run dev server and do manual smoke test**

```bash
npm run dev:server &
sleep 2
echo '{"hook_event_name":"beforeReadFile","file_path":"/p/.cursor/skills/code-reviewer/SKILL.md","conversation_id":"c1","workspace_roots":["/p/app"],"attachments":[{"type":"rule","file_path":"/p/.cursor/rules/react.mdc"},{"type":"rule","file_path":"/p/.cursor/rules/testing.mdc"}]}' | node cursor-plugin/hooks/ingest.cjs
sleep 1
echo '{"hook_event_name":"preToolUse","tool_name":"Task","tool_use_id":"a1","conversation_id":"c1","workspace_roots":["/p/app"],"tool_input":{"subagent_type":"generalPurpose","description":"test agent"}}' | node cursor-plugin/hooks/ingest.cjs
sleep 0.5
echo '{"hook_event_name":"preToolUse","tool_name":"Shell","tool_use_id":"t1","conversation_id":"c1","workspace_roots":["/p/app"],"tool_input":{"command":"npm test"}}' | node cursor-plugin/hooks/ingest.cjs
sleep 0.5
curl -s 'http://localhost:4317/api/snapshot?conversation_id=c1' | node -e "
const j=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
console.log('Events:', j.length, 'Types:', j.map(e=>e.eventType).join(', '));
"
kill %1 2>/dev/null
```

Expected: events received with correct types. Canvas shows agent node with badges. Inspector shows chips.

**Step 3: Commit AGENTS.md update if needed**
