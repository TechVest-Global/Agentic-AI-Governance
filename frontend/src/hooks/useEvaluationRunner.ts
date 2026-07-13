import { useCallback, useEffect, useRef, useState } from "react";
import {
  createEvaluationRun,
  isAwaitingApproval,
  orchestrateRun,
  waitForRunCompletion,
  type BackendAISystem,
  type EvaluationRun,
} from "@/api/governanceApi";
import { useAppStore } from "@/store/useAppStore";
import { useSelectionStore } from "@/store/useSelectionStore";

// "awaiting" = the run paused for human metric-plan approval (parked at 'planned').
// It is not done — the reviewer must approve it on the Metric Plan page to resume.
export type RunnerStatus = "idle" | "running" | "awaiting" | "done" | "error";

export type EvaluationRunnerState = {
  status: RunnerStatus;
  runningSystemId: string | null;
  result: EvaluationRun | null;
  error: string | null;
};

type EvaluationRunnerOptions = {
  onRunCreated?: (run: EvaluationRun) => void;
  // Audit scope: capability endpoint_refs to probe. Empty/omitted = whole app.
  selectedCapabilities?: string[];
};

const INITIAL: EvaluationRunnerState = {
  status: "idle",
  runningSystemId: null,
  result: null,
  error: null,
};

/**
 * Drives the full evaluation lifecycle:
 *   pick metrics → create run → fire orchestrate (202) → poll until terminal → expose result.
 */
export function useEvaluationRunner() {
  const [state, setState] = useState<EvaluationRunnerState>(INITIAL);
  const mountedRef = useRef(true);
  const abortRef   = useRef<AbortController | null>(null);
  const setGlobalRunnerStatus = useAppStore((s) => s.setGlobalRunnerStatus);
  const setSelectedRunId      = useSelectionStore((s) => s.setSelectedRunId);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const setRunnerState = useCallback((next: EvaluationRunnerState) => {
    if (mountedRef.current) {
      setState(next);
      setGlobalRunnerStatus(next.status);
    }
  }, [setGlobalRunnerStatus]);

  const run = useCallback(async (
    system: BackendAISystem,
    options: EvaluationRunnerOptions = {},
  ): Promise<EvaluationRun | null> => {
    // Cancel any in-flight poll from a previous run
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setRunnerState({ status: "running", runningSystemId: system.id, result: null, error: null });
    try {
      const frameworks = system.selected_frameworks ?? [];

      // Leave selected_metrics empty so the backend's adaptive orchestrator
      // plans metrics itself — it scopes them to this system's declared
      // capabilities/modality instead of every enabled metric for every
      // framework, so different systems get different metric sets.
      const evaluationRun = await createEvaluationRun({
        ai_system_id: system.id,
        selected_frameworks: frameworks,
        selected_metrics: [],
        selected_capabilities: options.selectedCapabilities ?? [],
      });
      options.onRunCreated?.(evaluationRun);

      // Pin the run in the global selection store so the header poller sees it immediately
      setSelectedRunId(evaluationRun.id);

      // Fire-and-forget: orchestrate returns 202 immediately
      await orchestrateRun(evaluationRun.id);

      // Poll until the run reaches a terminal state OR pauses for plan approval.
      const completedRun = await waitForRunCompletion(
        evaluationRun.id,
        undefined,
        ac.signal,
      );

      // A gated run stops at 'planned' awaiting a reviewer's approval — surface
      // that as its own status so the UI can prompt approval instead of implying
      // the audit finished.
      const status = isAwaitingApproval(completedRun) ? "awaiting" : "done";
      setRunnerState({ status, runningSystemId: null, result: completedRun, error: null });
      return completedRun;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        // Cancelled by the user — leave status as-is (cancelRun handles it externally)
        return null;
      }
      // Orchestration failed after the run was created + pinned. Unpin it so the
      // Live Run view doesn't stay stuck on an orphaned "created" run forever.
      setSelectedRunId(null);
      setRunnerState({
        status: "error",
        runningSystemId: null,
        result: null,
        error: error instanceof Error ? error.message : "Evaluation failed.",
      });
      return null;
    }
  }, [setRunnerState, setSelectedRunId]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setRunnerState(INITIAL);
  }, [setRunnerState]);

  return { ...state, run, reset };
}
