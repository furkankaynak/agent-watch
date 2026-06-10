import { mkdir, stat, writeFile } from "node:fs/promises";
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

  try {
    await stat(hooksJsonPath);
    return false;
  } catch {
    // hooks.json doesn't exist — create with reference to the plugin's ingest script
  }

  const ingestScript = join(agentsWatchRoot, "cursor-plugin", "hooks", "ingest.cjs");
  const usePlugin = await stat(ingestScript).then(() => true, () => false);
  const fallback = join(agentsWatchRoot, "hooks", "generic-hook.js");
  const command = `node ${usePlugin ? ingestScript : fallback}`;

  const hooks = Object.fromEntries(
    HOOK_EVENTS.map((name) => [name, [{ command }]])
  );

  await mkdir(join(projectRoot, ".cursor"), { recursive: true });
  await writeFile(hooksJsonPath, JSON.stringify({ version: 1, hooks }, null, 2) + "\n", "utf8");

  console.log(`[setupHooks] Created ${hooksJsonPath} → ${command}`);
  return true;
}
