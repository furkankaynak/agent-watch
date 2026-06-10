import type { LogEvent } from "./logTypes";

export type AgentStatus = "incoming" | "running" | "idle" | "stale" | "completed" | "failed";

export type AgentNode = {
  id: string;
  subagentId: string;
  label: string;
  type: string;
  parentAgentId?: string;
  parentLabel?: string;
  description?: string;
  status: AgentStatus;
  model?: string;
  skills: string[];
  rules: string[];
  decisions: string[];
  activeTools: Record<string, string>;
  lastAction?: string;
  lastSeenAt: number;
  errors: string[];
  hookEvents: string[];
  toolCallCount: number;
  toolErrorCount: number;
  fileReadCount: number;
  fileEditCount: number;
  shellCommandCount: number;
  mcpCallCount: number;
  subagentCount: number;
  durationMs: number | null;
  lastFile: string | null;
};

export type TaskCall = {
  id: string;
  conversationId: string;
  subagentType: string;
  description?: string;
  parentAgentId?: string;
  timestamp: string;
};

export type WorkflowState = {
  agents: Record<string, AgentNode>;
  taskCalls: TaskCall[];
  events: LogEvent[];
  conversationToAgentId: Record<string, string>;
  conversationLatestAgentId: Record<string, string>;
  unboundAgentIds: string[];
};
