export type LogEvent = {
  lineNumber: number;
  timestamp: string;
  eventType: string;
  fields: Record<string, string>;
  raw: string;
};
