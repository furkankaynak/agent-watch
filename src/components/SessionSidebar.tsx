import type { Run } from "../hooks/useRuns";

type Props = {
  runs: Run[];
  selectedRunId: number | null;
  activeRunId: number | null;
  onSelect: (id: number) => void;
};

export function SessionSidebar({ runs, selectedRunId, activeRunId, onSelect }: Props) {
  if (runs.length === 0) {
    return (
      <aside className="session-sidebar">
        <h2 className="session-sidebar-title">Sessions</h2>
        <p className="session-sidebar-empty">No sessions yet</p>
      </aside>
    );
  }

  return (
    <aside className="session-sidebar">
      <h2 className="session-sidebar-title">Sessions</h2>
      <ul className="session-sidebar-list">
        {runs.map((run) => (
          <li
            key={run.id}
            className={`session-sidebar-item${
              run.id === selectedRunId ? " selected" : ""
            }${run.id === activeRunId ? " active" : ""}`}
            onClick={() => onSelect(run.id)}
          >
            <span className={`session-status-dot ${run.status}`} />
            <span className="session-label">
              {run.label ?? `Run #${run.id}`}
            </span>
            <span className="session-time">
              {formatTime(run.started_at)}
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
