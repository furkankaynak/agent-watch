#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

// ── constants ──

const HOOK_TO_EVENT_TYPE = {
  sessionStart: 'session_start',
  sessionEnd: 'session_end',
  preToolUse: 'tool_start',
  postToolUse: 'tool_done',
  postToolUseFailure: 'tool_done',
  subagentStart: 'subagent_start',
  subagentStop: 'subagent_stop',
  beforeShellExecution: 'shell_start',
  afterShellExecution: 'shell_done',
  beforeMCPExecution: 'mcp_start',
  afterMCPExecution: 'mcp_done',
  beforeReadFile: 'file_read',
  afterFileEdit: 'file_edit',
  beforeSubmitPrompt: 'prompt_submit',
  preCompact: 'context_compact',
  stop: 'agent_stop',
  afterAgentResponse: 'agent_response',
  afterAgentThought: 'agent_thought',
  beforeTabFileRead: 'tab_file_read',
  afterTabFileEdit: 'tab_file_edit',
  workspaceOpen: 'workspace_open',
};

const PERMISSION_HOOKS = new Set([
  'preToolUse',
  'subagentStart',
  'beforeShellExecution',
  'beforeMCPExecution',
  'beforeReadFile',
  'beforeTabFileRead',
  'beforeSubmitPrompt',
]);

const ALLOW = { permission: 'allow' };

const pluginRoot = path.dirname(path.dirname(__filename));
const INGEST_PORT = Number(process.env.AGENTS_WATCH_PORT || 4318);

// ── helpers ──

function truncate(str, n) {
  if (!str || typeof str !== 'string') return str;
  return str.length <= n ? str : str.slice(0, n) + '...[truncated]';
}

function normalizeDuration(payload) {
  if (typeof payload.duration_ms === 'number') return payload.duration_ms;
  if (typeof payload.duration === 'number') return payload.duration;
  return null;
}

function humanizeLabel(value) {
  if (!value) return null;
  return value
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const SUBAGENT_CATEGORIES = {
  generalPurpose: 'general',
  explore: 'explore',
  shell: 'shell',
  code: 'code',
  chat: 'chat',
  edit: 'edit',
};

function classifySubagentType(type) {
  return SUBAGENT_CATEGORIES[type] || 'other';
}

function resolveAgentLabel(type) {
  if (!type) return null;
  return humanizeLabel(type);
}

function summarizeToolInput(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return null;
  if (toolName === 'Shell' && toolInput.command) return truncate(toolInput.command, 120);
  if (toolName === 'Read' && toolInput.file_path) return truncate(toolInput.file_path, 120);
  if (toolName === 'Write' && toolInput.file_path) return truncate(toolInput.file_path, 120);
  if (toolName === 'Grep') return toolInput.pattern || toolInput.include || null;
  if (toolName === 'Task') return toolInput.description || toolInput.task || truncate(toolInput.command, 120) || null;
  if (toolName && toolName.startsWith('MCP:')) return toolName;
  for (const v of Object.values(toolInput)) {
    if (typeof v === 'string' && v.length > 0 && v.length < 200) return truncate(v, 120);
  }
  return null;
}

function extractAppName(payload) {
  if (Array.isArray(payload.workspace_roots) && payload.workspace_roots.length > 0) {
    return path.basename(payload.workspace_roots[0]);
  }
  return null;
}

function commonFields(payload) {
  return {
    hook_event_name: payload.hook_event_name || null,
    conversation_id: payload.conversation_id || null,
    generation_id: payload.generation_id || null,
    model: payload.model || null,
    cursor_version: payload.cursor_version || null,
    user_email: payload.user_email || null,
    transcript_path: payload.transcript_path || null,
    workspace_roots: Array.isArray(payload.workspace_roots) ? JSON.stringify(payload.workspace_roots) : null,
  };
}

// ── buffer & tcp ──

function getBufferFile(eventBody) {
  const raw = eventBody?.fields?.workspace_roots;
  if (raw) {
    try {
      const roots = JSON.parse(raw);
      if (Array.isArray(roots) && roots.length > 0) {
        const dir = path.join(roots[0], '.cursor', '.runtime');
        try { fs.mkdirSync(dir, { recursive: true }); } catch {}
        return path.join(dir, 'agents-watch-buffer.jsonl');
      }
    } catch {}
  }
  return path.join(pluginRoot, '.buffer.jsonl');
}

function appendToBuffer(file, line) {
  try { fs.appendFileSync(file, line + '\n', 'utf8'); } catch {}
}

function flushBufferToServer(file) {
  try {
    if (!fs.existsSync(file)) return;
    const socket = net.connect({ host: '127.0.0.1', port: INGEST_PORT }, () => {
      const data = fs.readFileSync(file, 'utf8');
      try { fs.rmSync(file); } catch {}
      if (data) socket.write(data);
      socket.end();
    });
    socket.on('error', (err) => {
      console.error('[agents-watch] TCP flush to 127.0.0.1:' + INGEST_PORT + ' failed:', err.message);
    });
    socket.setTimeout(3000, () => socket.destroy());
  } catch {}
}

// ── send ──

function sendEvent(appName, eventBody) {
  const line = JSON.stringify({
    appName,
    event: eventBody,
  });
  const bufferFile = getBufferFile(eventBody);
  const hadPending = fs.existsSync(bufferFile) && fs.statSync(bufferFile).size > 0;
  appendToBuffer(bufferFile, line);
  flushBufferToServer(bufferFile);
  if (hadPending && fs.existsSync(bufferFile) && fs.statSync(bufferFile).size > 0) {
    console.error('[agents-watch] Buffer not flushed — server at 127.0.0.1:' + INGEST_PORT + ' may be down');
  }
}

// ── handlers ──

function handleSessionStart(payload) {
  const appName = extractAppName(payload);
  const ts = new Date().toISOString();
  const fields = {
    ...commonFields(payload),
    timestamp: ts,
    workspace_root: appName,
    session_id: payload.session_id || payload.conversation_id || null,
    composer_mode: payload.composer_mode || null,
    is_background_agent: Boolean(payload.is_background_agent),
  };
  sendEvent(appName, {
    lineNumber: 0, timestamp: ts, eventType: 'session_start',
    fields, raw: JSON.stringify(payload),
    conversation_id: payload.conversation_id || null,
  });
  return {};
}

function handleSessionEnd(payload) {
  const appName = extractAppName(payload);
  const ts = new Date().toISOString();
  const fields = {
    ...commonFields(payload),
    timestamp: ts,
    workspace_root: appName,
    session_id: payload.session_id || payload.conversation_id || null,
    reason: payload.reason || null,
    duration_ms: normalizeDuration(payload),
    is_background_agent: Boolean(payload.is_background_agent),
    final_status: payload.final_status || null,
  };
  sendEvent(appName, {
    lineNumber: 0, timestamp: ts, eventType: 'session_end',
    fields, raw: JSON.stringify(payload),
    conversation_id: payload.conversation_id || null,
  });
  return {};
}

function handlePreToolUse(payload) {
  const appName = extractAppName(payload);
  const ts = new Date().toISOString();
  const toolInput = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
  const fields = {
    ...commonFields(payload),
    timestamp: ts,
    workspace_root: appName,
    tool_name: payload.tool_name || null,
    tool_use_id: payload.tool_use_id || null,
    agent_message: payload.agent_message || null,
    cwd: payload.cwd || null,
    input_summary: summarizeToolInput(payload.tool_name, toolInput),
    input_subagent_type: toolInput.subagent_type || toolInput.type || null,
    input_description: toolInput.description || toolInput.task || null,
  };
  sendEvent(appName, {
    lineNumber: 0, timestamp: ts, eventType: 'tool_start',
    fields, raw: JSON.stringify(payload),
    conversation_id: payload.conversation_id || null,
  });
  return ALLOW;
}

function handlePostToolUse(payload) {
  const appName = extractAppName(payload);
  const ts = new Date().toISOString();
  const fields = {
    ...commonFields(payload),
    timestamp: ts,
    workspace_root: appName,
    tool_name: payload.tool_name || null,
    tool_use_id: payload.tool_use_id || null,
    cwd: payload.cwd || null,
    duration_ms: normalizeDuration(payload),
    ok: 'true',
  };
  sendEvent(appName, {
    lineNumber: 0, timestamp: ts, eventType: 'tool_done',
    fields, raw: JSON.stringify(payload),
    conversation_id: payload.conversation_id || null,
  });
  return {};
}

function handlePostToolUseFailure(payload) {
  const appName = extractAppName(payload);
  const ts = new Date().toISOString();
  const fields = {
    ...commonFields(payload),
    timestamp: ts,
    workspace_root: appName,
    tool_name: payload.tool_name || null,
    tool_use_id: payload.tool_use_id || null,
    cwd: payload.cwd || null,
    duration_ms: normalizeDuration(payload),
    ok: 'false',
    failure_type: payload.failure_type || null,
    error_message: payload.error_message || null,
    is_interrupt: Boolean(payload.is_interrupt),
  };
  sendEvent(appName, {
    lineNumber: 0, timestamp: ts, eventType: 'tool_done',
    fields, raw: JSON.stringify(payload),
    conversation_id: payload.conversation_id || null,
  });
  return {};
}

function handleSubagentStart(payload) {
  const appName = extractAppName(payload);
  const ts = new Date().toISOString();
  const subagentType = payload.subagent_type || '';
  const fields = {
    ...commonFields(payload),
    timestamp: ts,
    workspace_root: appName,
    subagent_id: payload.subagent_id || null,
    subagent_type: subagentType || null,
    agent_label: resolveAgentLabel(subagentType),
    category: classifySubagentType(subagentType),
    task: payload.task || null,
    parent_conversation_id: payload.parent_conversation_id || null,
    tool_call_id: payload.tool_call_id || null,
    subagent_model: payload.subagent_model || null,
    is_parallel_worker: Boolean(payload.is_parallel_worker),
    git_branch: payload.git_branch || null,
  };
  sendEvent(appName, {
    lineNumber: 0, timestamp: ts, eventType: 'subagent_start',
    fields, raw: JSON.stringify(payload),
    conversation_id: payload.conversation_id || null,
  });
  return ALLOW;
}

function handleSubagentStop(payload) {
  const appName = extractAppName(payload);
  const ts = new Date().toISOString();
  const modified = Array.isArray(payload.modified_files) ? payload.modified_files : [];
  const subagentType = payload.subagent_type || '';
  const fields = {
    ...commonFields(payload),
    timestamp: ts,
    workspace_root: appName,
    subagent_type: subagentType || null,
    agent_label: resolveAgentLabel(subagentType),
    category: classifySubagentType(subagentType),
    status: payload.status || null,
    duration_ms: normalizeDuration(payload),
    task: payload.task || null,
    description: payload.description || null,
    summary: payload.summary || null,
    message_count: typeof payload.message_count === 'number' ? payload.message_count : null,
    tool_call_count: typeof payload.tool_call_count === 'number' ? payload.tool_call_count : null,
    loop_count: typeof payload.loop_count === 'number' ? payload.loop_count : null,
    files_changed: modified.length,
    agent_transcript_path: payload.agent_transcript_path || null,
  };
  sendEvent(appName, {
    lineNumber: 0, timestamp: ts, eventType: 'subagent_stop',
    fields, raw: JSON.stringify(payload),
    conversation_id: payload.conversation_id || null,
  });
  return {};
}

function handleBeforeShellExecution(payload) {
  const appName = extractAppName(payload);
  const ts = new Date().toISOString();
  const fields = {
    ...commonFields(payload),
    timestamp: ts,
    workspace_root: appName,
    command_summary: truncate(payload.command || '', 120),
    cwd: payload.cwd || null,
    sandbox: Boolean(payload.sandbox),
  };
  sendEvent(appName, {
    lineNumber: 0, timestamp: ts, eventType: 'shell_start',
    fields, raw: JSON.stringify(payload),
    conversation_id: payload.conversation_id || null,
  });
  return ALLOW;
}

function handleAfterShellExecution(payload) {
  const appName = extractAppName(payload);
  const ts = new Date().toISOString();
  const exitCode = typeof payload.exit_code === 'number' ? payload.exit_code
    : typeof payload.exitCode === 'number' ? payload.exitCode
    : null;
  const fields = {
    ...commonFields(payload),
    timestamp: ts,
    workspace_root: appName,
    command_summary: truncate(payload.command || '', 120),
    duration_ms: normalizeDuration(payload),
    sandbox: Boolean(payload.sandbox),
    exit_code: exitCode,
    exit_hint: exitCode === null ? null : exitCode === 0 ? 'ok' : `exit_${exitCode}`,
  };
  sendEvent(appName, {
    lineNumber: 0, timestamp: ts, eventType: 'shell_done',
    fields, raw: JSON.stringify(payload),
    conversation_id: payload.conversation_id || null,
  });
  return {};
}

function handleBeforeMCPExecution(payload) {
  const appName = extractAppName(payload);
  const ts = new Date().toISOString();
  const fields = {
    ...commonFields(payload),
    timestamp: ts,
    workspace_root: appName,
    tool_name: payload.tool_name || null,
    mcp_source: payload.url || payload.command || null,
  };
  sendEvent(appName, {
    lineNumber: 0, timestamp: ts, eventType: 'mcp_start',
    fields, raw: JSON.stringify(payload),
    conversation_id: payload.conversation_id || null,
  });
  return ALLOW;
}

function handleAfterMCPExecution(payload) {
  const appName = extractAppName(payload);
  const ts = new Date().toISOString();
  const fields = {
    ...commonFields(payload),
    timestamp: ts,
    workspace_root: appName,
    tool_name: payload.tool_name || null,
    duration_ms: normalizeDuration(payload),
  };
  sendEvent(appName, {
    lineNumber: 0, timestamp: ts, eventType: 'mcp_done',
    fields, raw: JSON.stringify(payload),
    conversation_id: payload.conversation_id || null,
  });
  return {};
}

function handleBeforeReadFile(payload) {
  const appName = extractAppName(payload);
  const ts = new Date().toISOString();
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];

  const rules = attachments
    .filter(a => a.type === 'rule')
    .map(a => path.basename((a.file_path || '').replace(/\.mdc$/, '')));
  const skillFromAtt = attachments
    .filter(a => a.type === 'file' && (a.file_path || '').includes('/skills/'))
    .map(a => path.basename(path.dirname(a.file_path || '')));
  const isSkillFile = (payload.file_path || '').includes('/skills/') || (payload.file_path || '').endsWith('SKILL.md');
  const skillFromPath = isSkillFile ? [path.basename(path.dirname(payload.file_path || ''))] : [];
  const skills = [...new Set([...skillFromAtt, ...skillFromPath])];

  const fields = {
    ...commonFields(payload),
    timestamp: ts,
    workspace_root: appName,
    file_path: payload.file_path || null,
    attachment_count: attachments.length,
    attachment_rules: rules.length > 0 ? JSON.stringify(rules) : null,
    attachment_skills: skills.length > 0 ? JSON.stringify(skills) : null,
  };
  sendEvent(appName, {
    lineNumber: 0, timestamp: ts, eventType: 'file_read',
    fields, raw: JSON.stringify(payload),
    conversation_id: payload.conversation_id || null,
  });
  return ALLOW;
}

function handleAfterFileEdit(payload) {
  const appName = extractAppName(payload);
  const ts = new Date().toISOString();
  const edits = Array.isArray(payload.edits) ? payload.edits : [];
  const fields = {
    ...commonFields(payload),
    timestamp: ts,
    workspace_root: appName,
    file_path: payload.file_path || null,
    edit_count: edits.length,
  };
  sendEvent(appName, {
    lineNumber: 0, timestamp: ts, eventType: 'file_edit',
    fields, raw: JSON.stringify(payload),
    conversation_id: payload.conversation_id || null,
  });
  return {};
}

function handleBeforeSubmitPrompt(payload) {
  const appName = extractAppName(payload);
  const ts = new Date().toISOString();
  const fields = {
    ...commonFields(payload),
    timestamp: ts,
    workspace_root: appName,
    prompt_submit: true,
  };
  sendEvent(appName, {
    lineNumber: 0, timestamp: ts, eventType: 'prompt_submit',
    fields, raw: JSON.stringify(payload),
    conversation_id: payload.conversation_id || null,
  });
  return ALLOW;
}

function handlePreCompact(payload) {
  const appName = extractAppName(payload);
  const ts = new Date().toISOString();
  const fields = {
    ...commonFields(payload),
    timestamp: ts,
    workspace_root: appName,
  };
  sendEvent(appName, {
    lineNumber: 0, timestamp: ts, eventType: 'context_compact',
    fields, raw: JSON.stringify(payload),
    conversation_id: payload.conversation_id || null,
  });
  return {};
}

function handleStop(payload) {
  const appName = extractAppName(payload);
  const ts = new Date().toISOString();
  const fields = {
    ...commonFields(payload),
    timestamp: ts,
    workspace_root: appName,
    status: payload.status || null,
    loop_count: typeof payload.loop_count === 'number' ? payload.loop_count : null,
  };
  sendEvent(appName, {
    lineNumber: 0, timestamp: ts, eventType: 'agent_stop',
    fields, raw: JSON.stringify(payload),
    conversation_id: payload.conversation_id || null,
  });
  return {};
}

function handleAfterAgentResponse(payload) {
  const appName = extractAppName(payload);
  const ts = new Date().toISOString();
  const fields = {
    ...commonFields(payload),
    timestamp: ts,
    workspace_root: appName,
  };
  sendEvent(appName, {
    lineNumber: 0, timestamp: ts, eventType: 'agent_response',
    fields, raw: JSON.stringify(payload),
    conversation_id: payload.conversation_id || null,
  });
  return {};
}

function handleAfterAgentThought(payload) {
  const appName = extractAppName(payload);
  const ts = new Date().toISOString();
  const fields = {
    ...commonFields(payload),
    timestamp: ts,
    workspace_root: appName,
  };
  sendEvent(appName, {
    lineNumber: 0, timestamp: ts, eventType: 'agent_thought',
    fields, raw: JSON.stringify(payload),
    conversation_id: payload.conversation_id || null,
  });
  return {};
}

function handleBeforeTabFileRead(payload) {
  const appName = extractAppName(payload);
  const ts = new Date().toISOString();
  const fields = {
    ...commonFields(payload),
    timestamp: ts,
    workspace_root: appName,
    file_path: payload.file_path || null,
  };
  sendEvent(appName, {
    lineNumber: 0, timestamp: ts, eventType: 'tab_file_read',
    fields, raw: JSON.stringify(payload),
    conversation_id: payload.conversation_id || null,
  });
  return ALLOW;
}

function handleAfterTabFileEdit(payload) {
  const appName = extractAppName(payload);
  const ts = new Date().toISOString();
  const edits = Array.isArray(payload.edits) ? payload.edits : [];
  const fields = {
    ...commonFields(payload),
    timestamp: ts,
    workspace_root: appName,
    file_path: payload.file_path || null,
    edit_count: edits.length,
  };
  sendEvent(appName, {
    lineNumber: 0, timestamp: ts, eventType: 'tab_file_edit',
    fields, raw: JSON.stringify(payload),
    conversation_id: payload.conversation_id || null,
  });
  return {};
}

function handleWorkspaceOpen(payload) {
  const appName = extractAppName(payload);
  const ts = new Date().toISOString();
  const fields = {
    hook_event_name: payload.hook_event_name || null,
    cursor_version: payload.cursor_version || null,
    user_email: payload.user_email || null,
    workspace_roots: Array.isArray(payload.workspace_roots) ? JSON.stringify(payload.workspace_roots) : null,
    timestamp: ts,
    workspace_root: appName,
  };
  sendEvent(appName, {
    lineNumber: 0, timestamp: ts, eventType: 'workspace_open',
    fields, raw: JSON.stringify(payload),
    conversation_id: null, // workspaceOpen has no conversation
  });
  return {};
}

function handleGenericHook(payload) {
  const appName = extractAppName(payload);
  const ts = new Date().toISOString();
  const fields = {
    ...commonFields(payload),
    timestamp: ts,
    workspace_root: appName,
  };
  sendEvent(appName, {
    lineNumber: 0, timestamp: ts, eventType: 'hook_event',
    fields, raw: JSON.stringify(payload),
    conversation_id: payload.conversation_id || null,
  });
  // Generic hooks are info-only unless they match permission set
  return PERMISSION_HOOKS.has(payload.hook_event_name) ? ALLOW : {};
}

// ── main ──

function main() {
  let input;
  try {
    if (process.stdin.isTTY) {
      process.stdout.write(JSON.stringify(ALLOW));
      process.exit(0);
    }
    input = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    process.stdout.write(JSON.stringify(ALLOW));
    process.exit(0);
  }
  if (!input) {
    process.stdout.write(JSON.stringify(ALLOW));
    process.exit(0);
  }

  const hookName = input.hook_event_name || '';

  let response;
  switch (hookName) {
    case 'sessionStart':        response = handleSessionStart(input);        break;
    case 'sessionEnd':          response = handleSessionEnd(input);          break;
    case 'preToolUse':          response = handlePreToolUse(input);          break;
    case 'postToolUse':         response = handlePostToolUse(input);         break;
    case 'postToolUseFailure':  response = handlePostToolUseFailure(input);  break;
    case 'subagentStart':       response = handleSubagentStart(input);       break;
    case 'subagentStop':        response = handleSubagentStop(input);        break;
    case 'beforeShellExecution':  response = handleBeforeShellExecution(input);  break;
    case 'afterShellExecution':   response = handleAfterShellExecution(input);   break;
    case 'beforeMCPExecution':    response = handleBeforeMCPExecution(input);    break;
    case 'afterMCPExecution':     response = handleAfterMCPExecution(input);     break;
    case 'beforeReadFile':        response = handleBeforeReadFile(input);        break;
    case 'afterFileEdit':         response = handleAfterFileEdit(input);         break;
    case 'beforeSubmitPrompt':    response = handleBeforeSubmitPrompt(input);    break;
    case 'preCompact':            response = handlePreCompact(input);            break;
    case 'stop':                  response = handleStop(input);                  break;
    case 'afterAgentResponse':    response = handleAfterAgentResponse(input);    break;
    case 'afterAgentThought':     response = handleAfterAgentThought(input);     break;
    case 'beforeTabFileRead':     response = handleBeforeTabFileRead(input);     break;
    case 'afterTabFileEdit':      response = handleAfterTabFileEdit(input);      break;
    case 'workspaceOpen':         response = handleWorkspaceOpen(input);         break;
    default:                      response = handleGenericHook(input);           break;
  }

  process.stdout.write(JSON.stringify(response));

  // small delay for async TCP flush
  setTimeout(() => process.exit(0), 200);
}

main();
