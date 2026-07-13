import { useCallback, useEffect, useState } from "react";
import {
  getGovernanceReport,
  listAISystems,
  listEvaluationRuns,
  type BackendAISystem,
  type BackendFinding,
  type EvaluationRun,
  type GovernanceReport,
  type Verdict,
} from "@/api/governanceApi";
import { metricOutcome } from "@/pages/auditor/clientComponents";

/**
 * Aggregated, read-only data for the auditor workspace. Everything here is
 * derived from real backend records (AI systems, evaluation runs, and their
 * governance reports) — nothing is fabricated. Where the backend has no
 * concept yet (auditor→system assignments, report sign-off, remediation due
 * dates) the derived value is honestly labelled at the call site.
 *
 * NOTE ON SCOPING: the backend exposes no tenant model and no auth identity,
 * so we cannot filter systems/runs to a specific auditor or tenant yet. This
 * hook returns everything the API returns; the moment the backend grows an
 * `assignments` table + authenticated identity, filter the `systems`/`runs`
 * lists here and the whole workspace becomes assignment-scoped for free.
 */

// How many recent runs we pull full reports for. Bounded so the workspace
// stays responsive; raise once pagination/summary endpoints exist.
const RUN_SAMPLE_SIZE = 20;

const COMPLETED_STATUSES = new Set(["completed", "report_ready"]);
const TERMINAL_STATUSES = new Set(["completed", "report_ready", "failed", "cancelled", "canceled"]);

export type ReviewItem = {
  run: EvaluationRun;
  systemId: string;
  systemName: string;
  status: string;
  /** Ready for auditor review (run reached a report-bearing terminal state). */
  reviewable: boolean;
  findingCount: number;
  openFindings: number;
  criticalHigh: number;
  verdict: Verdict | null;
  verdictLabel: string | null;
  /** True when the run has a generated report an auditor could sign off. */
  hasReport: boolean;
  /**
   * Real metric-check breakdown for this run (from `report.metric_results`,
   * using the canonical `metricOutcome` pass rule). `null` when the run has no
   * report/results. This is a factual count of checks — NOT a synthetic
   * conformance score (honesty rule §2/§7).
   */
  metrics: { passed: number; failed: number; needsReview: number; total: number } | null;
  createdAt: string;
};

export type RemediationItem = {
  id: string;
  runId: string;
  systemName: string;
  source: "verdict" | "finding";
  title: string;
  detail: string | null;
  severity: string;
  owner: string | null;
  frameworkRefs: string[];
  createdAt: string;
};

export type CriticalFinding = BackendFinding & {
  runId: string;
  systemName: string;
};

export type AuditorWorkspace = {
  loading: boolean;
  error: string | null;
  connected: boolean;
  empty: boolean;

  /** Active (non-archived) systems from the list endpoint. */
  systems: BackendAISystem[];
  /**
   * Every system in assurance scope = active systems PLUS any system a run
   * references (even if archived — the list endpoint hides archived systems,
   * but their historical runs/findings must not look orphaned). Deduped by id.
   */
  systemsInScope: BackendAISystem[];
  runs: EvaluationRun[];
  reviewItems: ReviewItem[];
  criticalFindings: CriticalFinding[];
  remediationItems: RemediationItem[];

  priorities: {
    /** No assignment backend yet → always null (rendered as an honest empty state). */
    assignedSystems: number | null;
    pendingReviews: number;
    criticalFindings: number;
    pendingVerdicts: number;
    reportsAwaitingSignoff: number;
    openRemediation: number;
  };

  refresh: () => void;
};

const SEVERITY_RANK: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

function severityRank(s: string): number {
  return SEVERITY_RANK[s.toLowerCase()] ?? 0;
}

function buildEmpty(extra: Partial<AuditorWorkspace>): AuditorWorkspace {
  return {
    loading: false,
    error: null,
    connected: false,
    empty: false,
    systems: [],
    systemsInScope: [],
    runs: [],
    reviewItems: [],
    criticalFindings: [],
    remediationItems: [],
    priorities: {
      assignedSystems: null,
      pendingReviews: 0,
      criticalFindings: 0,
      pendingVerdicts: 0,
      reportsAwaitingSignoff: 0,
      openRemediation: 0,
    },
    refresh: () => {},
    ...extra,
  };
}

export function useAuditorWorkspace(): AuditorWorkspace {
  const [data, setData] = useState<AuditorWorkspace>(buildEmpty({ loading: true }));
  const [token, setToken] = useState(0);
  const refresh = useCallback(() => setToken((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setData((current) => ({ ...current, loading: true, error: null }));
      try {
        const [systems, runs] = await Promise.all([
          listAISystems(),
          listEvaluationRuns(RUN_SAMPLE_SIZE),
        ]);
        if (cancelled) return;

        const systemNameById = new Map(systems.map((s) => [s.id, s.name]));

        // Pull the full report per run — gives findings, verdict, and counts in
        // one call. Failures degrade to null so one bad run can't blank the page.
        const reports = await Promise.all(
          runs.map((run) => getGovernanceReport(run.id).catch(() => null)),
        );
        if (cancelled) return;

        const reviewItems: ReviewItem[] = [];
        const criticalFindings: CriticalFinding[] = [];
        const remediationItems: RemediationItem[] = [];

        // Systems in scope: seed with the active list, then fold in the system
        // each run's report embeds — so an archived system (hidden by the list
        // endpoint) still shows up alongside its historical runs/findings.
        const scopeById = new Map<string, BackendAISystem>(systems.map((s) => [s.id, s]));

        runs.forEach((run, i) => {
          const report: GovernanceReport | null = reports[i];
          if (report?.ai_system && !scopeById.has(report.ai_system.id)) {
            scopeById.set(report.ai_system.id, report.ai_system);
          }
          const systemName =
            report?.ai_system?.name ?? systemNameById.get(run.ai_system_id) ?? "Unknown system";
          const findings = report?.findings ?? [];
          const verdict = report?.verdict ?? null;
          const openFindings = findings.filter((f) => f.status.toLowerCase() === "open");
          const criticalHigh = findings.filter(
            (f) => f.severity === "critical" || f.severity === "high",
          );
          const hasReport = COMPLETED_STATUSES.has(run.status);

          const metricResults = report?.metric_results ?? [];
          const metrics = metricResults.length
            ? {
                passed: metricResults.filter((m) => metricOutcome(m) === "passed").length,
                failed: metricResults.filter((m) => metricOutcome(m) === "failed").length,
                needsReview: metricResults.filter((m) => metricOutcome(m) === "needs_review").length,
                total: metricResults.length,
              }
            : null;

          reviewItems.push({
            run,
            systemId: run.ai_system_id,
            systemName,
            status: run.status,
            reviewable: hasReport,
            findingCount: findings.length,
            openFindings: openFindings.length,
            criticalHigh: criticalHigh.length,
            verdict,
            verdictLabel: verdict?.label ?? null,
            hasReport,
            metrics,
            createdAt: run.created_at,
          });

          // Critical/high open findings across the workspace, for the Overview
          // + as remediation candidates.
          for (const f of findings) {
            if ((f.severity === "critical" || f.severity === "high") && f.status.toLowerCase() === "open") {
              criticalFindings.push({ ...f, runId: run.id, systemName });
            }
            // A finding with a recommended action + still open is remediation work.
            if (f.recommended_action && f.status.toLowerCase() === "open") {
              remediationItems.push({
                id: `finding:${f.id}`,
                runId: run.id,
                systemName,
                source: "finding",
                title: f.title,
                detail: f.recommended_action,
                severity: f.severity,
                owner: f.agent_name ?? null,
                frameworkRefs: f.framework_refs,
                createdAt: f.created_at,
              });
            }
          }

          // Verdict-prescribed required actions are the authoritative remediation set.
          for (const [j, action] of (verdict?.required_actions ?? []).entries()) {
            remediationItems.push({
              id: `verdict:${verdict?.id ?? run.id}:${j}`,
              runId: run.id,
              systemName,
              source: "verdict",
              title: action.action,
              detail: action.context ?? null,
              severity: action.severity,
              owner: action.owner,
              frameworkRefs: [],
              createdAt: verdict?.created_at ?? run.created_at,
            });
          }
        });

        criticalFindings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
        remediationItems.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

        // ── Priority tallies ────────────────────────────────────────────────
        const pendingReviews = reviewItems.filter((r) => r.reviewable).length;
        // A run "needs a verdict" when it has a report but no verdict, or its
        // verdict is not a clean approval (conditional / blocked).
        const pendingVerdicts = reviewItems.filter(
          (r) =>
            (r.hasReport && !r.verdict) ||
            (r.verdictLabel !== null && r.verdictLabel !== "approved"),
        ).length;
        const reportsAwaitingSignoff = reviewItems.filter((r) => r.hasReport).length;

        const systemsInScope = [...scopeById.values()];

        const next = buildEmpty({
          connected: true,
          empty: systemsInScope.length === 0 && runs.length === 0,
          systems,
          systemsInScope,
          runs,
          reviewItems,
          criticalFindings,
          remediationItems,
          priorities: {
            assignedSystems: null, // no assignment backend yet
            pendingReviews,
            criticalFindings: criticalFindings.length,
            pendingVerdicts,
            reportsAwaitingSignoff,
            openRemediation: remediationItems.length,
          },
        });
        if (!cancelled) setData(next);
      } catch (error) {
        if (!cancelled) {
          setData(
            buildEmpty({
              error: error instanceof Error ? error.message : "Backend API unavailable.",
            }),
          );
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return { ...data, refresh };
}

export { TERMINAL_STATUSES as AUDITOR_TERMINAL_STATUSES };
