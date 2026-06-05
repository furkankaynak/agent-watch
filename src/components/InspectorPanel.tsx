import type { AgentNode } from "../shared/workflowTypes";

type Props = {
  agent: AgentNode | undefined;
};

export function InspectorPanel({ agent }: Props) {
  if (!agent) {
    return (
      <div className="inspector">
        <p className="inspector__empty">Select an agent to inspect</p>
      </div>
    );
  }

  return (
    <div className="inspector">
      <h3 className="inspector__title">{agent.label}</h3>

      <div className="inspector__grid">
        <div className="inspector__field">
          <span className="inspector__key">Type</span>
          <span>{agent.type}</span>
        </div>

        <div className="inspector__field">
          <span className="inspector__key">Status</span>
          <span>{agent.status}</span>
        </div>

        {agent.model && (
          <div className="inspector__field">
            <span className="inspector__key">Model</span>
            <span>{agent.model}</span>
          </div>
        )}

        {agent.parentLabel && (
          <div className="inspector__field">
            <span className="inspector__key">Parent</span>
            <span>{agent.parentLabel}</span>
          </div>
        )}

        {agent.description && (
          <div className="inspector__field">
            <span className="inspector__key">Task</span>
            <span>{agent.description}</span>
          </div>
        )}

        {agent.lastAction && (
          <div className="inspector__field">
            <span className="inspector__key">Last action</span>
            <span>{agent.lastAction}</span>
          </div>
        )}
      </div>

      {agent.skills.length > 0 && (
        <div className="inspector__section">
          <h4>Skills</h4>
          <div className="inspector__chips">
            {agent.skills.map((s) => (
              <span key={s} className="inspector__chip">{s}</span>
            ))}
          </div>
        </div>
      )}

      {agent.rules.length > 0 && (
        <div className="inspector__section">
          <h4>Rules</h4>
          <div className="inspector__chips">
            {agent.rules.map((r) => (
              <span key={r} className="inspector__chip">{r}</span>
            ))}
          </div>
        </div>
      )}

      {agent.decisions.length > 0 && (
        <div className="inspector__section">
          <h4>Decisions</h4>
          <div className="inspector__chips">
            {agent.decisions.map((d) => (
              <span key={d} className="inspector__chip">{d}</span>
            ))}
          </div>
        </div>
      )}

      {Object.keys(agent.activeTools).length > 0 && (
        <div className="inspector__section">
          <h4>Active Tools</h4>
          <ul className="inspector__list">
            {Object.entries(agent.activeTools).map(([id, name]) => (
              <li key={id}>{name}</li>
            ))}
          </ul>
        </div>
      )}

      {agent.errors.length > 0 && (
        <div className="inspector__section inspector__section--errors">
          <h4>Errors</h4>
          <ul className="inspector__list">
            {agent.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}