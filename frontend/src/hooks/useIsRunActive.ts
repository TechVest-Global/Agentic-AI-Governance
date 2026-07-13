import { useEffect, useState } from "react";
import { getLatestEvaluationRun } from "@/api/governanceApi";
import { useAppStore } from "@/store/useAppStore";
import { useSelectionStore } from "@/store/useSelectionStore";

const TERMINAL = new Set(["completed", "report_ready", "failed", "cancelled", "canceled"]);

/** The real, backend-polled "is a governance run currently active" signal — shared by
 * the header's run indicator and the Live Runs sidebar so both reflect the same state,
 * regardless of which component (or browser tab) actually started the run. */
export function useIsRunActive(): { active: boolean; activeRunId: string | null } {
  const [active, setActive] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const selectedRunId = useSelectionStore((s) => s.selectedRunId);
  const globalRunnerStatus = useAppStore((s) => s.globalRunnerStatus);

  // Immediately reflect runner hook state. "awaiting" (paused for plan approval)
  // is still an active run — it parks at 'planned' until a reviewer approves.
  useEffect(() => {
    if (globalRunnerStatus === "running" || globalRunnerStatus === "awaiting") setActive(true);
    else if (globalRunnerStatus === "done" || globalRunnerStatus === "error") setActive(false);
  }, [globalRunnerStatus]);

  // Poll backend every 4s to catch runs started in other tabs / after page reload
  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const run = selectedRunId
          ? await fetch(`${import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000/api/v1"}/evaluation-runs/${selectedRunId}`).then(r => r.json())
          : await getLatestEvaluationRun();
        if (!cancelled && run) {
          const isActive = !TERMINAL.has(run.status);
          setActive(isActive);
          setActiveRunId(isActive ? (run.id ?? null) : null);
        }
      } catch { /* ignore */ }
    }
    check();
    const id = setInterval(check, 4000);
    return () => { cancelled = true; clearInterval(id); };
  }, [selectedRunId]);

  return { active, activeRunId };
}
