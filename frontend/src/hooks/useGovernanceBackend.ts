import { useCallback, useEffect, useState } from "react";
import { useSelectionStore } from "@/store/useSelectionStore";
import {
  getAgentExecutions,
  getAuditLedger,
  getContextAssembly,
  getEvaluationPlan,
  getEvaluationRun,
  getExecutionArtifacts,
  getFindings,
  getFrameworkMap,
  getGovernanceReport,
  getLatestEvaluationRun,
  getLlmCalls,
  runCouncilDeliberation,
  verifyAuditLedger,
  type AgentExecution,
  type AuditLedgerEntry,
  type AuditLedgerVerification,
  type BackendFinding,
  type ContextAssemblyRead,
  type CouncilDeliberation,
  type EvaluationPlanRead,
  type EvaluationRun,
  type ExecutionArtifact,
  type FrameworkComplianceMap,
  type GovernanceReport,
  type LlmCall,
} from "@/api/governanceApi";

type BackendState = {
  loading: boolean;
  error: string | null;
  latestRun: EvaluationRun | null;
  report: GovernanceReport | null;
  frameworkMap: FrameworkComplianceMap | null;
  agentExecutions: AgentExecution[];
  findings: BackendFinding[];
  ledgerEntries: AuditLedgerEntry[];
  ledgerVerification: AuditLedgerVerification | null;
  councilResult: CouncilDeliberation | null;
  evaluationPlan: EvaluationPlanRead | null;
  contextAssembly: ContextAssemblyRead | null;
  llmCalls: LlmCall[];
  executionArtifacts: ExecutionArtifact[];
};

const initialState: BackendState = {
  loading: true,
  error: null,
  latestRun: null,
  report: null,
  frameworkMap: null,
  agentExecutions: [],
  findings: [],
  ledgerEntries: [],
  ledgerVerification: null,
  councilResult: null,
  evaluationPlan: null,
  contextAssembly: null,
  llmCalls: [],
  executionArtifacts: [],
};

// A run that has reached one of these states will not change again, so we stop
// polling it. Keep US/UK spellings and the report_ready interim state.
const TERMINAL_RUN_STATUSES = new Set([
  "completed",
  "report_ready",
  "failed",
  "cancelled",
  "canceled",
]);

// While a run is in flight, refresh the REST snapshot on this cadence so tiles
// (findings, agent executions, counts) update even when the SSE stream is
// unavailable — the SSE hook is best-effort, this is the reliable floor.
const POLL_INTERVAL_MS = 4000;

export function useGovernanceBackend() {
  const [state, setState] = useState<BackendState>(initialState);
  const [refreshToken, setRefreshToken] = useState(0);
  // Honor the workspace-wide selected run so every tab stays in sync.
  const selectedRunId = useSelectionStore((s) => s.selectedRunId);

  const refresh = useCallback(() => setRefreshToken((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState((current) => ({ ...current, loading: true, error: null }));
      try {
        let latestRun = null;
        if (selectedRunId) {
          latestRun = await getEvaluationRun(selectedRunId).catch(() => null);
        }
        if (!latestRun) {
          latestRun = await getLatestEvaluationRun();
        }
        if (!latestRun) {
          if (!cancelled) {
            setState({ ...initialState, loading: false, error: "No evaluation runs found." });
          }
          return;
        }

        const [
          report,
          frameworkMap,
          agentExecutions,
          findings,
          ledgerEntries,
          ledgerVerification,
          evaluationPlan,
          contextAssembly,
          llmCallLog,
          executionArtifacts,
        ] = await Promise.all([
          getGovernanceReport(latestRun.id),
          getFrameworkMap(latestRun.id),
          getAgentExecutions(latestRun.id),
          getFindings(latestRun.id),
          getAuditLedger(latestRun.id),
          verifyAuditLedger(latestRun.id),
          getEvaluationPlan(latestRun.id),
          getContextAssembly(latestRun.id),
          getLlmCalls(latestRun.id).catch(() => null),
          getExecutionArtifacts(latestRun.id).catch(() => []),
        ]);

        if (!cancelled) {
          setState({
            loading: false,
            error: null,
            latestRun,
            report,
            frameworkMap,
            agentExecutions,
            findings,
            ledgerEntries,
            ledgerVerification,
            councilResult: null,
            evaluationPlan,
            contextAssembly,
            llmCalls: llmCallLog?.calls ?? [],
            executionArtifacts,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            loading: false,
            error: error instanceof Error ? error.message : "Backend API unavailable.",
          }));
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [refreshToken, selectedRunId]);

  // Poll while the run is in flight so counts stay live even without SSE.
  // Stops automatically once the run reaches a terminal state or errors.
  const runStatus = state.latestRun?.status;
  useEffect(() => {
    if (state.error) return;
    if (runStatus && TERMINAL_RUN_STATUSES.has(runStatus)) return;
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [runStatus, state.error, refresh]);

  const deliberate = useCallback(async () => {
    if (!state.latestRun) return null;
    const result = await runCouncilDeliberation(state.latestRun.id);
    setState((current) => ({ ...current, councilResult: result }));
    refresh();
    return result;
  }, [refresh, state.latestRun]);

  return {
    ...state,
    refresh,
    deliberate,
    usingBackend: Boolean(state.latestRun && !state.error),
  };
}

