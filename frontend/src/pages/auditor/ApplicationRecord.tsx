import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  Download,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import clsx from "clsx";
import { useAppStore } from "@/store/useAppStore";
import { useSelectionStore } from "@/store/useSelectionStore";
import { useAuditorApplication } from "@/hooks/useAuditorApplication";
import { ControlAssurance } from "./ControlAssurance";
import { MetricDetailSections } from "./MetricDetail";
import {
  getRunVerdict,
  getFrameworkMap,
  listEvaluationRuns,
  listMetricConfigs,
  type BackendFinding,
  type EvaluationRun,
  type EvidenceRecord,
  type FrameworkControlAssessment,
  type GovernanceReport,
  type MetricConfigFull,
  type MetricResult,
  type RunMetricPlanEntry,
  type Verdict,
} from "@/api/governanceApi";
import { AuditorSkeleton, BackendError, timeAgo } from "./components";
import {
  StatTile,
  Tabs,
  VerdictPill,
  frameworkLabel,
  humanizeDimension,
  metricOutcome,
  metricFailed,
  metricPassed,
  toolLabel,
  verdictToClient,
  type MetricOutcome,
  type TabDef,
} from "./clientComponents";

/**
 * Application record — a single AI application's assurance detail, read-only,
 * client-facing. A hero (identity + verdict + compact score) over five tabs:
 * Summary · Compliance (controls-first) · Metrics (table) · Evidence · History.
 * All values come from the selected app's real run via useAuditorApplication.
 */

const TAB_IDS = ["summary", "compliance", "metrics", "history"] as const;
type TabId = (typeof TAB_IDS)[number];

const IN_FLIGHT_STATUSES = new Set([
  "created", "context_assembly", "planned", "metrics_running", "agents_running", "council_running",
]);

function useSuppressHeader() {
  const setHeaderHidden = useAppStore((s) => s.setHeaderHidden);
  useEffect(() => {
    setHeaderHidden(true);
    return () => setHeaderHidden(false);
  }, [setHeaderHidden]);
}

export function ApplicationRecord() {
  useSuppressHeader();
  const navigateTo = useAppStore((s) => s.navigateTo);
  const appId = useSelectionStore((s) => s.selectedSystemId);
  const app = useAuditorApplication(appId);
  const [tab, setTab] = useState<TabId>("summary");

  useEffect(() => {
    if (!appId) navigateTo("/applications");
  }, [appId, navigateTo]);
  if (!appId) return null;

  if (app.loading) return <div className="space-y-5"><BackLink onClick={() => navigateTo("/applications")} /><AuditorSkeleton /></div>;
  if (app.error) return <div className="space-y-5"><BackLink onClick={() => navigateTo("/applications")} /><BackendError message={app.error} onRetry={app.refresh} /></div>;

  const system = app.system;
  if (!system) {
    return (
      <div className="space-y-5">
        <BackLink onClick={() => navigateTo("/applications")} />
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-10 text-center text-[13px] text-slate-500 dark:text-slate-400">
          This application could not be found.
        </div>
      </div>
    );
  }

  const verdict = verdictToClient(app.report?.verdict?.label, {
    actionTier: app.report?.verdict?.action_tier,
    hasTerminalRun: app.hasReport,
    runInFlight: app.runInFlight,
  });

  const metricCounts = countMetrics(app.report?.metric_results ?? []);
  const dimensionCount = new Set((app.report?.metric_results ?? []).map((m) => humanizeDimension(m.dimension))).size;
  const overallPct = metricCounts.total ? Math.round((metricCounts.passed / metricCounts.total) * 100) : null;

  const tabs: TabDef[] = [
    { id: "summary", label: "Summary" },
    { id: "compliance", label: "Compliance", count: system.selected_frameworks.length || undefined },
    { id: "metrics", label: "Metrics", count: metricCounts.total || undefined },
    { id: "history", label: "History" },
  ];

  return (
    <div className="space-y-5">
      <BackLink onClick={() => navigateTo("/applications")} />

      {/* hero — identity, verdict, actions, compact score */}
      <div className="rounded-2xl border border-hairline dark:border-white/10 bg-white dark:bg-slate-900 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-display text-[22px] leading-tight text-ink dark:text-white">{system.name}</h1>
              <VerdictPill meta={verdict} size="sm" />
              <RiskBadge tier={system.risk_tier} />
            </div>
            <p className="mt-1.5 text-[12px] text-slate-500 dark:text-slate-400">
              <span className="capitalize">{system.system_type.replace(/[_-]/g, " ")}</span>
              {system.owner && <> · {system.owner}</>}
              {app.assessedRun && <> · assessed {timeAgo(app.assessedRun.created_at)}</>}
            </p>
          </div>
          <HeroActions report={app.report} system={system} />
        </div>

        {overallPct != null ? (
          <div className="mt-5 flex flex-wrap items-center gap-x-8 gap-y-4 border-t border-hairline dark:border-white/10 pt-5">
            <div className="shrink-0">
              <p className="font-display text-[30px] leading-none text-ink dark:text-white tabular-nums">{overallPct}%</p>
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Checks passed</p>
            </div>
            <div className="min-w-[220px] flex-1 max-w-lg">
              <ScoreBar counts={metricCounts} />
              <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1">
                <Count dot="bg-emerald-500" n={metricCounts.passed} label="passed" />
                <Count dot="bg-red-400" n={metricCounts.failed} label="failed" />
                <Count dot="bg-amber-500" n={metricCounts.needsReview} label="needs review" />
                <span className="text-[11px] text-slate-400 dark:text-slate-500">· {metricCounts.total} checks</span>
              </div>
            </div>
          </div>
        ) : (
          <p className="mt-5 border-t border-hairline dark:border-white/10 pt-5 text-[12px] text-slate-400 dark:text-slate-500">
            {app.runInFlight ? "Assessment in progress — checks pending." : "This application has not been assessed yet."}
          </p>
        )}
      </div>

      {app.notAssessed ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-10 text-center">
          <ShieldCheck className="mx-auto mb-3 h-7 w-7 text-slate-400" aria-hidden />
          <p className="text-[14px] font-semibold text-ink dark:text-white">Not yet assessed</p>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-slate-500 dark:text-slate-400">
            This application is registered but has no completed assessment yet. Results will appear here once
            an assessment has been run on the engineering side.
          </p>
        </div>
      ) : (
        <>
          <Tabs tabs={tabs} active={tab} onChange={(t) => setTab(t as TabId)} />
          <div role="tabpanel">
            {tab === "summary" && <SummaryTab app={app} verdictText={verdict.text} metricCounts={metricCounts} dimensionCount={dimensionCount} />}
            {tab === "compliance" && (
              <ControlAssurance
                frameworks={system.selected_frameworks}
                metricResults={app.report?.metric_results ?? []}
                lastAssessed={app.assessedRun?.created_at ?? null}
                plan={app.report?.metric_plan?.metrics ?? []}
                runId={app.report?.run.id ?? null}
              />
            )}
            {tab === "metrics" && <MetricsTab report={app.report} />}
            {tab === "history" && <HistoryTab appId={appId} currentRunId={app.assessedRun?.id ?? null} />}
          </div>
        </>
      )}
    </div>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-slate-500 dark:text-slate-400 hover:text-ink dark:hover:text-white">
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
      Applications
    </button>
  );
}

const RISK_BADGE: Record<string, string> = {
  high: "text-red-700 bg-red-50 dark:text-red-300 dark:bg-red-950/40",
  medium: "text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/40",
  low: "text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40",
};

function RiskBadge({ tier }: { tier: string }) {
  const t = tier?.toLowerCase();
  const cls = RISK_BADGE[t] ?? "text-slate-500 bg-slate-100 dark:text-slate-400 dark:bg-slate-800";
  return (
    <span className={clsx("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em]", cls)}>
      {t ? `${t} risk` : "risk unknown"}
    </span>
  );
}

/** Compact "● 22 passed" — small dot, bold figure, muted label. */
function Count({ dot, n, label }: { dot: string; n: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
      <span className={clsx("h-1.5 w-1.5 rounded-full", dot)} aria-hidden />
      <span className="font-semibold tabular-nums text-ink dark:text-slate-200">{n}</span>
      {label}
    </span>
  );
}

function ScoreBar({ counts }: { counts: { passed: number; failed: number; needsReview: number; total: number } }) {
  const pct = (n: number) => (counts.total ? (n / counts.total) * 100 : 0);
  return (
    <div className="flex h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="img" aria-label={`${counts.passed} passed, ${counts.failed} failed, ${counts.needsReview} needs review of ${counts.total}`}>
      <div className="h-full bg-emerald-500" style={{ width: `${pct(counts.passed)}%` }} />
      <div className="h-full bg-amber-400" style={{ width: `${pct(counts.needsReview)}%` }} />
      <div className="h-full bg-red-400" style={{ width: `${pct(counts.failed)}%` }} />
    </div>
  );
}

/* ───────────────────────────────────────────────────── hero actions ── */

function HeroActions({ report, system }: { report: GovernanceReport | null; system: { name: string } }) {
  function exportReport() {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${system.name.replace(/\s+/g, "-").toLowerCase()}-assurance-report.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        disabled
        title="Re-assessment requests aren't available yet — this needs a backend request endpoint."
        aria-disabled
        className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-hairline dark:border-slate-700 px-3 py-1.5 text-[12px] font-medium text-slate-400 dark:text-slate-500"
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        Request re-assessment
      </button>
      <button
        type="button"
        onClick={exportReport}
        disabled={!report}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
      >
        <Download className="h-3.5 w-3.5" aria-hidden />
        Export report
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── Summary ── */

const SEVERITY_META: Record<string, { label: string; dot: string; text: string }> = {
  critical: { label: "Critical", dot: "bg-red-500", text: "text-red-600 dark:text-red-400" },
  high: { label: "High", dot: "bg-red-400", text: "text-red-600 dark:text-red-400" },
  medium: { label: "Medium", dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  low: { label: "Low", dot: "bg-slate-400", text: "text-slate-500 dark:text-slate-400" },
};
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function SummaryTab({
  app, verdictText, metricCounts, dimensionCount,
}: {
  app: ReturnType<typeof useAuditorApplication>;
  verdictText: string;
  metricCounts: { passed: number; failed: number; needsReview: number; total: number };
  dimensionCount: number;
}) {
  const report = app.report;
  const plain = plainLanguageVerdict(verdictText, report, metricCounts);
  const openIssues = useMemo(() => {
    return (report?.findings ?? [])
      .filter((f) => f.status?.toLowerCase() === "open")
      .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9))
      .slice(0, 5);
  }, [report]);
  const openTotal = (report?.findings ?? []).filter((f) => f.status?.toLowerCase() === "open").length;
  const requiredActions = report?.verdict?.required_actions ?? [];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Overall verdict" value={<span className="text-[17px]">{verdictText}</span>}
          tone={verdictText === "Compliant" ? "good" : verdictText === "Not compliant" ? "danger" : verdictText === "Conditional" ? "warn" : "default"} />
        <StatTile label="Metrics passed" value={`${metricCounts.passed}/${metricCounts.total}`} />
        <StatTile label="Dimensions assessed" value={dimensionCount} />
        <StatTile label="Open findings" value={openTotal} tone={openTotal ? "warn" : "default"} />
      </div>

      {/* concise assessment summary — not a giant box */}
      <section>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Assessment summary</p>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-slate-700 dark:text-slate-300">{plain}</p>
      </section>

      {/* required actions — the engine's prescribed next steps (what to do) */}
      {requiredActions.length > 0 && (
        <section>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Required actions</p>
          <ul className="mt-2 divide-y divide-hairline dark:divide-white/10 overflow-hidden rounded-xl border border-hairline dark:border-white/10 bg-white dark:bg-slate-900">
            {requiredActions.map((a, i) => {
              const sev = SEVERITY_META[a.severity] ?? SEVERITY_META.low;
              return (
                <li key={i} className="flex items-start gap-3 px-4 py-3">
                  <span className={clsx("mt-1.5 h-2 w-2 shrink-0 rounded-full", sev.dot)} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] leading-relaxed text-ink dark:text-white">{a.action}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
                      <span className={clsx("font-semibold uppercase tracking-wide", sev.text)}>{sev.label}</span>
                      {a.owner && <> · Owner: {humanizeToken(a.owner)}</>}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* recent important issues — calm list, no red blocks */}
      <section>
        <div className="flex items-baseline justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Recent important issues</p>
          {openTotal > openIssues.length && <span className="text-[11px] text-slate-400">{openTotal} open in total</span>}
        </div>
        {openIssues.length === 0 ? (
          <p className="mt-2 rounded-xl border border-hairline dark:border-white/10 bg-white dark:bg-slate-900 px-4 py-3 text-[13px] text-slate-500 dark:text-slate-400">
            No open findings for this application.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-hairline dark:divide-white/10 overflow-hidden rounded-xl border border-hairline dark:border-white/10 bg-white dark:bg-slate-900">
            {openIssues.map((f) => <IssueRow key={f.id} finding={f} />)}
          </ul>
        )}
      </section>

      {/* evidence integrity — a factual assurance line; each check's records are
          viewable from its detail in Metrics / Compliance. */}
      {(report?.evidence.length ?? 0) > 0 && (
        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          {report!.evidence.length} sealed evidence records back these results — each linked to a check. Open any check in Metrics or Compliance to view its evidence.
        </p>
      )}
    </div>
  );
}

function IssueRow({ finding }: { finding: BackendFinding }) {
  const sev = SEVERITY_META[finding.severity] ?? SEVERITY_META.low;
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span className={clsx("mt-1.5 h-2 w-2 shrink-0 rounded-full", sev.dot)} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <p className="text-[13px] font-medium text-ink dark:text-white">{finding.title}</p>
          <span className={clsx("text-[10px] font-semibold uppercase tracking-wide", sev.text)}>{sev.label}</span>
          <span className="text-[11px] text-slate-400">· {humanizeDimension(finding.dimension)}</span>
        </div>
        {finding.recommended_action && (
          <p className="mt-0.5 truncate text-[12px] text-slate-500 dark:text-slate-400">{finding.recommended_action}</p>
        )}
      </div>
    </li>
  );
}

function plainLanguageVerdict(
  verdictText: string,
  report: GovernanceReport | null,
  metricCounts: { total: number; passed: number; failed: number; needsReview: number },
): string {
  const open = (report?.findings ?? []).filter((f) => f.status?.toLowerCase() === "open");
  const critical = open.filter((f) => f.severity === "critical" || f.severity === "high");
  const topDim = critical[0]?.dimension ? humanizeDimension(critical[0].dimension) : null;
  const confidence = report?.verdict?.confidence_score;
  const metricSummary = metricCounts.total > 0
    ? `${metricCounts.failed} of ${metricCounts.total} assessed checks did not pass`
    : "No metric checks are available yet";
  switch (verdictText) {
    case "Compliant":
      return "This application meets the assessed requirements. No blocking issues were found across the evaluated dimensions.";
    case "Conditional":
      return `Broadly compliant, with open items to address${topDim ? `, most notably around ${topDim.toLowerCase()}` : ""}. It can proceed once the noted conditions are resolved.`;
    case "Not compliant":
      return `Does not currently meet the assessed requirements${topDim ? ` — the main gap is in ${topDim.toLowerCase()}` : ""}. ${critical.length} higher-severity issue${critical.length === 1 ? "" : "s"} to resolve.`;
    case "Under review":
      return `Routed for human review${typeof confidence === "number" ? ` (engine confidence ${Math.round(confidence * 100)}%)` : ""}: ${metricSummary}. The overall verdict is unresolved because the engine did not have enough evidence to decide confidently.`;
    case "In progress":
      return "An assessment is currently running. Results will appear here once it completes.";
    default:
      return "This application has not been assessed yet.";
  }
}

/* ─────────────────────────────────────────────────────────── Metrics ── */

function countMetrics(results: MetricResult[]) {
  const passed = results.filter(metricPassed).length;
  const failed = results.filter(metricFailed).length;
  return { passed, failed, needsReview: Math.max(results.length - passed - failed, 0), total: results.length };
}

type MetricResultState = "passed" | "failed" | "warning" | "manual_review";
type ResultFilter = "all" | MetricResultState;
type MetricFrameworkMapping = {
  key: string;
  frameworkId: string;
  controlRef?: string | null;
  title?: string | null;
};
type MetricTableRow = {
  metric: MetricResult;
  outcome: MetricOutcome;
  result: MetricResultState;
  config: MetricConfigFull | null;
  plan: RunMetricPlanEntry | null;
  name: string;
  tool: string;
  mappings: MetricFrameworkMapping[];
  evidence: EvidenceRecord[];
  findings: BackendFinding[];
};
const OUTCOME_RANK: Record<MetricOutcome, number> = { failed: 0, needs_review: 1, passed: 2 };

function MetricsTab({ report }: { report: GovernanceReport | null }) {
  const results = report?.metric_results ?? [];
  const [catalog, setCatalog] = useState<MetricConfigFull[]>([]);
  const [controls, setControls] = useState<FrameworkControlAssessment[]>([]);
  const [selectedMetric, setSelectedMetric] = useState<MetricResult | null>(null);
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [dimensionFilter, setDimensionFilter] = useState("all");
  const [toolFilter, setToolFilter] = useState("all");
  const [frameworkFilter, setFrameworkFilter] = useState("all");

  useEffect(() => {
    let cancelled = false;
    listMetricConfigs({ limit: 200 })
      .then((rows) => { if (!cancelled) setCatalog(rows); })
      .catch(() => { if (!cancelled) setCatalog([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const runId = report?.run.id;
    if (!runId) {
      setControls([]);
      return () => { cancelled = true; };
    }
    getFrameworkMap(runId)
      .then((map) => { if (!cancelled) setControls(map.controls); })
      .catch(() => { if (!cancelled) setControls([]); });
    return () => { cancelled = true; };
  }, [report?.run.id]);

  const catalogById = useMemo(() => {
    const m = new Map<string, MetricConfigFull>();
    for (const c of catalog) m.set(c.metric_id, c);
    return m;
  }, [catalog]);
  const planById = useMemo(() => {
    const m = new Map<string, RunMetricPlanEntry>();
    for (const p of report?.metric_plan?.metrics ?? []) m.set(p.metric_id, p);
    return m;
  }, [report]);
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of report?.metric_plan?.metrics ?? []) m.set(e.metric_id, e.name);
    for (const e of catalog) m.set(e.metric_id, e.name);
    return m;
  }, [report, catalog]);
  const evidenceById = useMemo(() => {
    const m = new Map<string, EvidenceRecord>();
    for (const e of report?.evidence ?? []) m.set(e.id, e);
    return m;
  }, [report?.evidence]);

  const assessed = countMetrics(results);
  const plannedTotal = report?.metric_plan?.metric_count ?? catalog.length;
  const rows = useMemo<MetricTableRow[]>(() => {
    return results.map((metric) => {
      const config = catalogById.get(metric.metric_id) ?? null;
      const plan = planById.get(metric.metric_id) ?? null;
      const mappings = metricMappings(metric.metric_id, controls, config, plan);
      const evidence = metric.evidence_ids.map((id) => evidenceById.get(id)).filter((e): e is EvidenceRecord => Boolean(e));
      const findings = linkedFindings(metric, report?.findings ?? []);
      return {
        metric,
        outcome: metricOutcome(metric),
        result: metricResultState(metric),
        config,
        plan,
        name: nameById.get(metric.metric_id) ?? metric.metric_id,
        tool: metricToolLabel(metric, config, plan),
        mappings,
        evidence,
        findings,
      };
    });
  }, [results, catalogById, planById, controls, evidenceById, report?.findings, nameById]);

  const resultCounts = useMemo(() => {
    const c: Record<ResultFilter, number> = { all: rows.length, passed: 0, failed: 0, warning: 0, manual_review: 0 };
    for (const row of rows) c[row.result]++;
    return c;
  }, [rows]);

  const dimensions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.metric.dimension))).sort((a, b) => humanizeDimension(a).localeCompare(humanizeDimension(b))),
    [rows],
  );
  const tools = useMemo(() => Array.from(new Set(rows.map((row) => row.tool))).sort(), [rows]);
  const frameworks = useMemo(
    () => Array.from(new Set(rows.flatMap((row) => row.mappings.map((m) => m.frameworkId)))).sort(),
    [rows],
  );

  const filteredRows = useMemo(() => {
    return rows
      .filter((row) => resultFilter === "all" || row.result === resultFilter)
      .filter((row) => dimensionFilter === "all" || row.metric.dimension === dimensionFilter)
      .filter((row) => toolFilter === "all" || row.tool === toolFilter)
      .filter((row) => frameworkFilter === "all" || row.mappings.some((m) => m.frameworkId === frameworkFilter))
      .sort((a, b) => OUTCOME_RANK[a.outcome] - OUTCOME_RANK[b.outcome] || a.metric.metric_id.localeCompare(b.metric.metric_id));
  }, [rows, resultFilter, dimensionFilter, toolFilter, frameworkFilter]);
  const selectedRow = selectedMetric ? rows.find((row) => row.metric.id === selectedMetric.id) ?? null : null;

  if (results.length === 0) {
    return <PanelNote>No metric results are available for this assessment yet.</PanelNote>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-hairline dark:border-white/10 bg-white dark:bg-slate-900 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-1.5 text-[12px] text-slate-500 dark:text-slate-400">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
            <span><span className="font-semibold tabular-nums text-ink dark:text-white">{assessed.total}</span>{plannedTotal && plannedTotal > assessed.total ? `/${plannedTotal}` : ""} assessed</span>
            <span><span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{assessed.passed}</span> passed</span>
            <span><span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">{assessed.failed}</span> failed</span>
            <span><span className="font-semibold tabular-nums text-amber-700 dark:text-amber-400">{assessed.needsReview}</span> manual review</span>
            <span><span className="font-semibold tabular-nums text-ink dark:text-white">{filteredRows.length}</span> shown</span>
          </div>
          <MethodsRefLink />
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <FilterSelect
          label="Result"
          value={resultFilter}
          onChange={(v) => setResultFilter(v as ResultFilter)}
          options={[
            ["all", `All results (${resultCounts.all})`],
            ["failed", `Failed (${resultCounts.failed})`],
            ["warning", `Warning (${resultCounts.warning})`],
            ["manual_review", `Manual review (${resultCounts.manual_review})`],
            ["passed", `Passed (${resultCounts.passed})`],
          ]}
        />
        <FilterSelect
          label="Dimension"
          value={dimensionFilter}
          onChange={setDimensionFilter}
          options={[["all", "All dimensions"], ...dimensions.map((d) => [d, humanizeDimension(d)] as [string, string])]}
        />
        <FilterSelect
          label="Method"
          value={toolFilter}
          onChange={setToolFilter}
          options={[["all", "All methods"], ...tools.map((tool) => [tool, toolLabel(tool)] as [string, string])]}
        />
        <FilterSelect
          label="Framework"
          value={frameworkFilter}
          onChange={setFrameworkFilter}
          options={[["all", "All frameworks"], ...frameworks.map((fw) => [fw, frameworkLabel(fw)] as [string, string])]}
        />
      </div>

      {/* metrics table */}
      <div className="overflow-hidden rounded-xl border border-hairline dark:border-white/10 bg-white dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] border-collapse text-left">
            <thead>
              <tr className="border-b border-hairline dark:border-white/10 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500">
                <Th className="pl-4">Metric</Th>
                <Th>Dimension</Th>
                <Th>Method</Th>
                <Th className="text-right">Score</Th>
                <Th className="text-right">Threshold</Th>
                <Th>Result</Th>
                <Th className="text-right">Evidence</Th>
                <Th>Framework mappings</Th>
                <Th className="pr-4 text-right">Details</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline dark:divide-white/10">
              {filteredRows.map((row) => {
                const { metric } = row;
                const r = metric;
                const frameworks = row.mappings.map((m) => m.controlRef ? `${frameworkLabel(m.frameworkId)} ${m.controlRef}` : frameworkLabel(m.frameworkId));
                return (
                  <tr
                    key={metric.id}
                    onClick={() => setSelectedMetric(metric)}
                    className="cursor-pointer text-[12.5px] hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                  >
                    <td className="py-2.5 pl-4 pr-3">
                      <p className="max-w-[260px] truncate font-medium text-ink dark:text-white" title={row.name}>{row.name}</p>
                      <p className="font-mono text-[10px] text-slate-400 dark:text-slate-500">{metric.metric_id}</p>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{humanizeDimension(metric.dimension)}</td>
                    <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{toolLabel(row.tool)}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-200">
                      {r.normalized_score != null ? r.normalized_score.toFixed(2) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-400 dark:text-slate-500">
                      {r.threshold != null ? r.threshold.toFixed(2) : "—"}
                    </td>
                    <td className="px-3 py-2.5"><ResultChip result={row.result} /></td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">{metric.evidence_ids.length}</td>
                    <td className="px-3 py-2.5">
                      <span className="flex flex-wrap gap-1">
                        {frameworks.slice(0, 2).map((f) => (
                          <span key={f} className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500 dark:text-slate-400">{f}</span>
                        ))}
                        {frameworks.length > 2 && <span className="text-[10px] text-slate-400">+{frameworks.length - 2}</span>}
                        {frameworks.length === 0 && <span className="text-[11px] text-slate-300 dark:text-slate-600">—</span>}
                      </span>
                    </td>
                    <td className="py-2.5 pl-3 pr-4 text-right">
                      <button
                        onClick={() => setSelectedMetric(r)}
                        className="inline-flex items-center gap-0.5 text-[12px] font-medium text-brand-700 dark:text-brand-400 hover:underline"
                      >
                        Details <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-[13px] text-slate-400">
                    No metrics match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedRow && (
        <MetricDetailDrawer
          row={selectedRow}
          onClose={() => setSelectedMetric(null)}
        />
      )}
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={clsx("px-3 py-2.5 font-semibold", className)}>{children}</th>;
}

/** Calm result chip — subtle tint + dot, not a heavy filled block. */
function ResultChip({ result, outcome }: { result?: MetricResultState; outcome?: MetricOutcome }) {
  const state = result ?? (outcome === "passed" ? "passed" : outcome === "failed" ? "failed" : "manual_review");
  const label = state === "manual_review" ? "Manual review" : state.charAt(0).toUpperCase() + state.slice(1);
  const dot =
    state === "passed" ? "bg-emerald-500"
      : state === "failed" ? "bg-slate-500"
        : state === "warning" ? "bg-amber-500"
          : "bg-violet-500";
  const text =
    state === "passed" ? "text-emerald-700 dark:text-emerald-400"
      : state === "failed" ? "text-slate-700 dark:text-slate-300"
        : state === "warning" ? "text-amber-700 dark:text-amber-400"
          : "text-violet-700 dark:text-violet-300";
  return (
    <span className={clsx("inline-flex items-center gap-1.5 text-[12px] font-semibold", text)}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", dot)} aria-hidden />
      {label}
    </span>
  );
}

function MetricDetailDrawer({
  row, onClose,
}: {
  row: MetricTableRow;
  onClose: () => void;
}) {
  const { metric, config, plan } = row;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/20" role="dialog" aria-modal="true" aria-label="Metric detail">
      <button className="flex-1 cursor-default" aria-label="Close metric detail" onClick={onClose} />
      <aside className="h-full w-full max-w-[680px] overflow-y-auto border-l border-hairline dark:border-white/10 bg-white dark:bg-slate-950 shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-hairline dark:border-white/10 bg-white/95 dark:bg-slate-950/95 px-5 py-4 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] text-slate-400">{metric.metric_id}</p>
              <h3 className="mt-1 text-[18px] font-semibold leading-snug text-ink dark:text-white">{row.name}</h3>
            </div>
            <button onClick={onClose} className="rounded-lg border border-hairline dark:border-slate-700 px-2.5 py-1.5 text-[12px] font-medium text-slate-500 hover:text-ink dark:hover:text-white">Close</button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ResultChip result={row.result} />
            <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300">{humanizeDimension(metric.dimension)}</span>
            <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300">{toolLabel(row.tool)}</span>
          </div>
        </div>

        <div className="space-y-5 px-5 py-5">
          <DrawerSection title="Metric definition">
            <MetricDetailSections metric={metric} config={config} plan={plan} showTechnicalFooter={false} />
          </DrawerSection>
          <section className="grid grid-cols-3 gap-2">
            <DetailStat label="Raw score" value={formatScore(metric.raw_score)} />
            <DetailStat label="Normalized" value={formatScore(metric.normalized_score)} />
            <DetailStat label="Threshold" value={formatScore(metric.threshold)} />
          </section>

          <DrawerSection title="Score and threshold">
            <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">{scoreExplanation(metric, row.result)}</p>
          </DrawerSection>

          <DrawerSection title="Assurance method">
            <p className="text-[13px] text-slate-700 dark:text-slate-300">{toolLabel(row.tool)}</p>
          </DrawerSection>

          <DrawerSection title={`Evidence records (${metric.evidence_ids.length})`}>
            {metric.evidence_ids.length === 0 ? (
              <p className="text-[13px] text-slate-400">No evidence records are linked to this metric result.</p>
            ) : (
              <div className="space-y-2">
                {metric.evidence_ids.map((id) => {
                  const evidence = row.evidence.find((e) => e.id === id);
                  return evidence ? <EvidenceRecordRow key={id} evidence={evidence} /> : (
                    <p key={id} className="truncate rounded-lg bg-slate-50 dark:bg-slate-900 px-3 py-2 font-mono text-[11px] text-slate-500 dark:text-slate-400">{id}</p>
                  );
                })}
              </div>
            )}
          </DrawerSection>

          <DrawerSection title={`Linked findings (${row.findings.length})`}>
            {row.findings.length === 0 ? (
              <p className="text-[13px] text-slate-400">No findings are linked to this metric.</p>
            ) : (
              <div className="space-y-2">
                {row.findings.map((finding) => <FindingRow key={finding.id} finding={finding} />)}
              </div>
            )}
          </DrawerSection>

          <DrawerSection title={`Framework mappings (${row.mappings.length})`}>
            {row.mappings.length === 0 ? (
              <p className="text-[13px] text-slate-400">No framework mapping is linked to this metric.</p>
            ) : (
              <div className="space-y-1.5">
                {row.mappings.map((mapping) => (
                  <div key={mapping.key} className="rounded-lg border border-hairline dark:border-white/10 px-3 py-2">
                    <p className="text-[12px] font-semibold text-slate-800 dark:text-slate-200">
                      {frameworkLabel(mapping.frameworkId)}{mapping.controlRef ? ` - ${mapping.controlRef}` : ""}
                    </p>
                    {mapping.title && <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">{mapping.title}</p>}
                  </div>
                ))}
              </div>
            )}
          </DrawerSection>

          <details className="rounded-xl border border-hairline dark:border-white/10 px-4 py-3">
            <summary className="cursor-pointer text-[12px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
              Technical metadata
            </summary>
            <dl className="mt-3 grid grid-cols-1 gap-2 text-[12px] sm:grid-cols-2">
              <MetaItem label="Metric result ID" value={metric.id} mono />
              <MetaItem label="Run ID" value={metric.run_id} mono />
              <MetaItem label="Recorded" value={formatTimestamp(metric.created_at)} />
              <MetaItem label="Backend status" value={metric.status || "n/a"} />
              {metric.ai_system_capability_id && <MetaItem label="Capability ID" value={metric.ai_system_capability_id} mono />}
              {row.evidence.flatMap((e) => e.trace_id ? [e.trace_id] : []).map((traceId) => (
                <MetaItem key={traceId} label="Trace ID" value={traceId} mono />
              ))}
            </dl>
          </details>
        </div>
      </aside>
    </div>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-hairline dark:border-white/10 px-3 py-2.5">
      <p className="text-[10px] font-medium text-slate-400">{label}</p>
      <p className="mt-1 font-mono text-[16px] font-semibold text-ink dark:text-white">{value}</p>
    </div>
  );
}

function FilterSelect({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-lg border border-hairline dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 text-[12px] font-medium text-slate-600 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-200 dark:focus:ring-brand-700/40"
      >
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </label>
  );
}

function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-hairline dark:border-white/10 p-4">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{title}</p>
      {children}
    </section>
  );
}

function EvidenceRecordRow({ evidence }: { evidence: EvidenceRecord }) {
  const result = evidence.passed === true ? "Passed" : evidence.passed === false ? "Failed" : "Manual review";
  return (
    <div className="rounded-lg border border-hairline dark:border-white/10 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[13px] font-medium text-ink dark:text-white">{toolLabel(evidence.tool_name ?? evidence.source_name)}</p>
        <span className="text-[12px] font-semibold text-slate-600 dark:text-slate-300">{result}</span>
      </div>
      <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
        {evidenceTypeLabel(evidence.source_type)}
        {evidence.normalized_score != null && ` · score ${formatScore(evidence.normalized_score)}`}
      </p>
    </div>
  );
}

function FindingRow({ finding }: { finding: BackendFinding }) {
  return (
    <div className="rounded-lg border border-hairline dark:border-white/10 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[13px] font-medium text-ink dark:text-white">{finding.title}</p>
        <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {finding.severity}
        </span>
        <span className="text-[11px] text-slate-400">{finding.status}</span>
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">{finding.summary}</p>
    </div>
  );
}

function MetaItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</dt>
      <dd className={clsx("mt-0.5 truncate text-slate-600 dark:text-slate-300", mono && "font-mono text-[11px]")} title={value}>{value}</dd>
    </div>
  );
}

function metricResultState(metric: MetricResult): MetricResultState {
  const status = metric.status.toLowerCase();
  if (status === "warning" || status === "warn") return "warning";
  const outcome = metricOutcome(metric);
  if (outcome === "passed" || outcome === "failed") return outcome;
  return "manual_review";
}

function metricToolLabel(metric: MetricResult, config: MetricConfigFull | null, plan: RunMetricPlanEntry | null): string {
  return displayToolName(metric.tool_name ?? config?.tool_name ?? plan?.tool_name ?? null);
}

function displayToolName(tool: string | null | undefined): string {
  return toolLabel(tool);
}

// Auditor-friendly evidence-type label: drop the leading engine-tool token from
// source_type (e.g. "deepeval_llm_judge" → "LLM judge", "ragas_rag_probe" →
// "RAG probe") so the auditor reads the kind of evidence, not the vendor tool.
const _EVIDENCE_TOOL_TOKENS = new Set([
  "deepeval", "ragas", "garak", "presidio", "pyrit", "langfuse", "evidently", "promptfoo", "inspect", "vision", "audio",
]);
function evidenceTypeLabel(sourceType: string): string {
  const parts = sourceType.split(/[_-]+/).filter(Boolean);
  const rest = parts.length > 1 && _EVIDENCE_TOOL_TOKENS.has(parts[0].toLowerCase()) ? parts.slice(1) : parts;
  return rest
    .map((w) => (/^(llm|rag|pii|ai)$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

function humanizeToken(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatScore(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "n/a";
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function scoreExplanation(metric: MetricResult, result: MetricResultState): string {
  const normalized = formatScore(metric.normalized_score);
  const threshold = formatScore(metric.threshold);
  if (metric.normalized_score == null || metric.threshold == null) {
    return `The backend did not record both a normalized score and a threshold for this metric. The current result is ${resultLabel(result)}.`;
  }
  const direction = metric.normalized_score >= metric.threshold ? "met or exceeded" : "was below";
  return `The normalized score was ${normalized}; the configured threshold was ${threshold}. The score ${direction} the threshold, so the recorded result is ${resultLabel(result)}.`;
}

function resultLabel(result: MetricResultState): string {
  return result === "manual_review" ? "manual review" : result;
}

function metricMappings(
  metricId: string,
  controls: FrameworkControlAssessment[],
  config: MetricConfigFull | null,
  plan: RunMetricPlanEntry | null,
): MetricFrameworkMapping[] {
  const byKey = new Map<string, MetricFrameworkMapping>();
  for (const control of controls) {
    const linked = control.metric_ids.includes(metricId) || control.metric_results.some((m) => m.metric_id === metricId);
    if (!linked) continue;
    const key = `${control.framework_id}:${control.control_ref}`;
    byKey.set(key, {
      key,
      frameworkId: control.framework_id,
      controlRef: control.control_ref,
      title: control.control_title ?? null,
    });
  }
  if (byKey.size === 0) {
    const frameworks = config?.framework_ids.length ? config.framework_ids : plan?.framework_ids ?? [];
    for (const fw of frameworks) byKey.set(fw, { key: fw, frameworkId: fw });
  }
  return Array.from(byKey.values()).sort((a, b) => a.frameworkId.localeCompare(b.frameworkId) || (a.controlRef ?? "").localeCompare(b.controlRef ?? ""));
}

function linkedFindings(metric: MetricResult, findings: BackendFinding[]): BackendFinding[] {
  const evidenceIds = new Set(metric.evidence_ids);
  return findings.filter((finding) => {
    if (finding.evidence_ids.some((id) => evidenceIds.has(id))) return true;
    const calls = finding.payload?.tool_calls;
    return Array.isArray(calls) && calls.some((call) => {
      return typeof call === "object" && call !== null && "metric_id" in call && call.metric_id === metric.metric_id;
    });
  });
}

/* ────────────────────────────────────────────────────────── Evidence ── */

// Evidence tab removed — it duplicated the Metrics tab (one record per metric).
// Evidence stays reachable in context: the metric drawer's "Evidence records"
// and the Compliance control drawer's "Evidence summary". A sealed-record count
// is surfaced on the Summary tab.

/* ─────────────────────────────────────────────────────────── History ── */

const HISTORY_LIMIT = 30;
const RUN_STATUS_META: Record<string, { label: string; tone: string }> = {
  completed: { label: "Completed", tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
  report_ready: { label: "Completed", tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
  failed: { label: "Failed", tone: "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-300" },
  cancelled: { label: "Cancelled", tone: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" },
};

function runStatusMeta(status: string): { label: string; tone: string } {
  if (RUN_STATUS_META[status]) return RUN_STATUS_META[status];
  if (IN_FLIGHT_STATUSES.has(status)) return { label: "Running", tone: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300" };
  return { label: status.replace(/[_-]/g, " "), tone: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" };
}

function HistoryTab({ appId, currentRunId }: { appId: string; currentRunId: string | null }) {
  const [runs, setRuns] = useState<EvaluationRun[] | null>(null);
  const [verdicts, setVerdicts] = useState<Map<string, Verdict | null>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRuns(null);
    setError(null);
    (async () => {
      try {
        const all = await listEvaluationRuns(50);
        if (cancelled) return;
        const mine = all
          .filter((r) => r.ai_system_id === appId)
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
          .slice(0, HISTORY_LIMIT);
        setRuns(mine);
        const entries = await Promise.all(mine.map(async (r) => [r.id, await getRunVerdict(r.id)] as const));
        if (!cancelled) setVerdicts(new Map(entries));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load run history.");
      }
    })();
    return () => { cancelled = true; };
  }, [appId]);

  if (error) return <PanelNote>{error}</PanelNote>;
  if (!runs) return <AuditorSkeleton rows={3} />;
  if (runs.length === 0) return <PanelNote>No assessments have been run for this application yet.</PanelNote>;

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-slate-500 dark:text-slate-400">
        {runs.length === HISTORY_LIMIT
          ? `Most recent ${HISTORY_LIMIT} assessments, newest first.`
          : `${runs.length} assessment${runs.length === 1 ? "" : "s"}, newest first.`}
      </p>
      <ol className="relative border-l border-hairline dark:border-white/10 pl-5">
        {runs.map((r) => (
          <HistoryRow key={r.id} run={r} verdict={verdicts.get(r.id) ?? null} isCurrent={r.id === currentRunId} />
        ))}
      </ol>
    </div>
  );
}

const HISTORY_DOT: Record<string, string> = {
  compliant: "bg-emerald-500",
  conditional: "bg-amber-500",
  not_compliant: "bg-red-500",
  under_review: "bg-violet-500",
  in_progress: "bg-blue-500",
  not_assessed: "bg-slate-300 dark:bg-slate-600",
};

function HistoryRow({ run, verdict, isCurrent }: { run: EvaluationRun; verdict: Verdict | null; isCurrent: boolean }) {
  const status = runStatusMeta(run.status);
  const runInFlight = IN_FLIGHT_STATUSES.has(run.status);
  const client = verdictToClient(verdict?.label ?? null, {
    actionTier: verdict?.action_tier ?? null,
    hasTerminalRun: verdict != null,
    runInFlight,
  });
  const when = new Date(run.created_at);
  const hasVerdict = verdict != null || runInFlight;
  const dot = HISTORY_DOT[client.key] ?? "bg-slate-300 dark:bg-slate-600";
  const conf = verdict?.confidence_score;
  return (
    <li className="relative mb-3 last:mb-0">
      <span className={clsx("absolute -left-[27px] top-3 h-3 w-3 rounded-full ring-4 ring-[#f6f7f9] dark:ring-slate-950", dot)} aria-hidden />
      <div className={clsx(
        "rounded-xl border px-4 py-3 transition-colors",
        isCurrent
          ? "border-brand-300 bg-brand-50/40 dark:border-brand-800/70 dark:bg-brand-950/20"
          : "border-hairline bg-white dark:border-white/10 dark:bg-slate-900",
      )}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {hasVerdict ? <VerdictPill meta={client} size="sm" /> : <span className="text-[12px] font-medium text-slate-400">No verdict recorded</span>}
          <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-medium", status.tone)}>{status.label}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400 dark:text-slate-500">
          <span className="font-medium text-slate-500 dark:text-slate-400" title={when.toLocaleString()}>
            {when.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}, {when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
          </span>
          <span>· {timeAgo(run.created_at)}</span>
          {isCurrent && (
            <span className="rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">Current assessment</span>
          )}
        </div>
        {conf != null && (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div className="h-full rounded-full bg-slate-400 dark:bg-slate-500" style={{ width: `${Math.round(conf * 100)}%` }} />
            </div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">{Math.round(conf * 100)}% engine confidence</span>
          </div>
        )}
      </div>
    </li>
  );
}

/* ───────────────────────────────────────────────────────────── util ── */

/** Subtle link to the (rail-hidden) Assurance Tools reference — so an auditor
 * can learn what a method means without a standalone catalog in the sidebar. */
function MethodsRefLink() {
  const navigateTo = useAppStore((s) => s.navigateTo);
  return (
    <button
      onClick={() => navigateTo("/assurance-tools")}
      className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-brand-700 dark:text-brand-400 hover:underline"
    >
      About these methods
      <ChevronRight className="h-3 w-3" aria-hidden />
    </button>
  );
}

function PanelNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-[13px] text-slate-500 dark:text-slate-400">
      {children}
    </div>
  );
}
