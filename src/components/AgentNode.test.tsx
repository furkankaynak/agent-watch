import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import AgentNode from './AgentNode';

const renderInFlow = (ui: React.ReactElement) =>
  render(<ReactFlowProvider>{ui}</ReactFlowProvider>);

function createAgentNodeProps(label: string, type: string, status: string, errors: string[]) {
  return {
    id: 'agent-1',
    data: { label, type, status, errors },
    selected: false,
    type: 'agentNode' as const,
  };
}

describe('AgentNode', () => {
  it('renders label and type badge', () => {
    const props = createAgentNodeProps('Fix Bug', 'code-reviewer', 'running', []);
    renderInFlow(
      <AgentNode {...(props as any)} />
    );
    expect(screen.getByText('Fix Bug')).toBeTruthy();
    expect(screen.getByText('code-reviewer')).toBeTruthy();
  });

  it('renders StatusLight', () => {
    const { container } = renderInFlow(
      <AgentNode {...(createAgentNodeProps('Fix Bug', 'code-reviewer', 'running', []) as any)} />
    );
    expect(container.querySelector('.status-light')).toBeTruthy();
  });

  it('renders error count badge when errors exist', () => {
    const props = createAgentNodeProps('Fix Bug', 'code-reviewer', 'running', ['error 1']);
    renderInFlow(
      <AgentNode {...(props as any)} />
    );
    expect(screen.getByText('1')).toBeTruthy();
  });
});
