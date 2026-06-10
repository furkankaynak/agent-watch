# Canvas Agent View Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the 4-column kanban board (`OfficeBoard`) with a ReactFlow canvas that renders agents as nodes in a parent-child tree layout with animated edges.

**Architecture:** `AgentCanvas.tsx` replaces `OfficeBoard.tsx`. It uses `@xyflow/react` with custom `AgentNode` components and `dagre` for automatic top-to-bottom tree layout. Parent-child relationships (`parentAgentId` on `AgentNode`) become edges with animated arrows. The existing `InspectorPanel`, `EventFeed`, `ReplayControls`, and all hooks remain unchanged.

**Tech Stack:** `@xyflow/react` (ReactFlow v12), `dagre`, `@types/dagre`, TypeScript, CSS.

**Design doc:** `docs/plans/2026-06-09-canvas-agent-view-design.md`

---

### Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Add ReactFlow and dagre**

Run these install commands:

```bash
npm install @xyflow/react dagre
npm install -D @types/dagre
```

Expected: Dependencies added to `package.json` and `node_modules`.

**Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: No errors (new packages resolve correctly).

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @xyflow/react and dagre dependencies"
```

---

### Task 2: Create AgentNode (Custom ReactFlow Node)

**Files:**
- Create: `src/components/AgentNode.tsx`
- Modify: `src/styles.css`

**Step 1: Write the test**

Create `src/components/AgentNode.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AgentNode from './AgentNode';

describe('AgentNode', () => {
  const baseData = {
    label: 'Fix Bug',
    type: 'code-reviewer',
    status: 'running' as const,
    errors: [],
  };

  it('renders label and type badge', () => {
    render(<AgentNode data={baseData} selected={false} />);
    expect(screen.getByText('Fix Bug')).toBeTruthy();
    expect(screen.getByText('code-reviewer')).toBeTruthy();
  });

  it('shows StatusLight', () => {
    const { container } = render(<AgentNode data={baseData} selected={false} />);
    expect(container.querySelector('.status-light')).toBeTruthy();
  });

  it('applies correct border class for running status', () => {
    const { container } = render(<AgentNode data={baseData} selected={false} />);
    expect(container.querySelector('.react-flow__node-agent-node')).toBeTruthy();
  });

  it('shows error badge when errors exist', () => {
    const data = { ...baseData, errors: ['error 1'] };
    render(<AgentNode {...data} selected={false} />);
    expect(screen.getByText('1')).toBeTruthy();
  });
});
```

Wait — ReactFlow custom nodes receive data via `data` prop. The test setup needs to match ReactFlow's node API. Let me simplify:

Actually, ReactFlow custom nodes receive `{ data, selected, ... }` as props. The `data` object contains whatever we put in `node.data`. Let me write the test properly.

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import AgentNode from './AgentNode';

const renderInFlow = (ui: React.ReactElement) =>
  render(<ReactFlowProvider>{ui}</ReactFlowProvider>);

describe('AgentNode', () => {
  const defaultProps = {
    id: 'agent-1',
    data: { label: 'Fix Bug', type: 'code-reviewer', status: 'running' as const, errors: [] },
    selected: false,
  };

  it('renders label and type badge', () => {
    renderInFlow(<AgentNode {...defaultProps} />);
    expect(screen.getByText('Fix Bug')).toBeTruthy();
    expect(screen.getByText('code-reviewer')).toBeTruthy();
  });

  it('renders StatusLight', () => {
    const { container } = renderInFlow(<AgentNode {...defaultProps} />);
    expect(container.querySelector('.status-light')).toBeTruthy();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/AgentNode.test.tsx`
Expected: FAIL — module not found.

**Step 3: Write AgentNode component**

`src/components/AgentNode.tsx`:

```tsx
import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import StatusLight from './StatusLight';
import type { AgentStatus } from '../shared/workflowTypes';

export type AgentNodeData = {
  label: string;
  type: string;
  status: AgentStatus;
  errors: string[];
};

function AgentNode({ data, selected }: NodeProps<AgentNodeData>) {
  const { label, type, status, errors } = data;

  return (
    <div className={`agent-node agent-node--${status}${selected ? ' agent-node--selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="agent-node__header">
        <StatusLight status={status} />
        <span className="agent-node__label">{label}</span>
      </div>
      <div className="agent-node__type">{type}</div>
      {errors.length > 0 && (
        <div className="agent-node__errors">{errors.length}</div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export default memo(AgentNode);
```

**Step 4: Add CSS for agent-node**

In `src/styles.css`, add:

```css
.agent-node {
  background: #fff;
  border: 2px solid #e5e7eb;
  border-radius: 10px;
  padding: 0.5rem 0.7rem;
  font-size: 0.78rem;
  min-width: 160px;
  cursor: pointer;
  animation: cardSpawn 0.25s ease-out;
}

.agent-node:hover {
  border-color: #93c5fd;
  box-shadow: 0 2px 12px rgba(59,130,246,0.12);
}

.agent-node--selected {
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59,130,246,0.3);
}

.agent-node--running { border-color: #3b82f6; }
.agent-node--failed { border-color: #ef4444; }
.agent-node--completed { border-color: #22c55e; opacity: 0.7; }
.agent-node--idle { border-color: #9ca3af; }
.agent-node--stale { border-color: #f59e0b; }
.agent-node--incoming { border-color: #a855f7; border-style: dashed; }

.agent-node__header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.agent-node__label {
  font-weight: 600;
  font-size: 0.82rem;
}

.agent-node__type {
  color: #6b7280;
  font-size: 0.68rem;
  background: #f3f4f6;
  display: inline-block;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  margin-top: 0.2rem;
}

.agent-node__errors {
  color: #ef4444;
  font-size: 0.7rem;
  font-weight: 600;
  margin-top: 0.2rem;
}
```

**Step 5: Run tests to verify they pass**

Run: `npx vitest run src/components/AgentNode.test.tsx`
Expected: PASS

**Step 6: Commit**

```bash
git add src/components/AgentNode.tsx src/components/AgentNode.test.tsx src/styles.css
git commit -m "feat: add AgentNode custom ReactFlow node component"
```

---

### Task 3: Create AgentCanvas Component with Dagre Layout

**Files:**
- Create: `src/components/AgentCanvas.tsx`
- Delete: `src/components/OfficeBoard.tsx`
- Modify: `src/App.tsx`

**Step 1: Write AgentCanvas test**

Create `src/components/AgentCanvas.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AgentCanvas from './AgentCanvas';
import type { AgentNode } from '../shared/workflowTypes';

describe('AgentCanvas', () => {
  const makeAgent = (id: string, overrides: Partial<AgentNode> = {}): AgentNode => ({
    id,
    subagentId: id,
    label: `Agent ${id}`,
    type: 'general',
    status: 'running',
    skills: [],
    rules: [],
    decisions: [],
    activeTools: {},
    lastSeenAt: Date.now(),
    errors: [],
    hookEvents: [],
    ...overrides,
  });

  it('renders empty state', () => {
    const { container } = render(
      <AgentCanvas agents={{}} selectedAgentId={null} onSelectAgent={() => {}} />
    );
    expect(screen.getByText('Waiting for agents...')).toBeTruthy();
  });

  it('renders a single agent node', () => {
    const agents = { 'agent-1': makeAgent('agent-1') };
    render(
      <AgentCanvas agents={agents} selectedAgentId={null} onSelectAgent={() => {}} />
    );
    expect(screen.getByText('Agent agent-1')).toBeTruthy();
  });

  it('renders parent-child pair', () => {
    const agents = {
      'parent-1': makeAgent('parent-1'),
      'child-1': makeAgent('child-1', { parentAgentId: 'parent-1' }),
    };
    render(
      <AgentCanvas agents={agents} selectedAgentId={null} onSelectAgent={() => {}} />
    );
    expect(screen.getByText('Agent parent-1')).toBeTruthy();
    expect(screen.getByText('Agent child-1')).toBeTruthy();
  });

  it('calls onSelectAgent on node click', async () => {
    const onSelect = vi.fn();
    const agents = { 'agent-1': makeAgent('agent-1') };
    render(
      <AgentCanvas agents={agents} selectedAgentId={null} onSelectAgent={onSelect} />
    );
    const node = screen.getByText('Agent agent-1');
    fireEvent.click(node.closest('.agent-node')!);
    // ReactFlow node click event — may need to fire on the node div
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/AgentCanvas.test.tsx`
Expected: FAIL — module not found.

**Step 3: Write AgentCanvas component**

`src/components/AgentCanvas.tsx`:

```tsx
import { useMemo, useCallback } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import AgentNode from './AgentNode';
import type { AgentNode as AgentNodeData } from '../shared/workflowTypes';

const nodeWidth = 180;
const nodeHeight = 60;

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));
dagreGraph.setGraph({ rankdir: 'TB', ranksep: 120, nodesep: 50, edgesep: 30 });

const nodeTypes: NodeTypes = { agentNode: AgentNode };

function layoutNodes(agents: Record<string, AgentNodeData>): {
  nodes: Node[];
  edges: Edge[];
} {
  const agentList = Object.values(agents);
  if (agentList.length === 0) return { nodes: [], edges: [] };

  dagreGraph.setNodes(
    agentList.map((a) => ({ id: a.id, width: nodeWidth, height: nodeHeight }))
  );
  dagreGraph.setEdges(
    agentList
      .filter((a) => a.parentAgentId)
      .map((a) => ({ v: a.parentAgentId!, w: a.id }))
  );

  dagre.layout(dagreGraph);

  const nodes: Node[] = agentList.map((agent) => {
    const dagreNode = dagreGraph.node(agent.id);
    return {
      id: agent.id,
      type: 'agentNode',
      position: {
        x: dagreNode.x - nodeWidth / 2,
        y: dagreNode.y - nodeHeight / 2,
      },
      data: {
        label: agent.label,
        type: agent.type,
        status: agent.status,
        errors: agent.errors,
      },
    };
  });

  const edges: Edge[] = agentList
    .filter((a) => a.parentAgentId)
    .map((a) => ({
      id: `${a.parentAgentId}→${a.id}`,
      source: a.parentAgentId!,
      target: a.id,
      animated: a.status === 'running',
      style: {
        stroke: a.status === 'failed' ? '#ef4444'
             : a.status === 'completed' ? '#22c55e'
             : a.status === 'running' ? '#3b82f6'
             : '#9ca3af',
        strokeWidth: 2,
      },
    }));

  return { nodes, edges };
}

interface AgentCanvasProps {
  agents: Record<string, AgentNodeData>;
  selectedAgentId: string | null;
  onSelectAgent: (id: string | null) => void;
}

export default function AgentCanvas({ agents, selectedAgentId, onSelectAgent }: AgentCanvasProps) {
  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(
    () => layoutNodes(agents),
    [agents]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);

  // Sync when layout changes
  useMemo(() => {
    setNodes(layoutNodes);
    setEdges(layoutEdges);
  }, [layoutNodes, layoutEdges]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onSelectAgent(node.id);
    },
    [onSelectAgent]
  );

  const onPaneClick = useCallback(() => {
    onSelectAgent(null);
  }, [onSelectAgent]);

  const agentList = Object.values(agents);
  if (agentList.length === 0) {
    return (
      <div className="agent-canvas__empty">
        <div className="agent-canvas__empty-dot" />
        <span>Waiting for agents...</span>
      </div>
    );
  }

  return (
    <div className="agent-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        maxZoom={2}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <MiniMap
          nodeStrokeColor="#3b82f6"
          nodeBorderRadius={4}
          style={{ border: '1px solid #e5e7eb' }}
        />
        <Controls />
      </ReactFlow>
    </div>
  );
}
```

**Step 4: Add canvas CSS to styles.css**

```css
.agent-canvas {
  width: 100%;
  height: 100%;
  min-height: 400px;
}

.agent-canvas__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 400px;
  color: #9ca3af;
  font-size: 0.9rem;
  gap: 0.75rem;
}

.agent-canvas__empty-dot {
  width: 12px;
  height: 12px;
  background: #3b82f6;
  border-radius: 50%;
  animation: pulse 1.5s ease-in-out infinite;
}
```

**Step 5: Update App.tsx**

Replace the `OfficeBoard` import and usage with `AgentCanvas`. Read `src/App.tsx` first and then edit.

Swap:
```tsx
// Before:
import OfficeBoard from './components/OfficeBoard';
// ...
<OfficeBoard agents={displayAgents} ... />

// After:
import AgentCanvas from './components/AgentCanvas';
// ...
<AgentCanvas agents={displayAgents} ... />
```

**Step 6: Delete OfficeBoard.tsx**

```bash
rm src/components/OfficeBoard.tsx
```

**Step 7: Run tests to verify they pass**

Run: `npx vitest run src/components/AgentCanvas.test.tsx`
Expected: PASS

**Step 8: Run full test suite**

Run: `npm run test`
Expected: All tests pass (existing tests unchanged since data model is the same).

**Step 9: Run typecheck**

Run: `npm run typecheck`
Expected: No errors.

**Step 10: Commit**

```bash
git add src/components/AgentCanvas.tsx src/components/AgentCanvas.test.tsx src/App.tsx src/styles.css
git rm src/components/OfficeBoard.tsx
git commit -m "feat: replace kanban OfficeBoard with ReactFlow canvas AgentView"
```

---

### Task 4: Remove AgentCard (Replaced by AgentNode)

**Files:**
- Delete: `src/components/AgentCard.tsx`
- Delete: `src/components/StatusLight.tsx` (NO — StatusLight is reused in AgentNode)
- Remove dead styles from `src/styles.css`

**Step 1: Check if anything else imports AgentCard**

Run: `rg "from.*AgentCard" --no-heading`
Expected: No remaining imports (OfficeBoard was the only consumer).

**Step 2: Delete AgentCard**

```bash
rm src/components/AgentCard.tsx
```
(Keep `StatusLight.tsx` — AgentNode reuses it.)

**Step 3: Remove dead styles**

Remove these from `src/styles.css` (if still present):
- `.office-board` and `.board-column-*` styles
- `.agent-card` and `.agent-card--*` styles (except `.status-light--*`)

Read the CSS to identify exact selectors before removing.

**Step 4: Run tests**

Run: `npm run typecheck && npm run test`
Expected: All pass.

**Step 5: Commit**

```bash
git rm src/components/AgentCard.tsx
git add src/styles.css
git commit -m "refactor: remove AgentCard (replaced by AgentNode)"
```

---

### Task 5: Cleanup and Verification

**Step 1: Full verification**

Run: `npm run typecheck && npm run test`
Expected: Both pass with no warnings.

**Step 2: Manual dev check**

Run: `npm run dev`
Expected: Dashboard loads, agents appear as canvas nodes, parent-child arrows visible, zoom/pan works, click node shows inspector, replay works.

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: final cleanup after canvas agent view migration"
```
