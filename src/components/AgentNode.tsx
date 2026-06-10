import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { StatusLight } from './StatusLight';
import type { AgentStatus } from '../shared/workflowTypes';

export type AgentNodeData = {
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

export type AgentNodeType = Node<AgentNodeData, 'agentNode'>;

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function AgentNode({ data, selected }: NodeProps<AgentNodeType>) {
  const { label, type, status, errors, toolCallCount, toolErrorCount, fileEditCount, fileReadCount, durationMs } = data;
  const fileCount = fileEditCount + fileReadCount;
  const hasStats = toolCallCount > 0 || fileCount > 0 || toolErrorCount > 0 || durationMs != null;

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
      {hasStats && (
        <div className="agent-node__stats">
          {toolCallCount > 0 && (
            <span className="agent-node__badge agent-node__badge--tools">{toolCallCount}</span>
          )}
          {fileCount > 0 && (
            <span className="agent-node__badge agent-node__badge--files">{fileCount}</span>
          )}
          {toolErrorCount > 0 && (
            <span className="agent-node__badge agent-node__badge--errors">{toolErrorCount}</span>
          )}
          {durationMs != null && (
            <span className="agent-node__badge agent-node__badge--time">{formatDuration(durationMs)}</span>
          )}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export default memo(AgentNode);
