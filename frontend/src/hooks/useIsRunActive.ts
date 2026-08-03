import { useEffect, useState } from "react";
import { getEvaluationRun, getLatestEvaluationRun } from "@/api/governanceApi";
import { useAppStore } from "@/store/useAppStore";
import { useSelectionStore } from "@/store/useSelectionStore";
import { isTerminalRunStatus } from "@/lib/runStatus";

/** The real, backend-polled "is a governance run currently active" signal — shared by
 * the header's run indicator and the Live Runs sidebar so both reflect the same state,
 * regardless of which component (or browser tab) actually started the run. */
export function useIsRunActive(): { active: boolean; activeRunId: string | null } {
  const [active, setActive] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const selectedRunId = useSelectionStore((s) => s.selectedRunId);
  const runSelectionCleared = useSelectionStore((s) => s.runSelectionCleared);
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
      // Reset cleared the run selection — there is nothing being watched, so
      // don't fall back to the latest run. Otherwise the sidebar keeps offering
      // "Pause Audit" for a run the canvas no longer shows.
      if (runSelectionCleared) {
        setActive(false);
        setActiveRunId(null);
        return;
      }
      try {
        const run = selectedRunId
          ? await getEvaluationRun(selectedRunId)
          : await getLatestEvaluationRun();
        if (!cancelled && run) {
          const isActive = !isTerminalRunStatus(run.status);
          setActive(isActive);
          setActiveRunId(isActive ? (run.id ?? null) : null);
        }
      } catch {
        // A 404/error (e.g. a deleted/invalid selected run) means there's no
        // active run to report — never leave the indicator stuck "active".
        if (!cancelled) {
          setActive(false);
          setActiveRunId(null);
        }
      }
    }
    check();
    const id = setInterval(check, 4000);
    return () => { cancelled = true; clearInterval(id); };
  }, [selectedRunId, runSelectionCleared]);

  return { active, activeRunId };
}
