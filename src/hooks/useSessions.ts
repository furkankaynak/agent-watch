import { useState, useEffect, useCallback } from "react";

export type Session = {
  conversation_id: string;
  status: "active" | "ended";
  started_at: string;
  ended_at: string | null;
  model: string | null;
  cursor_version: string | null;
  workspace_roots: string | null;
  run_ids: number[];
};

export function useSessions(): {
  sessions: Session[];
  selectedSessionId: string | null;
  setSelectedSessionId: (id: string | null) => void;
  activeSessionId: string | null;
  loading: boolean;
} {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      const data: Session[] = await res.json();
      setSessions(data);
      const active = data.find((s) => s.status === "active");
      setSelectedSessionId((prev) => prev ?? active?.conversation_id ?? data[0]?.conversation_id ?? null);
    } catch (err) {
      console.error("Failed to fetch sessions", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  const activeSessionId = sessions.find((s) => s.status === "active")?.conversation_id ?? null;

  useEffect(() => {
    if (!selectedSessionId && activeSessionId) {
      setSelectedSessionId(activeSessionId);
    }
  }, [selectedSessionId, activeSessionId]);

  return { sessions, selectedSessionId, setSelectedSessionId, activeSessionId, loading };
}
