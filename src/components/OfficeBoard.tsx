import type { AgentNode } from "../shared/workflowTypes";
import { AgentCard } from "./AgentCard";

type Props = {
  agents: AgentNode[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
};

const qualityTypes = new Set([
  "code-reviewer",
  "test-engineer",
  "accessibility-auditor",
  "verifier"
]);

export function OfficeBoard({ agents, selectedAgentId, onSelectAgent }: Props) {
  const incoming = agents.filter((a) => a.status === "incoming");
  const active = agents.filter(
    (a) =>
      (a.status === "running" || a.status === "idle" || a.status === "stale") &&
      !qualityTypes.has(a.type)
  );
  const quality = agents.filter(
    (a) =>
      (a.status === "running" || a.status === "idle" || a.status === "stale") &&
      qualityTypes.has(a.type)
  );
  const done = agents.filter(
    (a) => a.status === "completed" || a.status === "failed"
  );

  if (agents.length === 0) {
    return (
      <div className="office-board__empty">
        <p>Waiting for agent activity...</p>
        <p className="office-board__hint">Watch activity.log for events</p>
      </div>
    );
  }

  return (
    <div className="office-board">
      <BoardColumn title="Incoming" agents={incoming} selectedAgentId={selectedAgentId} onSelectAgent={onSelectAgent} />
      <BoardColumn title="Active Desk" agents={active} selectedAgentId={selectedAgentId} onSelectAgent={onSelectAgent} />
      <BoardColumn title="Quality Desk" agents={quality} selectedAgentId={selectedAgentId} onSelectAgent={onSelectAgent} />
      <BoardColumn title="Done" agents={done} selectedAgentId={selectedAgentId} onSelectAgent={onSelectAgent} />
    </div>
  );
}

function BoardColumn({
  title,
  agents,
  selectedAgentId,
  onSelectAgent
}: {
  title: string;
  agents: AgentNode[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
}) {
  return (
    <div className="board-column">
      <h2 className="board-column__title">
        {title} <span className="board-column__count">{agents.length}</span>
      </h2>
      <div className="board-column__cards">
        {agents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            isSelected={agent.id === selectedAgentId}
            onSelect={onSelectAgent}
          />
        ))}
      </div>
    </div>
  );
}