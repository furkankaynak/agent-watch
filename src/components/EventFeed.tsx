import { useState } from "react";
import type { LogEvent } from "../shared/logTypes";
import type { WorkflowState } from "../shared/workflowTypes";
import { hookLabel } from "../shared/hookTypes";

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
        event.fields.ok === "true" ? "ok" : "failed"
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
    case "hook_event":
      return `${prefix}${hookLabel(event.fields.hook_event_name ?? "")}${
        event.fields.tool_name ? ` ${event.fields.tool_name}` : ""
      }${
        event.fields.status ? ` ${event.fields.status}` : ""
      }`;
    default:
      return `${prefix}${event.eventType}`;
  }
}

function EventDetail({ event }: { event: LogEvent }) {
  const [fullEvent, setFullEvent] = useState<LogEvent | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (fullEvent || loading || !event.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/events/${event.id}`);
      const data = await res.json();
      setFullEvent(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  if (!event._hasHeavy && !fullEvent) return null;

  if (!fullEvent) {
    return (
      <div className="event-feed__detail">
        <button className="event-feed__load-btn" onClick={load} disabled={loading}>
          {loading ? "loading..." : "show detail"}
        </button>
      </div>
    );
  }

  const heavyFields = Object.entries(fullEvent.fields).filter(([k]) =>
    event.fields[k] === "[heavy]"
  );

  if (heavyFields.length === 0) return null;

  return (
    <div className="event-feed__detail">
      {heavyFields.map(([key, value]) => (
        <div key={key} className="event-feed__detail-field">
          <span className="event-feed__detail-key">{key}</span>
          <pre className="event-feed__detail-value">{value}</pre>
        </div>
      ))}
    </div>
  );
}

export function EventFeed({ events, conversationToAgentId, agents }: Props) {
  const recent = events.slice(-50).reverse();
  const [expandedId, setExpandedId] = useState<number | null>(null);

  return (
    <div className="event-feed">
      <h3 className="event-feed__title">Live Events</h3>
      <div className="event-feed__list">
        {recent.map((event, i) => {
          const key = event.id ?? event.lineNumber;
          const isExpanded = expandedId === key;
          return (
            <div key={`${event.lineNumber}-${i}`}>
              <div
                className={`event-feed__item${event._hasHeavy ? " event-feed__item--expandable" : ""}`}
                onClick={() => event._hasHeavy && setExpandedId(isExpanded ? null : (key as number))}
              >
                <span className="event-feed__time">
                  {event.timestamp.slice(11, 23)}
                </span>
                <span className={`event-feed__type event-feed__type--${event.eventType}`}>
                  {event.eventType}
                </span>
                <span className="event-feed__msg">
                  {shortMessage(event, { events, conversationToAgentId, agents })}
                </span>
                {event._hasHeavy && (
                  <span className={`event-feed__chevron${isExpanded ? " event-feed__chevron--open" : ""}`}>
                    &#8250;
                  </span>
                )}
              </div>
              {isExpanded && <EventDetail event={event} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
