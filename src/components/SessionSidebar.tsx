import { useState } from "react";
import type { Session } from "../hooks/useSessions";

type Props = {
  sessions: Session[];
  selectedSessionId: string | null;
  activeSessionId: string | null;
  onSelect: (id: string) => void;
};

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) +
    " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function SessionSidebar({ sessions, selectedSessionId, activeSessionId, onSelect }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <aside className="session-sidebar session-sidebar--collapsed">
        <button
          className="session-sidebar__toggle"
          onClick={() => setCollapsed(false)}
          title="Expand sessions"
        >
          &#8250;
        </button>
      </aside>
    );
  }

  return (
    <aside className="session-sidebar">
      <div className="session-sidebar__header">
        <h2 className="session-sidebar-title">Sessions</h2>
        <button
          className="session-sidebar__toggle"
          onClick={() => setCollapsed(true)}
          title="Collapse sessions"
        >
          &#8249;
        </button>
      </div>

      {sessions.length === 0 ? (
        <p className="session-sidebar-empty">No sessions yet</p>
      ) : (
        <ul className="session-sidebar-list">
          {sessions.map((session) => {
            const isActive = session.conversation_id === activeSessionId;
            const isSelected = session.conversation_id === selectedSessionId;
            return (
              <li
                key={session.conversation_id}
                className={`session-sidebar-item${isSelected ? " selected" : ""}${isActive ? " active" : ""}`}
                onClick={() => onSelect(session.conversation_id)}
              >
                <span className={`session-status-dot ${isActive ? "running" : session.status === "ended" ? "completed" : ""}`} />
                <div className="session-sidebar-item__content">
                  <span className="session-label">{shortId(session.conversation_id)}</span>
                  {session.model && (
                    <span className="session-model">{session.model}</span>
                  )}
                </div>
                <div className="session-sidebar-item__meta">
                  {isActive ? (
                    <span className="live-badge">LIVE</span>
                  ) : (
                    <span className="session-time">{formatDate(session.started_at)}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
