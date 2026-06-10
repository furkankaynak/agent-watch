import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AgentCanvas from './AgentCanvas';
import type { AgentNode } from '../shared/workflowTypes';

function makeAgent(id: string, overrides: Partial<AgentNode> = {}): AgentNode {
  return {
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
    toolCallCount: 0,
    toolErrorCount: 0,
    fileReadCount: 0,
    fileEditCount: 0,
    shellCommandCount: 0,
    mcpCallCount: 0,
    subagentCount: 0,
    durationMs: null,
    lastFile: null,
    ...overrides,
  };
}

describe('AgentCanvas', () => {
  it('renders empty state', () => {
    render(
      <AgentCanvas agents={[]} selectedAgentId={null} onSelectAgent={() => {}} />
    );
    expect(screen.getByText('Waiting for agents...')).toBeTruthy();
  });

  it('renders a single agent label', () => {
    render(
      <AgentCanvas
        agents={[makeAgent('agent-1')]}
        selectedAgentId={null}
        onSelectAgent={() => {}}
      />
    );
    expect(screen.getByText('Agent agent-1')).toBeTruthy();
  });

  it('renders parent and child agent labels', () => {
    render(
      <AgentCanvas
        agents={[
          makeAgent('parent-1'),
          makeAgent('child-1', { parentAgentId: 'parent-1' }),
        ]}
        selectedAgentId={null}
        onSelectAgent={() => {}}
      />
    );
    expect(screen.getByText('Agent parent-1')).toBeTruthy();
    expect(screen.getByText('Agent child-1')).toBeTruthy();
  });
});
