import { useCallback, useEffect, useRef, useState } from "react";
import {
  createEvaluationRun,
  orchestrateRun,
  waitForRunCompletion,
  type BackendAISystem,
  type EvaluationRun,
} from "@/api/governanceApi";
import { useAppStore } from "@/store/useAppStore";
import { useSelectionStore } from "@/store/useSelectionStore";

export type RunnerStatus = "idle" | "running" | "done" | "error";

export type EvaluationRunnerState = {
  status: RunnerStatus;
  runningSystemId: string | null;
  result: EvaluationRun | null;
  error: string | null;
};

type EvaluationRunnerOptions = {
  onRunCreated?: (run: EvaluationRun) => void;
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
      });
      options.onRunCreated?.(evaluationRun);

      // Pin the run in the global selection store so the header poller sees it immediately
      setSelectedRunId(evaluationRun.id);

      // Fire-and-forget: orchestrate returns 202 immediately
      await orchestrateRun(evaluationRun.id);

      // Poll until the run reaches a terminal state
      const completedRun = await waitForRunCompletion(
        evaluationRun.id,
        undefined,
        ac.signal,
      );

      setRunnerState({ status: "done", runningSystemId: null, result: completedRun, error: null });
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
