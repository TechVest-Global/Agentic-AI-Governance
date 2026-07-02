import { useCallback, useEffect, useState } from "react";
import {
  getAgentExecutions,
  getFindings,
  getFrameworkMap,
  getGovernanceReport,
  listAISystems,
  listEvaluationRuns,
  type AgentExecution,
  type BackendAISystem,
  type BackendFinding,
  type EvaluationRun,
  type FrameworkComplianceMap,
  type GovernanceReport,
} from "@/api/governanceApi";

// How many of the most recent runs we pull full reports for (verdict trend,
// outcome mix, average confidence). Bounded so the dashboard stays snappy.
const REPORT_SAMPLE_SIZE = 10;

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

export type RiskSlice = { name: string; value: number; color: string };
export type ConfidencePoint = { label: string; score: number; runId: string };
export type OutcomeCount = { label: string; value: number; color: string };
export type SeverityCount = { severity: string; count: number; color: string };
export type FrameworkCoverage = {
  frameworkId: string;
  framework: string;
  coverage: number;
  passed: number;
  failed: number;
  pending: number;
  controls: number;
  status: "Aligned" | "Partial" | "At Risk" | "Not Evaluated";
};
export type RecentRunRow = {
  run: EvaluationRun;
  systemName: string;
  label: string | null;
  confidence: number | null;
};

export type DashboardData = {
  loading: boolean;
  error: string | null;
  /** True once at least the systems + runs lists loaded from the backend. */
  connected: boolean;
  /** True when the backend is reachable but there is no data to show yet. */
  empty: boolean;

  systems: BackendAISystem[];
  runs: EvaluationRun[];
  latestRun: EvaluationRun | null;
  latestReport: GovernanceReport | null;
  frameworkMap: FrameworkComplianceMap | null;
  agentExecutions: AgentExecution[];
  findings: BackendFinding[];

  kpis: {
    totalSystems: number;
    activeRuns: number;
    openFindings: number;
    avgConfidence: number | null;
  };
  riskDistribution: RiskSlice[];
  confidenceTrend: ConfidencePoint[];
  outcomeMix: OutcomeCount[];
  severityBreakdown: SeverityCount[];
  frameworkCoverage: FrameworkCoverage[];
  recentRuns: RecentRunRow[];

  refresh: () => void;
};

const RISK_COLORS: Record<string, string> = { high: "#ef4444", medium: "#f59e0b", low: "#10b981" };
const SEVERITY_COLORS: Record<string, string> = {
  critical: "#b91c1c",
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#10b981",
  info: "#64748b",
};
const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"];

function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildEmpty(extra: Partial<DashboardData>): DashboardData {
  return {
    loading: false,
    error: null,
    connected: false,
    empty: false,
    systems: [],
    runs: [],
    latestRun: null,
    latestReport: null,
    frameworkMap: null,
    agentExecutions: [],
    findings: [],
    kpis: { totalSystems: 0, activeRuns: 0, openFindings: 0, avgConfidence: null },
    riskDistribution: [],
    confidenceTrend: [],
    outcomeMix: [],
    severityBreakdown: [],
    frameworkCoverage: [],
    recentRuns: [],
    refresh: () => {},
    ...extra,
  };
}

function computeRiskDistribution(systems: BackendAISystem[]): RiskSlice[] {
  const order: Array<["high" | "medium" | "low", string]> = [
    ["high", "High Risk"],
    ["medium", "Medium Risk"],
    ["low", "Low Risk"],
  ];
  return order.map(([tier, name]) => ({
    name,
    value: systems.filter((s) => s.risk_tier === tier).length,
    color: RISK_COLORS[tier],
  }));
}

function computeFrameworkCoverage(map: FrameworkComplianceMap | null): FrameworkCoverage[] {
  if (!map) return [];
  const byFramework = new Map<string, { name: string; passed: number; failed: number; pending: number; total: number }>();
  for (const control of map.controls) {
    const entry = byFramework.get(control.framework_id) ?? {
      name: control.framework_name,
      passed: 0,
      failed: 0,
      pending: 0,
      total: 0,
    };
    entry.total += 1;
    if (control.status === "passed") entry.passed += 1;
    else if (control.status === "failed") entry.failed += 1;
    else entry.pending += 1; // needs_review + not_evaluated
    byFramework.set(control.framework_id, entry);
  }
  return [...byFramework.entries()].map(([frameworkId, e]) => {
    const coverage = e.total > 0 ? Math.round((e.passed / e.total) * 100) : 0;
    let status: FrameworkCoverage["status"] = "Not Evaluated";
    if (e.total > 0) {
      if (e.failed > 0) status = "At Risk";
      else if (coverage >= 90) status = "Aligned";
      else status = "Partial";
    }
    return {
      frameworkId,
      framework: e.name,
      coverage,
      passed: e.passed,
      failed: e.failed,
      pending: e.pending,
      controls: e.total,
      status,
    };
  });
}

export function useDashboardData(): DashboardData {
  const [data, setData] = useState<DashboardData>(buildEmpty({ loading: true }));
  const [token, setToken] = useState(0);
  const refresh = useCallback(() => setToken((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setData((current) => ({ ...current, loading: true, error: null }));
      try {
        const [systems, runs] = await Promise.all([listAISystems(), listEvaluationRuns(REPORT_SAMPLE_SIZE)]);
        if (cancelled) return;

        const systemNameById = new Map(systems.map((s) => [s.id, s.name]));

        // Pull full reports for the recent runs so we get verdicts (confidence,
        // outcome label) + counts. Failures degrade to null rather than break.
        const reports = await Promise.all(
          runs.map((run) => getGovernanceReport(run.id).catch(() => null)),
        );
        if (cancelled) return;

        const reportByRunId = new Map<string, GovernanceReport>();
        reports.forEach((report, i) => {
          if (report) reportByRunId.set(runs[i].id, report);
        });

        const latestRun = runs[0] ?? null;
        const latestReport = latestRun ? reportByRunId.get(latestRun.id) ?? null : null;

        // Latest-run detail panels (framework coverage, agents, findings).
        const [frameworkMap, agentExecutions, findings] = latestRun
          ? await Promise.all([
              getFrameworkMap(latestRun.id).catch(() => null),
              getAgentExecutions(latestRun.id).catch(() => [] as AgentExecution[]),
              getFindings(latestRun.id).catch(() => [] as BackendFinding[]),
            ])
          : [null, [] as AgentExecution[], [] as BackendFinding[]];
        if (cancelled) return;

        // --- KPIs -------------------------------------------------------------
        const activeRuns = runs.filter((r) => !TERMINAL_STATUSES.has(r.status)).length;
        const openFindings = findings.filter((f) => f.status === "open").length;
        const confidences = runs
          .map((r) => reportByRunId.get(r.id)?.verdict?.confidence_score)
          .filter((c): c is number => typeof c === "number");
        const avgConfidence =
          confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null;

        // --- Confidence trend (oldest → newest) -------------------------------
        // Each point is one adjudicated run. Runs are often created the same day
        // (e.g. a demo session), so a date-only label collapses to "Jun 30" on
        // every tick. Detect a single-day series and switch to a time label, then
        // guarantee uniqueness so adjacent ticks never render identical text.
        const adjudicated = [...runs]
          .reverse()
          .map((run) => {
            const verdict = reportByRunId.get(run.id)?.verdict;
            if (!verdict) return null;
            return { run, score: Math.round(verdict.confidence_score * 100) };
          })
          .filter((p): p is { run: EvaluationRun; score: number } => p !== null);

        const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        const dates = adjudicated.map((p) => new Date(p.run.created_at)).filter((d) => !Number.isNaN(d.getTime()));
        const singleDay = dates.length > 0 && dates.every((d) => dayKey(d) === dayKey(dates[0]));

        const labelCounts = new Map<string, number>();
        const confidenceTrend: ConfidencePoint[] = adjudicated.map(({ run, score }) => {
          const date = new Date(run.created_at);
          let label: string;
          if (Number.isNaN(date.getTime())) {
            label = run.id.slice(0, 4);
          } else if (singleDay) {
            label = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
          } else {
            label = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
          }
          // Disambiguate any remaining collisions (same minute / same day).
          const seen = labelCounts.get(label) ?? 0;
          labelCounts.set(label, seen + 1);
          if (seen > 0) label = `${label} (${seen + 1})`;
          return { label, score, runId: run.id };
        });

        // --- Outcome mix ------------------------------------------------------
        const outcomeTally = { approved: 0, conditional: 0, blocked: 0 };
        for (const run of runs) {
          const label = reportByRunId.get(run.id)?.verdict?.label;
          if (label === "approved") outcomeTally.approved += 1;
          else if (label === "conditional_approval") outcomeTally.conditional += 1;
          else if (label === "blocked") outcomeTally.blocked += 1;
        }
        const outcomeMix: OutcomeCount[] = [
          { label: "Approved", value: outcomeTally.approved, color: "#10b981" },
          { label: "Conditional", value: outcomeTally.conditional, color: "#f59e0b" },
          { label: "Blocked", value: outcomeTally.blocked, color: "#ef4444" },
        ];

        // --- Severity breakdown (latest run findings) -------------------------
        const severityTally = new Map<string, number>();
        for (const f of findings) severityTally.set(f.severity, (severityTally.get(f.severity) ?? 0) + 1);
        const severityBreakdown: SeverityCount[] = SEVERITY_ORDER.filter((s) => severityTally.has(s)).map((s) => ({
          severity: titleCase(s),
          count: severityTally.get(s) ?? 0,
          color: SEVERITY_COLORS[s],
        }));

        // --- Recent run rows --------------------------------------------------
        const recentRuns: RecentRunRow[] = runs.map((run) => {
          const verdict = reportByRunId.get(run.id)?.verdict;
          return {
            run,
            systemName: systemNameById.get(run.ai_system_id) ?? "Unknown system",
            label: verdict?.label ?? null,
            confidence: verdict?.confidence_score ?? null,
          };
        });

        const next = buildEmpty({
          connected: true,
          empty: systems.length === 0 && runs.length === 0,
          systems,
          runs,
          latestRun,
          latestReport,
          frameworkMap,
          agentExecutions,
          findings,
          kpis: {
            totalSystems: systems.length,
            activeRuns,
            openFindings,
            avgConfidence,
          },
          riskDistribution: computeRiskDistribution(systems),
          confidenceTrend,
          outcomeMix,
          severityBreakdown,
          frameworkCoverage: computeFrameworkCoverage(frameworkMap),
          recentRuns,
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
