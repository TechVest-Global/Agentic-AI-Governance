import { useCallback, useEffect, useState } from "react";
import { useSelectionStore } from "@/store/useSelectionStore";
import {
  getAgentExecutions,
  getAuditLedger,
  getEvaluationRun,
  getFindings,
  getFrameworkMap,
  getGovernanceReport,
  getLatestEvaluationRun,
  listGovernanceState,
  runCouncilDeliberation,
  verifyAuditLedger,
  type AgentExecution,
  type AuditLedgerEntry,
  type AuditLedgerVerification,
  type BackendFinding,
  type CouncilDeliberation,
  type EvaluationRun,
  type FrameworkComplianceMap,
  type GovernanceReport,
  type GovernanceStateEntry,
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
  stateEntries: GovernanceStateEntry[];
  ledgerVerification: AuditLedgerVerification | null;
  councilResult: CouncilDeliberation | null;
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
  stateEntries: [],
  ledgerVerification: null,
  councilResult: null,
};

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

        const [report, frameworkMap, agentExecutions, findings, ledgerEntries, stateEntries, ledgerVerification] =
          await Promise.all([
            getGovernanceReport(latestRun.id),
            getFrameworkMap(latestRun.id),
            getAgentExecutions(latestRun.id),
            getFindings(latestRun.id),
            getAuditLedger(latestRun.id),
            listGovernanceState(latestRun.id).catch(() => []),
            verifyAuditLedger(latestRun.id),
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
            stateEntries,
            ledgerVerification,
            councilResult: null,
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
