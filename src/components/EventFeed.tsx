import type { LogEvent } from "../shared/logTypes";
import type { WorkflowState } from "../shared/workflowTypes";

type Props = {
  events: LogEvent[];
  conversationToAgentId: Record<string, string>;
  agents: WorkflowState["agents"];
};

function shortMessage(event: LogEvent, props: Props): string {
  const agentId = event.fields.conversation_id
    ? (props.conversationToAgentId[event.fields.conversation_id] ??
      Object.values(props.conversationToAgentId).find((agentId) => {
        const fullKey = `${event.fields.conversation_id}:${event.fields.generation_id}`;
        return props.conversationToAgentId[fullKey] === agentId;
      }))
    : undefined;

  const agentLabel = agentId ? props.agents[agentId]?.label : undefined;
  const prefix = agentLabel ? `${agentLabel}: ` : "";

  switch (event.eventType) {
    case "skill_read":
      return `${prefix}loaded skill ${event.fields.skill ?? "unknown"}`;
    case "rule_read":
      return `${prefix}loaded rule ${event.fields.rule ?? "unknown"}`;
    case "decisions_read":
      return `${prefix}read decisions ${event.fields.decision ?? "unknown"}`;
    case "tool_start":
      return `${prefix}${event.fields.tool_name ?? "tool"} ${
        event.fields.input_path ??
        event.fields.input_file_path ??
        event.fields.input_pattern ??
        event.fields.input_command ??
        ""
      }`;
    case "tool_done":
      return `${prefix}${event.fields.tool_name ?? "tool"} ${
        event.fields.ok === "true" ? "✓" : "✗"
      } ${event.fields.duration_ms ? `${event.fields.duration_ms}ms` : ""}`;
    case "subagent_start":
      return `${event.fields.agent_label ?? event.fields.subagent_type ?? "agent"} started`;
    case "session_end":
      return `${prefix}session ${event.fields.final_status ?? "ended"}`;
    case "file_read":
      return `${prefix}read ${event.fields.basename ?? event.fields.path ?? "file"}`;
    case "file_edit":
      return `${prefix}edited ${event.fields.path ?? "file"}`;
    case "shell_start":
      return `${prefix}shell ${event.fields.command_summary ?? "started"}`;
    case "shell_done":
      return `${prefix}shell done ${event.fields.duration_ms ? `${event.fields.duration_ms}ms` : ""}`;
    default:
      return `${prefix}${event.eventType}`;
  }
}

export function EventFeed({ events, conversationToAgentId, agents }: Props) {
  const recent = events.slice(-50).reverse();

  return (
    <div className="event-feed">
      <h3 className="event-feed__title">Live Events</h3>
      <div className="event-feed__list">
        {recent.map((event, i) => (
          <div key={`${event.lineNumber}-${i}`} className="event-feed__item">
            <span className="event-feed__time">
              {event.timestamp.slice(11, 23)}
            </span>
            <span className={`event-feed__type event-feed__type--${event.eventType}`}>
              {event.eventType}
            </span>
            <span className="event-feed__msg">
              {shortMessage(event, { events, conversationToAgentId, agents })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}