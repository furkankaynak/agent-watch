import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { StatusLight } from './StatusLight';
import type { AgentStatus } from '../shared/workflowTypes';

export type AgentNodeData = {
  label: string;
  type: string;
  status: AgentStatus;
  errors: string[];
};

export type AgentNodeType = Node<AgentNodeData, 'agentNode'>;

function AgentNode({ data, selected }: NodeProps<AgentNodeType>) {
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
