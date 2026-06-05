import { describe, expect, test } from "vitest";
import { parseLogLine } from "./parseLogLine";

describe("parseLogLine", () => {
  test("parses basic tool_start fields", () => {
    const line =
      '2026-06-04T01:38:44.985Z | tool_start | conversation_id=ee826 generation_id=eda hook_event_name=preToolUse tool_name=Task tool_use_id=tool_123 input_subagent_type=orchestrator input_description="Feature: consent radio buttons"';

    expect(parseLogLine(line, 7)).toEqual({
      lineNumber: 7,
      timestamp: "2026-06-04T01:38:44.985Z",
      eventType: "tool_start",
      fields: {
        conversation_id: "ee826",
        generation_id: "eda",
        hook_event_name: "preToolUse",
        tool_name: "Task",
        tool_use_id: "tool_123",
        input_subagent_type: "orchestrator",
        input_description: "Feature: consent radio buttons"
      },
      raw: line
    });
  });

  test("parses quoted values like agent_label", () => {
    const line =
      '2026-06-04T01:40:00.000Z | agent_update | conversation_id=abc agent_label="Senior Pattern Architect"';

    expect(parseLogLine(line, 12)?.fields.agent_label).toBe("Senior Pattern Architect");
  });

  test("parses Windows paths without breaking on drive separators", () => {
    const line = String.raw`2026-06-04T01:52:04.603Z | skill_read | conversation_id=e6b6 generation_id=73fb path=C:\Users\FurkanKayn\.cursor\plugins\local\frontend-developer-plugin\skills\domains\vitest-testing\SKILL.md skill=vitest-testing`;

    expect(parseLogLine(line, 18)?.fields).toEqual({
      conversation_id: "e6b6",
      generation_id: "73fb",
      path: String.raw`C:\Users\FurkanKayn\.cursor\plugins\local\frontend-developer-plugin\skills\domains\vitest-testing\SKILL.md`,
      skill: "vitest-testing"
    });
  });

  test("parses quoted error_message correctly", () => {
    const line = String.raw`2026-06-04T01:47:11.198Z | tool_done | conversation_id=144 generation_id=854 hook_event_name=postToolUseFailure tool_name=Read tool_use_id=tool_7 duration_ms=1.219 ok=false failure_type=error error_message="File not found: c:\\DEVEL\\workspace\\file.md"`;

    expect(parseLogLine(line, 21)?.fields.error_message).toBe(
      String.raw`File not found: c:\\DEVEL\\workspace\\file.md`
    );
  });

  test("parses escaped quotes inside quoted shell commands", () => {
    const line = String.raw`2026-06-04T02:10:00.000Z | tool_start | conversation_id=shell generation_id=abc tool_name=Shell input_command="cd \"c:\\DEVEL\\workspace\\app\" && echo inner_key=inside && npx tsc --noEmit 2>&1" model=composer-2.5`;
    const parsed = parseLogLine(line, 31);

    expect(parsed?.fields.input_command).toBe(
      String.raw`cd "c:\\DEVEL\\workspace\\app" && echo inner_key=inside && npx tsc --noEmit 2>&1`
    );
    expect(parsed?.fields.inner_key).toBeUndefined();
    expect(parsed?.fields.model).toBe("composer-2.5");
  });

  test("returns null for malformed lines", () => {
    expect(parseLogLine("not an activity log line", 1)).toBeNull();
  });
});
