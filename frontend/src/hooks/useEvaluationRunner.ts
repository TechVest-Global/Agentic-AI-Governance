import { useCallback, useEffect, useRef, useState } from "react";
import {
  createEvaluationRun,
  listMetrics,
  orchestrateRun,
  type BackendAISystem,
  type EvaluationRun,
  type OrchestrationResult,
} from "@/api/governanceApi";

export type RunnerStatus = "idle" | "running" | "done" | "error";

export type EvaluationRunnerState = {
  status: RunnerStatus;
  /** id of the system currently being evaluated (for per-row spinners). */
  runningSystemId: string | null;
  result: OrchestrationResult | null;
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
 * Drives the full evaluation lifecycle for a registered system:
 *   pick metrics for its frameworks -> create run -> orchestrate (metrics,
 *   agents, council, report) -> expose the result. The orchestrate call is
 *   synchronous on the backend, so `status === "running"` covers the whole run.
 */
export function useEvaluationRunner() {
  const [state, setState] = useState<EvaluationRunnerState>(INITIAL);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const setRunnerState = useCallback((next: EvaluationRunnerState) => {
    if (mountedRef.current) {
      setState(next);
    }
  }, []);

  const run = useCallback(async (
    system: BackendAISystem,
    options: EvaluationRunnerOptions = {},
  ): Promise<OrchestrationResult | null> => {
    setRunnerState({ status: "running", runningSystemId: system.id, result: null, error: null });
    try {
      const frameworks = system.selected_frameworks ?? [];
      const metrics = await listMetrics();
      // Metrics whose frameworks intersect the system's selected frameworks.
      const selected = metrics
        .filter((m) => m.framework_ids.some((f) => frameworks.includes(f)))
        .map((m) => m.metric_id);
      // Fall back to a small default spread if the system declared no frameworks.
      const selectedMetrics = selected.length > 0 ? selected : metrics.slice(0, 6).map((m) => m.metric_id);

      const evaluationRun = await createEvaluationRun({
        ai_system_id: system.id,
        selected_frameworks: frameworks,
        selected_metrics: selectedMetrics,
      });
      options.onRunCreated?.(evaluationRun);
      const result = await orchestrateRun(evaluationRun.id);
      setRunnerState({ status: "done", runningSystemId: null, result, error: null });
      return result;
    } catch (error) {
      setRunnerState({
        status: "error",
        runningSystemId: null,
        result: null,
        error: error instanceof Error ? error.message : "Evaluation failed.",
      });
      return null;
    }
  }, [setRunnerState]);

  const reset = useCallback(() => setRunnerState(INITIAL), [setRunnerState]);

  return { ...state, run, reset };
}
