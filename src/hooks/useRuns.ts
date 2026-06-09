import { useState, useEffect, useCallback } from "react";

export type Run = {
  id: number;
  label: string | null;
  status: "running" | "completed" | "failed";
  started_at: string;
  ended_at: string | null;
};

export function useRuns(): {
  runs: Run[];
  selectedRunId: number | null;
  setSelectedRunId: (id: number | null) => void;
  activeRunId: number | null;
  loading: boolean;
} {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/runs");
      const data: Run[] = await res.json();
      setRuns(data);
      const active = data.find((r) => r.status === "running");
      setSelectedRunId((prev) => prev ?? active?.id ?? data[0]?.id ?? null);
    } catch (err) {
      console.error("Failed to fetch runs", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  useEffect(() => {
    const interval = setInterval(fetchRuns, 5000);
    return () => clearInterval(interval);
  }, [fetchRuns]);

  const activeRunId = runs.find((r) => r.status === "running")?.id ?? null;

  useEffect(() => {
    if (!selectedRunId && activeRunId) {
      setSelectedRunId(activeRunId);
    }
  }, [selectedRunId, activeRunId]);

  return { runs, selectedRunId, setSelectedRunId, activeRunId, loading };
}
