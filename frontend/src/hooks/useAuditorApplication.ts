import { useCallback, useEffect, useState } from "react";
import {
  getFrameworkMap,
  getGovernanceReport,
  listAISystems,
  listEvaluationRuns,
  type BackendAISystem,
  type EvaluationRun,
  type FrameworkComplianceMap,
  type GovernanceReport,
} from "@/api/governanceApi";

/**
 * Read-only assurance detail for a single application (AI system).
 *
 * The backend has no "current report per application" endpoint, so we resolve
 * it client-side. IMPORTANT: a run is treated as "assessed" once it carries a
 * VERDICT (+ metric results), regardless of its status label. Real runs reach a
 * verdict during council deliberation but currently hang at `council_running`
 * before flipping to `report_ready` (a known backend issue), so keying off
 * `report_ready` alone would show a stale older run. Keying off the verdict
 * surfaces the same current assessment the developer side sees.
 */

const IN_FLIGHT = new Set([
  "created",
  "context_assembly",
  "planned",
  "metrics_running",
  "agents_running",
  "council_running",
]);

export type AuditorApplication = {
  loading: boolean;
  error: string | null;
  system: BackendAISystem | null;
  /** Most recent run for this application, whatever its status. */
  latestRun: EvaluationRun | null;
  /** Most recent run that produced a report (drives the assessment view). */
  assessedRun: EvaluationRun | null;
  report: GovernanceReport | null;
  frameworkMap: FrameworkComplianceMap | null;
  hasReport: boolean;
  runInFlight: boolean;
  /** No run has ever been executed for this application. */
  notAssessed: boolean;
  refresh: () => void;
};

const EMPTY: Omit<AuditorApplication, "refresh"> = {
  loading: true,
  error: null,
  system: null,
  latestRun: null,
  assessedRun: null,
  report: null,
  frameworkMap: null,
  hasReport: false,
  runInFlight: false,
  notAssessed: false,
};

export function useAuditorApplication(appId: string | null): AuditorApplication {
  const [data, setData] = useState<Omit<AuditorApplication, "refresh">>(EMPTY);
  const [token, setToken] = useState(0);
  const refresh = useCallback(() => setToken((v) => v + 1), []);

  useEffect(() => {
    if (!appId) {
      setData({ ...EMPTY, loading: false });
      return;
    }
    let cancelled = false;
    setData((c) => ({ ...c, loading: true, error: null }));

    (async () => {
      try {
        const [systems, runs] = await Promise.all([
          listAISystems().catch(() => [] as BackendAISystem[]),
          listEvaluationRuns(50),
        ]);
        if (cancelled) return;

        const runsForApp = runs
          .filter((r) => r.ai_system_id === appId)
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        const latestRun = runsForApp[0] ?? null;

        // Resolve the assessed run: fetch every run's report in parallel and pick
        // the newest that carries a verdict + metric results. A fixed "probe the
        // newest N" window breaks the moment interrupted runs pile up newer than
        // the last good run — they get reconciled to `failed` and never produce a
        // verdict, pushing the real assessment out of the window (Compliance then
        // reads "Not assessed" while the portfolio home shows real results). The
        // run list is already capped at 50 by listEvaluationRuns, so this is bounded.
        let assessedRun: EvaluationRun | null = null;
        let report: GovernanceReport | null = null;
        const reports = await Promise.all(
          runsForApp.map((run) => getGovernanceReport(run.id).catch(() => null)),
        );
        if (cancelled) return;
        for (let i = 0; i < runsForApp.length; i++) {
          const r = reports[i];
          if (r?.verdict && r.metric_results.length > 0) {
            assessedRun = runsForApp[i];
            report = r;
            break;
          }
        }

        const frameworkMap = assessedRun
          ? await getFrameworkMap(assessedRun.id).catch(() => null)
          : null;
        if (cancelled) return;

        const system = systems.find((s) => s.id === appId) ?? report?.ai_system ?? null;

        setData({
          loading: false,
          error: null,
          system,
          latestRun,
          assessedRun,
          report,
          frameworkMap,
          hasReport: Boolean(report),
          runInFlight: Boolean(latestRun && IN_FLIGHT.has(latestRun.status)),
          notAssessed: runsForApp.length === 0,
        });
      } catch (error) {
        if (!cancelled) {
          setData({
            ...EMPTY,
            loading: false,
            error: error instanceof Error ? error.message : "Could not load application.",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [appId, token]);

  return { ...data, refresh };
}
