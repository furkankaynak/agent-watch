# Canvas Agent View Design

> **For implementation:** Use `writing-plans` skill to create implementation plan from this doc.

**Goal:** Replace the 4-column kanban board (`OfficeBoard`) with a ReactFlow canvas view that renders agents as nodes in a parent-child tree layout with animated edges.

## Architecture

Replace `src/components/OfficeBoard.tsx` with `src/components/AgentCanvas.tsx`. The React component tree changes:

```
App                            App
├─ SessionSidebar              ├─ SessionSidebar
├─ OfficeBoard (kanban)        ├─ AgentCanvas          ← replacement
│  ├─ BoardColumn × 4          │  ├─ ReactFlow
│  │  └─ AgentCard × N         │  │  ├─ AgentNode × N  ← custom ReactFlow node
├─ InspectorPanel              │  │  ├─ AgentEdge × M  ← parent→child arrows
├─ EventFeed                   │  │  ├─ MiniMap
├─ ReplayControls              │  │  └─ Controls
                               ├─ InspectorPanel (unchanged)
                               ├─ EventFeed (unchanged)
                               └─ ReplayControls (unchanged)
```

**New dependencies:** `@xyflow/react` (ReactFlow v12), `dagre` (layout), `@types/dagre`.

## Data Flow

```
WorkflowState { agents, ... }
  │
  ▼
AgentCanvas
  │  useMemo(agents, ...) → dagre layout → ReactFlow nodes[] + edges[]
  │
  ▼
<ReactFlow nodes={nodes} edges={edges} onNodeClick={selectAgent}>
  <AgentNode />     ← custom node type
  <AgentEdge />     ← custom edge type (optional — built-in edge is sufficient)
  <Background />
  <MiniMap />
  <Controls />
</ReactFlow>
```

- Agents → nodes: each `AgentNode` → `{ id, type: "agentNode", data: { label, type, status }, position }`
- Parent-child → edges: each agent with `parentAgentId` → `{ id, source: parentAgentId, target: agent.id, animated, style }`
- Layout recalculates via `useMemo` whenever agents change
- AgentoFlow `fitView({ padding: 0.2 })` after each layout run

## Node Design (AgentNode)

Compact card, ~180px wide, minimal info:

```
┌──────────────────────┐
│ 🔵 AgentLabel        │
│      code-reviewer   │
└──────────────────────┘
```

- `StatusLight` dot (left) — pulsing animation while running
- Agent label (bold)
- Type badge (gray chip, same styling as current `agent-card__type`)
- Border colors per status: running=blue, failed=red, completed=green+dim, idle=gray, stale=orange, incoming=purple+dashed
- Selected node gets the same blue glow as current `agent-card--selected`
- Click → `onSelectAgent(agent.id)` → InspectorPanel updates

## Edge Design

- Solid gray line with arrow end marker
- Child running → animated dashed blue line (`animated: true`)
- Child failed → red dashed line
- Child completed → dimmed opacity

## Layout (dagre)

- `rankdir: "TB"` — top-to-bottom tree
- `ranksep: 120` — vertical gap between generations
- `nodesep: 50` — horizontal gap between siblings
- `edgesep: 30` — gap between parallel edges
- Orphan agents (no `parentAgentId`) become root nodes on the top row
- Layout recalculates on agents change (debounced 200ms)
- `fitView({ padding: 0.2 })` after each layout

## Interaction

- Click node → set `selectedAgentId` → InspectorPanel shows details
- Click canvas empty space → deselect
- Zoom/pan via mouse wheel and drag
- Minimap for large trees
- New agents appear mid-session → layout recalculates → ReactFlow animates
- Replay DVR works identically — layout from state at that timeline position

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| 0 agents | Centered "Waiting for agents..." message |
| 1 agent (no edges) | Single centered node |
| Agent spawns child | Child appears below parent, edge animates in |
| Agent → failed | Border/edge transitions to red, shake animation |
| Agent → completed | Node dims to 0.7 opacity |
| Many agents (50+) | Dagre handles well; MiniMap aids navigation |
| dagre layout crash | Caught error with fallback message |

## Files Changed

| File | Action |
|------|--------|
| `src/components/OfficeBoard.tsx` | Delete |
| `src/components/AgentCanvas.tsx` | Create (replacement) |
| `src/components/AgentCard.tsx` | Delete (replaced by AgentNode) |
| `src/styles.css` | Update: replace board/column/card styles, add canvas/node/edge styles |
| `src/App.tsx` | Minor: swap OfficeBoard → AgentCanvas |
| `package.json` | Add `@xyflow/react`, `dagre`, `@types/dagre` |

## Not Changed

- `src/components/InspectorPanel.tsx` — unchanged (already reads from `WorkflowState`)
- `src/components/EventFeed.tsx` — unchanged
- `src/components/ReplayControls.tsx` — unchanged
- `src/components/SessionSidebar.tsx` — unchanged
- `src/components/StatusLight.tsx` — reused in AgentNode
- `src/components/ResourceChips.tsx` — unchanged
- `src/hooks/useWorkflowStream.ts` — unchanged
- `src/hooks/useReplay.ts` — unchanged
- `src/shared/workflowReducer.ts` — unchanged
- `src/shared/workflowTypes.ts` — unchanged
- `server/` — unchanged

## Testing

- Existing tests should still pass (canvas is a view replacement, not a behavior change)
- New tests for `AgentCanvas` rendering: empty, single agent, parent-child, status colors
- Verify replay animation works with canvas layout
