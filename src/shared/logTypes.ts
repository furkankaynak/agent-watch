export type LogEvent = {
  id?: number;
  lineNumber: number;
  timestamp: string;
  eventType: string;
  fields: Record<string, string>;
  raw?: string;
  _hasHeavy?: boolean;
};

export function hookEventName(event: LogEvent): string | undefined {
  return event.fields.hook_event_name;
}

export function isHookEvent(event: LogEvent): boolean {
  return event.eventType === "hook_event";
}
