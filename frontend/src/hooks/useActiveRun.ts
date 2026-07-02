import { useCallback, useEffect, useState } from "react";
import { listAISystems, listEvaluationRuns, type BackendAISystem, type EvaluationRun } from "@/api/governanceApi";
import { useSelectionStore } from "@/store/useSelectionStore";

export type ActiveRun = {
  /** All runs (newest first), for the run switcher. */
  runs: EvaluationRun[];
  /** System id → name, for labelling runs. */
  systemNameById: Map<string, string>;
  /** The effective run id: the explicitly selected run, or the latest. */
  runId: string | null;
  /** The effective run object. */
  run: EvaluationRun | null;
  loading: boolean;
  error: string | null;
  /** Select a run (null = follow latest). Shared across every tab. */
  setRunId: (id: string | null) => void;
  refresh: () => void;
};

/**
 * The single source of truth for "which run is the workspace looking at".
 * Every run-scoped page calls this so switching the run on one tab carries to
 * all the others. Falls back to the most recent run when nothing is selected.
 */
export function useActiveRun(): ActiveRun {
  const selectedRunId = useSelectionStore((s) => s.selectedRunId);
  const setSelectedRunId = useSelectionStore((s) => s.setSelectedRunId);
  const setSelectedSystemId = useSelectionStore((s) => s.setSelectedSystemId);

  const [runs, setRuns] = useState<EvaluationRun[]>([]);
  const [systems, setSystems] = useState<BackendAISystem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(0);

  const refresh = useCallback(() => setToken((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([listEvaluationRuns(50), listAISystems().catch(() => [] as BackendAISystem[])])
      .then(([runList, systemList]) => {
        if (cancelled) return;
        setRuns(runList);
        setSystems(systemList);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load evaluation runs.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Re-fetch when the workspace selects a different run (e.g. a run just
    // started from the AI registry) so the freshly-created run shows up in the
    // switcher instead of silently falling back to the previous "Latest".
  }, [token, selectedRunId]);

  // If the selected run is gone (or none chosen), fall back to the latest.
  const effectiveRunId =
    (selectedRunId && runs.some((r) => r.id === selectedRunId) ? selectedRunId : null) ?? runs[0]?.id ?? null;
  const run = runs.find((r) => r.id === effectiveRunId) ?? null;

  const systemNameById = new Map(systems.map((s) => [s.id, s.name]));

  const setRunId = useCallback(
    (id: string | null) => {
      setSelectedRunId(id);
      if (id) {
        const target = runs.find((r) => r.id === id);
        if (target) setSelectedSystemId(target.ai_system_id);
      }
    },
    [runs, setSelectedRunId, setSelectedSystemId],
  );

  return { runs, systemNameById, runId: effectiveRunId, run, loading, error, setRunId, refresh };
}
