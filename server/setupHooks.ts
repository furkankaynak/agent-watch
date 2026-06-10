import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK_EVENTS = [
  "sessionStart", "sessionEnd", "preToolUse", "postToolUse",
  "postToolUseFailure", "subagentStart", "subagentStop",
  "beforeShellExecution", "afterShellExecution",
  "beforeMCPExecution", "afterMCPExecution",
  "beforeReadFile", "afterFileEdit",
  "beforeSubmitPrompt", "preCompact", "stop",
  "afterAgentResponse", "afterAgentThought",
  "beforeTabFileRead", "afterTabFileEdit", "workspaceOpen",
];

const agentsWatchRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export async function setupHooks(projectRoot: string): Promise<boolean> {
  const hooksJsonPath = join(projectRoot, ".cursor", "hooks.json");
  const hooksDir = join(projectRoot, ".cursor", "hooks");
  const hookScriptPath = join(hooksDir, "generic-hook.js");

  try {
    await stat(hooksJsonPath);
    return false;
  } catch {
    // hooks.json doesn't exist — create it
  }

  const sourceScript = join(agentsWatchRoot, "hooks", "generic-hook.js");

  await mkdir(hooksDir, { recursive: true });

  try {
    await copyFile(sourceScript, hookScriptPath);
  } catch {
    console.warn("Could not copy hook script to project, referencing agents-watch path instead");
  }

  const hooks = Object.fromEntries(
    HOOK_EVENTS.map((name) => [name, [{ command: `node ${hookScriptPath}` }]])
  );

  const hooksJson = JSON.stringify({ version: 1, hooks }, null, 2) + "\n";

  await writeFile(hooksJsonPath, hooksJson, "utf8");

  console.log(`[setupHooks] Created ${hooksJsonPath} with ${HOOK_EVENTS.length} hooks`);
  return true;
}
