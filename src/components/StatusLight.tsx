import type { AgentNode } from "../shared/workflowTypes";

type Props = {
  status: AgentNode["status"];
};

const statusColors: Record<AgentNode["status"], string> = {
  incoming: "#9ca3af",
  running: "#3b82f6",
  idle: "#6b7280",
  stale: "#f59e0b",
  completed: "#22c55e",
  failed: "#ef4444"
};

export function StatusLight({ status }: Props) {
  const color = statusColors[status];
  const pulse = status === "running";

  return (
    <span
      className={`status-light${pulse ? " status-light--pulse" : ""}`}
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: "50%",
        backgroundColor: color,
        boxShadow: `0 0 6px ${color}`
      }}
    />
  );
}