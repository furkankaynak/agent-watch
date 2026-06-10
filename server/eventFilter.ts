const HEAVY_FIELDS = new Set([
  "raw",
  "content",
  "output",
  "tool_output",
  "text",
  "result_json",
  "summary",
  "edits",
  "tool_input_new_str",
  "tool_input_old_str",
]);

export type StrippedEvent = {
  fields: Record<string, string>;
  _hasHeavy: boolean;
};

export function stripHeavyFields(fields: Record<string, string>): StrippedEvent {
  const stripped: Record<string, string> = {};
  let hasHeavy = false;

  for (const key of Object.keys(fields)) {
    if (HEAVY_FIELDS.has(key)) {
      stripped[key] = "[heavy]";
      hasHeavy = true;
    } else {
      stripped[key] = fields[key];
    }
  }

  return { fields: stripped, _hasHeavy: hasHeavy };
}

export function stripRawField(event: Record<string, unknown>): Record<string, unknown> {
  const { raw: _, ...rest } = event;
  return rest;
}
