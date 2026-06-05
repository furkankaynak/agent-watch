import type { AgentNode } from "../shared/workflowTypes";
import { StatusLight } from "./StatusLight";
import { ResourceChips } from "./ResourceChips";

type Props = {
  agent: AgentNode;
  isSelected: boolean;
  onSelect: (id: string) => void;
};

export function AgentCard({ agent, isSelected, onSelect }: Props) {
  const hideErrors = import.meta.env.VITE_HIDE_ERRORS === "true";
  const visibleStatus = hideErrors && agent.status === "failed" ? "idle" : agent.status;
  const statusClass = `agent-card agent-card--${visibleStatus}${isSelected ? " agent-card--selected" : ""}`;

  return (
    <div className={statusClass} onClick={() => onSelect(agent.id)}>
      <div className="agent-card__header">
        <StatusLight status={agent.status} />
        <span className="agent-card__label">{agent.label}</span>
        <span className="agent-card__type">{agent.type}</span>
      </div>

      {agent.parentLabel && (
        <div className="agent-card__parent">Called by: {agent.parentLabel}</div>
      )}

      {agent.model && (
        <div className="agent-card__model">{agent.model}</div>
      )}

      {agent.description && (
        <div className="agent-card__desc">{agent.description}</div>
      )}

      {agent.lastAction && (
        <div className="agent-card__action">
          <span className="agent-card__action-label">Last:</span> {agent.lastAction}
        </div>
      )}

      <ResourceChips label="Skills" items={agent.skills} />
      <ResourceChips label="Rules" items={agent.rules} />

      {!hideErrors && agent.errors.length > 0 && (
        <div className="agent-card__errors">
          Errors: {agent.errors.length}
        </div>
      )}

      {Object.keys(agent.activeTools).length > 0 && (
        <div className="agent-card__tools">
          Active: {Object.values(agent.activeTools).join(", ")}
        </div>
      )}
    </div>
  );
}