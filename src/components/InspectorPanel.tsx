import type { AgentNode } from "../shared/workflowTypes";
import type { LogEvent } from "../shared/logTypes";
import { hookLabel, hookCategory } from "../shared/hookTypes";

type Props = {
  agent: AgentNode | undefined;
  events: LogEvent[];
  agents: Record<string, AgentNode>;
};

function filterAgentEvents(agentId: string, events: LogEvent[]) {
  return events.filter((e) => {
    const cid = e.fields.conversation_id;
    if (!cid) return false;
    return cid === agentId || e.fields.tool_use_id === agentId;
  });
}

function getToolCalls(agentId: string, events: LogEvent[]) {
  const toolIds = new Set<string>();
  const result: { name: string; ok: boolean; dur: number | null }[] = [];
  const filtered = filterAgentEvents(agentId, events);
  for (const ev of filtered) {
    if (ev.eventType === "tool_start") {
      toolIds.add(ev.fields.tool_use_id || "");
    } else if (ev.eventType === "tool_done") {
      const id = ev.fields.tool_use_id;
      if (id && toolIds.has(id)) {
        result.push({
          name: ev.fields.tool_name || "?",
          ok: ev.fields.ok !== "false",
          dur: Number(ev.fields.duration_ms) || null,
        });
      }
    }
  }
  return result;
}

function getFileOps(agentId: string, events: LogEvent[]) {
  const seen = new Set<string>();
  const result: { path: string; type: "read" | "edit" }[] = [];
  for (const ev of events) {
    if (ev.eventType !== "file_read" && ev.eventType !== "file_edit" && ev.eventType !== "tab_file_read" && ev.eventType !== "tab_file_edit") continue;
    if (ev.fields.conversation_id !== agentId) continue;
    const fp = ev.fields.file_path;
    if (!fp || seen.has(fp)) continue;
    seen.add(fp);
    result.push({
      path: fp,
      type: (ev.eventType === "file_edit" || ev.eventType === "tab_file_edit") ? "edit" : "read",
    });
  }
  return result;
}

function getShellCommands(agentId: string, events: LogEvent[]) {
  const result: { cmd: string; dur: number | null; exit: string | null }[] = [];
  for (const ev of events) {
    if (ev.eventType !== "shell_start" || ev.fields.conversation_id !== agentId) continue;
    result.push({
      cmd: ev.fields.command_summary || "(command)",
      dur: Number(ev.fields.duration_ms) || null,
      exit: ev.fields.exit_hint || null,
    });
  }
  return result;
}

function getMCPCalls(agentId: string, events: LogEvent[]) {
  const result: { name: string; dur: number | null }[] = [];
  for (const ev of events) {
    if (ev.eventType !== "mcp_start" || ev.fields.conversation_id !== agentId) continue;
    result.push({
      name: ev.fields.tool_name || "?",
      dur: Number(ev.fields.duration_ms) || null,
    });
  }
  return result;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function InspectorPanel({ agent, events, agents }: Props) {
  if (!agent) {
    return (
      <div className="inspector">
        <p className="inspector__empty">Select an agent to inspect</p>
      </div>
    );
  }

  const toolCalls = getToolCalls(agent.id, events);
  const fileOps = getFileOps(agent.id, events);
  const shellCmds = getShellCommands(agent.id, events);
  const mcpCalls = getMCPCalls(agent.id, events);
  const childAgents = Object.values(agents).filter(a => a.parentAgentId === agent.id);

  return (
    <div className="inspector">
      <h3 className="inspector__title">{agent.label}</h3>

      {agent.parentAgentId && (
        <div className="inspector-hierarchy">
          <h4>Parent</h4>
          <span className="inspector-parent-link">
            {agent.parentLabel ?? agent.parentAgentId}
          </span>
        </div>
      )}

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

      {toolCalls.length > 0 && (
        <div className="inspector__section">
          <h4>Tool Calls ({toolCalls.length})</h4>
          <ul className="inspector__list">
            {toolCalls.slice(-10).reverse().map((tc, i) => (
              <li key={i} className={tc.ok ? "" : "inspector__item--error"}>
                <span>{tc.name}</span>
                <span>{tc.ok ? "✓" : "✗"}</span>
                {tc.dur != null && <span>{tc.dur}ms</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {fileOps.length > 0 && (
        <div className="inspector__section">
          <h4>Files ({fileOps.length})</h4>
          <ul className="inspector__list inspector__list--compact">
            {fileOps.slice(-10).map((f, i) => (
              <li key={i}>
                <span>{f.type === "read" ? "📖" : "✏️"}</span>
                <span>{f.path.split("/").pop() || f.path}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {shellCmds.length > 0 && (
        <div className="inspector__section">
          <h4>Shell ({shellCmds.length})</h4>
          <ul className="inspector__list inspector__list--compact">
            {shellCmds.slice(-5).reverse().map((s, i) => (
              <li key={i}>
                <span>{s.exit === "ok" ? "✓" : s.exit ? "✗" : "?"}</span>
                <span>{s.cmd}</span>
                {s.dur != null && <span>{s.dur}ms</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {mcpCalls.length > 0 && (
        <div className="inspector__section">
          <h4>MCP ({mcpCalls.length})</h4>
          <ul className="inspector__list inspector__list--compact">
            {mcpCalls.slice(-5).reverse().map((m, i) => (
              <li key={i}>
                <span>{m.name}</span>
                {m.dur != null && <span>{m.dur}ms</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {childAgents.length > 0 && (
        <div className="inspector__section">
          <h4>Subagents ({childAgents.length})</h4>
          <ul className="inspector__list">
            {childAgents.map((c) => (
              <li key={c.id}>
                <span>{c.label}</span>
                <span style={{ color: c.status === "failed" ? "#ef4444" : c.status === "completed" ? "#22c55e" : undefined }}>
                  {c.status}
                </span>
                {c.toolCallCount > 0 && <span>{c.toolCallCount} tools</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {agent.hookEvents.length > 0 && (
        <div className="inspector__section">
          <h4>Hook Events</h4>
          <div className="inspector__chips">
            {agent.hookEvents.map((h) => (
              <span
                key={h}
                className={`inspector__chip inspector__chip--hook inspector__chip--hook-${hookCategory(h)}`}
              >
                {hookLabel(h)}
              </span>
            ))}
          </div>
        </div>
      )}

      {import.meta.env.VITE_HIDE_ERRORS !== "true" && agent.errors.length > 0 && (
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
