import type { LogEvent } from "./logTypes";
import { isHookEvent } from "./logTypes";
import type { AgentNode, AgentStatus, TaskCall, WorkflowState } from "./workflowTypes";

export type { AgentNode, AgentStatus, TaskCall, WorkflowState } from "./workflowTypes";

const STALE_AFTER_MS = 45_000;

export function createInitialWorkflowState(): WorkflowState {
  return {
    agents: {},
    taskCalls: [],
    events: [],
    conversationToAgentId: {},
    conversationLatestAgentId: {},
    unboundAgentIds: []
  };
}

export function reduceWorkflowEvents(events: LogEvent[]): WorkflowState {
  return events.reduce(applyWorkflowEvent, createInitialWorkflowState());
}

export function applyWorkflowEvent(state: WorkflowState, event: LogEvent): WorkflowState {
  const nextState = {
    ...state,
    events: [...state.events, event]
  };

  switch (event.eventType) {
    case "tool_start":
      return applyToolStart(nextState, event);
    case "tool_done":
      return applyToolDone(nextState, event);
    case "subagent_start":
      return applySubagentStart(nextState, event);
    case "skill_read":
      return applyChipEvent(nextState, event, "skills");
    case "rule_read":
      return applyChipEvent(nextState, event, "rules");
    case "decisions_read":
      return applyChipEvent(nextState, event, "decisions");
    case "session_end":
      return applySessionEnd(nextState, event);
    case "hook_event":
      return applyHookEvent(nextState, event);
    default:
      return touchBoundAgent(nextState, event);
  }
}

export function selectAgents(state: WorkflowState, now = Date.now()): AgentNode[] {
  return Object.values(state.agents).map((agent) => {
    if (
      (agent.status === "running" || agent.status === "idle") &&
      now - agent.lastSeenAt > STALE_AFTER_MS
    ) {
      return {
        ...agent,
        status: "stale"
      };
    }

    return agent;
  });
}

function applyToolStart(state: WorkflowState, event: LogEvent): WorkflowState {
  let nextState = state;
  const bound = bindConversationIfNeeded(nextState, event);
  nextState = bound.state;

  if (bound.agentId) {
    nextState = updateAgent(nextState, bound.agentId, (agent) => {
      const toolUseId = event.fields.tool_use_id;
      const toolName = event.fields.tool_name;
      const activeTools = toolUseId && toolName
        ? { ...agent.activeTools, [toolUseId]: toolName }
        : agent.activeTools;

      return {
        ...agent,
        activeTools,
        lastAction: formatLastAction(event) ?? agent.lastAction,
        lastSeenAt: eventTime(event),
        status: activeStatus(agent.status)
      };
    });
  }

  if (event.fields.tool_name === "Task") {
    return createTaskAgent(nextState, event, bound.agentId);
  }

  return nextState;
}

function createTaskAgent(
  state: WorkflowState,
  event: LogEvent,
  parentAgentId?: string
): WorkflowState {
  const id = event.fields.tool_use_id;

  if (!id) {
    return state;
  }

  const subagentType = event.fields.input_subagent_type ?? "agent";
  const parentAgent = parentAgentId ? state.agents[parentAgentId] : undefined;
  const description = event.fields.input_description;
  const agent: AgentNode = {
    id,
    subagentId: subagentType,
    label: humanizeLabel(subagentType),
    type: subagentType,
    ...(parentAgentId ? { parentAgentId } : {}),
    ...(parentAgent?.label ? { parentLabel: parentAgent.label } : {}),
    ...(description ? { description } : {}),
    status: "incoming",
    skills: [],
    rules: [],
    decisions: [],
    activeTools: {},
    lastSeenAt: eventTime(event),
    errors: [],
    hookEvents: []
  };
  const taskCall: TaskCall = {
    id,
    conversationId: event.fields.conversation_id ?? "",
    subagentType,
    ...(description ? { description } : {}),
    ...(parentAgentId ? { parentAgentId } : {}),
    timestamp: event.timestamp
  };

  return {
    ...state,
    agents: {
      ...state.agents,
      [id]: agent
    },
    taskCalls: [...state.taskCalls, taskCall]
  };
}

function applySubagentStart(state: WorkflowState, event: LogEvent): WorkflowState {
  const agentId = findSubagentStartTarget(state, event);

  if (!agentId) {
    return state;
  }

  const updated = updateAgent(state, agentId, (agent) => {
    const type = event.fields.subagent_type ?? event.fields.agent_type ?? agent.type;
    const label = event.fields.agent_label ?? humanizeLabel(type);
    const model = event.fields.subagent_model ?? event.fields.model ?? agent.model;

    return {
      ...agent,
      subagentId: event.fields.subagent_id ?? agent.subagentId,
      label,
      type,
      ...(model ? { model } : {}),
      status: activeStatus(agent.status),
      lastSeenAt: eventTime(event)
    };
  });

  if (updated.unboundAgentIds.includes(agentId)) {
    return updated;
  }

  return {
    ...updated,
    unboundAgentIds: [...updated.unboundAgentIds, agentId]
  };
}

function applyChipEvent(
  state: WorkflowState,
  event: LogEvent,
  key: "skills" | "rules" | "decisions"
): WorkflowState {
  const bound = bindConversationIfNeeded(state, event);

  if (!bound.agentId) {
    return bound.state;
  }

  const value = chipValue(event, key);

  return updateAgent(bound.state, bound.agentId, (agent) => ({
    ...agent,
    [key]: value ? appendUnique(agent[key], value) : agent[key],
    lastSeenAt: eventTime(event),
    status: activeStatus(agent.status)
  }));
}

function applyToolDone(state: WorkflowState, event: LogEvent): WorkflowState {
  const bound = bindConversationIfNeeded(state, event);

  if (!bound.agentId) {
    return bound.state;
  }

  return updateAgent(bound.state, bound.agentId, (agent) => {
    const activeTools = removeKey(agent.activeTools, event.fields.tool_use_id);
    const failed = eventIndicatesFailure(event);
    const errors = failed
      ? [...agent.errors, toolErrorMessage(event)]
      : agent.errors;

    return {
      ...agent,
      activeTools,
      errors,
      lastSeenAt: eventTime(event),
      status: failed ? "failed" : doneStatus(agent.status, activeTools)
    };
  });
}

function applySessionEnd(state: WorkflowState, event: LogEvent): WorkflowState {
  const bound = bindConversationIfNeeded(state, event);

  if (!bound.agentId) {
    return bound.state;
  }

  return updateAgent(bound.state, bound.agentId, (agent) => ({
    ...agent,
    lastSeenAt: eventTime(event),
    status: sessionEndStatus(agent, event.fields.final_status)
  }));
}

function applyHookEvent(state: WorkflowState, event: LogEvent): WorkflowState {
  const hookName = event.fields.hook_event_name;
  if (!hookName) return state;

  switch (hookName) {
    case "subagentStop":
      return applySubagentStopHook(state, event);
    case "stop":
      return applyStopHook(state, event);
    default:
      return touchBoundAgentWithHookEvent(state, event, hookName);
  }
}

function applySubagentStopHook(state: WorkflowState, event: LogEvent): WorkflowState {
  const bound = bindConversationIfNeeded(state, event);

  if (!bound.agentId) {
    return bound.state;
  }

  const hookStatus = event.fields.status;

  return updateAgent(bound.state, bound.agentId, (agent) => ({
    ...agent,
    lastSeenAt: eventTime(event),
    hookEvents: appendUnique(agent.hookEvents, "subagentStop"),
    status: hookStatus === "completed" ? "completed"
      : hookStatus === "error" ? "failed"
      : hookStatus === "aborted" ? "failed"
      : agent.status
  }));
}

function applyStopHook(state: WorkflowState, event: LogEvent): WorkflowState {
  const bound = bindConversationIfNeeded(state, event);

  if (!bound.agentId) {
    return bound.state;
  }

  const hookStatus = event.fields.status;

  return updateAgent(bound.state, bound.agentId, (agent) => ({
    ...agent,
    lastSeenAt: eventTime(event),
    hookEvents: appendUnique(agent.hookEvents, "stop"),
    status: hookStatus === "completed" ? "completed"
      : hookStatus === "aborted" || hookStatus === "error" ? "failed"
      : agent.status
  }));
}

function touchBoundAgentWithHookEvent(
  state: WorkflowState,
  event: LogEvent,
  hookName: string
): WorkflowState {
  const bound = bindConversationIfNeeded(state, event);

  if (!bound.agentId) {
    return bound.state;
  }

  return updateAgent(bound.state, bound.agentId, (agent) => ({
    ...agent,
    lastSeenAt: eventTime(event),
    hookEvents: appendUnique(agent.hookEvents, hookName),
    status: activeStatus(agent.status)
  }));
}

function touchBoundAgent(state: WorkflowState, event: LogEvent): WorkflowState {
  const bound = bindConversationIfNeeded(state, event);

  if (!bound.agentId) {
    return bound.state;
  }

  return updateAgent(bound.state, bound.agentId, (agent) => ({
    ...agent,
    lastSeenAt: eventTime(event),
    status: activeStatus(agent.status)
  }));
}

function bindConversationIfNeeded(
  state: WorkflowState,
  event: LogEvent
): { state: WorkflowState; agentId?: string } {
  const conversationId = event.fields.conversation_id;

  if (!conversationId) {
    return { state };
  }

  const bindingKey = event.fields.generation_id
    ? `${conversationId}:${event.fields.generation_id}`
    : conversationId;
  const existingAgentId = state.conversationToAgentId[bindingKey];

  if (existingAgentId) {
    return { state, agentId: existingAgentId };
  }

  const nextAgentId = state.unboundAgentIds.find((agentId) => state.agents[agentId]);

  if (!nextAgentId) {
    return { state, agentId: state.conversationLatestAgentId[conversationId] };
  }

  return {
    state: {
      ...state,
      conversationToAgentId: {
        ...state.conversationToAgentId,
        [bindingKey]: nextAgentId
      },
      conversationLatestAgentId: {
        ...state.conversationLatestAgentId,
        [conversationId]: nextAgentId
      },
      unboundAgentIds: state.unboundAgentIds.filter((agentId) => agentId !== nextAgentId)
    },
    agentId: nextAgentId
  };
}

function findSubagentStartTarget(state: WorkflowState, event: LogEvent): string | undefined {
  const subagentId = event.fields.subagent_id;

  if (subagentId && state.agents[subagentId]) {
    return subagentId;
  }

  const directId = event.fields.tool_use_id ?? event.fields.parent_tool_use_id;

  if (directId && state.agents[directId]) {
    return directId;
  }

  if (subagentId) {
    const matchingAgent = Object.values(state.agents).find((agent) => agent.subagentId === subagentId);

    if (matchingAgent) {
      return matchingAgent.id;
    }
  }

  const subagentType = event.fields.subagent_type ?? event.fields.agent_type;
  const matchingIncomingAgent = Object.values(state.agents).find(
    (agent) => agent.status === "incoming" && (!subagentType || agent.type === subagentType)
  );

  return matchingIncomingAgent?.id;
}

function updateAgent(
  state: WorkflowState,
  agentId: string,
  updater: (agent: AgentNode) => AgentNode
): WorkflowState {
  const agent = state.agents[agentId];

  if (!agent) {
    return state;
  }

  return {
    ...state,
    agents: {
      ...state.agents,
      [agentId]: updater(agent)
    }
  };
}

function activeStatus(status: AgentStatus): AgentStatus {
  if (status === "completed" || status === "failed") {
    return status;
  }

  return "running";
}

function doneStatus(status: AgentStatus, activeTools: Record<string, string>): AgentStatus {
  if (status === "completed" || status === "failed") {
    return status;
  }

  return Object.keys(activeTools).length > 0 ? "running" : "idle";
}

function sessionEndStatus(agent: AgentNode, finalStatus: string | undefined): AgentStatus {
  if (finalStatus === "completed") {
    return "completed";
  }

  if (finalStatus === "aborted" || finalStatus === "unknown") {
    return "failed";
  }

  if (finalStatus === "generating") {
    return agent.status === "idle" ? "idle" : activeStatus(agent.status);
  }

  return agent.status;
}

function chipValue(event: LogEvent, key: "skills" | "rules" | "decisions"): string | undefined {
  if (key === "skills") {
    return event.fields.skill ?? basename(event.fields.path);
  }

  if (key === "rules") {
    return event.fields.rule ?? basename(event.fields.path);
  }

  return event.fields.decision ?? event.fields.decisions ?? basename(event.fields.path);
}

function formatLastAction(event: LogEvent): string | undefined {
  const toolName = event.fields.tool_name;

  if (!toolName) {
    return undefined;
  }

  const pathValue = firstValue(
    event.fields.input_file_path,
    event.fields.file_path,
    event.fields.input_path,
    event.fields.path
  );
  const detail = pathValue
    ? basename(pathValue)
    : firstValue(
      event.fields.input_pattern,
      event.fields.pattern,
      event.fields.input_command,
      event.fields.command
    );

  return detail ? `${toolName} ${detail}` : toolName;
}

function firstValue(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.length > 0);
}

function appendUnique(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value];
}

function removeKey(record: Record<string, string>, key: string | undefined): Record<string, string> {
  if (!key || !(key in record)) {
    return record;
  }

  const { [key]: _removed, ...rest } = record;
  return rest;
}

function eventIndicatesFailure(event: LogEvent): boolean {
  return event.fields.ok === "false" || includesFailure(event.eventType) || includesFailure(event.fields.hook_event_name);
}

function includesFailure(value: string | undefined): boolean {
  return value?.toLowerCase().includes("fail") ?? false;
}

function toolErrorMessage(event: LogEvent): string {
  return event.fields.error_message
    ?? event.fields.failure_type
    ?? `${event.fields.tool_name ?? "Tool"} failed`;
}

function eventTime(event: LogEvent): number {
  return Date.parse(event.timestamp);
}

function humanizeLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function basename(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const parts = value.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.at(-1) ?? value;
}
