export const HOOK_EVENT_LABELS: Record<string, string> = {
  sessionStart: "Session Start",
  sessionEnd: "Session End",
  preToolUse: "Pre Tool Use",
  postToolUse: "Post Tool Use",
  postToolUseFailure: "Tool Failed",
  subagentStart: "Subagent Started",
  subagentStop: "Subagent Stopped",
  beforeShellExecution: "Before Shell",
  afterShellExecution: "After Shell",
  beforeMCPExecution: "Before MCP",
  afterMCPExecution: "After MCP",
  beforeReadFile: "Before Read",
  afterFileEdit: "After Edit",
  beforeSubmitPrompt: "Before Submit",
  preCompact: "Context Compact",
  stop: "Agent Stopped",
  afterAgentResponse: "Agent Response",
  afterAgentThought: "Agent Thought",
  beforeTabFileRead: "Tab Before Read",
  afterTabFileEdit: "Tab After Edit",
  workspaceOpen: "Workspace Open",
};

export type HookCategory = "agent" | "tab" | "lifecycle";

export const HOOK_CATEGORY: Record<string, HookCategory> = {
  sessionStart: "agent", sessionEnd: "agent", preToolUse: "agent",
  postToolUse: "agent", postToolUseFailure: "agent", subagentStart: "agent",
  subagentStop: "agent", beforeShellExecution: "agent", afterShellExecution: "agent",
  beforeMCPExecution: "agent", afterMCPExecution: "agent", beforeReadFile: "agent",
  afterFileEdit: "agent", beforeSubmitPrompt: "agent", preCompact: "agent",
  stop: "agent", afterAgentResponse: "agent", afterAgentThought: "agent",
  beforeTabFileRead: "tab", afterTabFileEdit: "tab",
  workspaceOpen: "lifecycle",
};

export const ALL_HOOK_EVENTS = Object.keys(HOOK_EVENT_LABELS);

export function hookLabel(name: string): string {
  return HOOK_EVENT_LABELS[name] ?? name;
}

export function hookCategory(name: string): HookCategory {
  return HOOK_CATEGORY[name] ?? "agent";
}
