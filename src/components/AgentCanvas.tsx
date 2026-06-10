import { useMemo, useEffect, useCallback } from 'react';
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

const nodeTypes: NodeTypes = { agentNode: AgentNode };

function layoutNodes(
  agentList: AgentNodeData[],
  selectedAgentId: string | null
): { nodes: Node[]; edges: Edge[] } {
  if (agentList.length === 0) return { nodes: [], edges: [] };

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', ranksep: 120, nodesep: 50, edgesep: 30 });

  agentList.forEach((a) => g.setNode(a.id, { width: nodeWidth, height: nodeHeight }));
  agentList
    .filter((a) => a.parentAgentId)
    .forEach((a) => g.setEdge(a.parentAgentId!, a.id));

  dagre.layout(g);

  const nodes: Node[] = agentList.map((agent) => {
    const dagreNode = g.node(agent.id);
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
      selected: agent.id === selectedAgentId,
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
  agents: AgentNodeData[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string | null) => void;
}

export default function AgentCanvas({ agents: agentList, selectedAgentId, onSelectAgent }: AgentCanvasProps) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => layoutNodes(agentList, selectedAgentId),
    [agentList, selectedAgentId]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onSelectAgent(node.id);
    },
    [onSelectAgent]
  );

  const onPaneClick = useCallback(() => {
    onSelectAgent(null);
  }, [onSelectAgent]);

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
