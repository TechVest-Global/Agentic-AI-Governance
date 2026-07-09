import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  Download,
  FileSearch,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import clsx from "clsx";
import { useAppStore } from "@/store/useAppStore";
import { useSelectionStore } from "@/store/useSelectionStore";
import { useAuditorApplication } from "@/hooks/useAuditorApplication";
import { useComplianceMatrix } from "@/hooks/useComplianceMatrix";
import { FrameworkExplorer } from "./FrameworkExplorer";
import { MetricDetailSections } from "./MetricDetail";
import {
  getRunVerdict,
  listEvaluationRuns,
  listMetricConfigs,
  type EvaluationRun,
  type EvidenceRecord,
  type GovernanceReport,
  type MetricConfigFull,
  type MetricResult,
  type RunMetricPlanEntry,
  type Verdict,
} from "@/api/governanceApi";
import { AuditorSkeleton, BackendError, timeAgo } from "./components";
import {
  RiskDot,
  StatTile,
  Tabs,
  VerdictPill,
  frameworkLabel,
  humanizeDimension,
  metricOutcome,
  metricOutcomeMeta,
  metricFailed,
  metricPassed,
  verdictToClient,
  type MetricOutcome,
  type TabDef,
} from "./clientComponents";

/**
 * Application record — a single AI application's assurance detail. Read-only.
 * Opening an application lands on Frameworks: the auditor picks a framework and
 * drills into its clauses (FrameworkExplorer), matching the app → framework →
 * controls flow. Summary / Metrics / Evidence remain as flat views. The selected
 * application id comes from the shared selection store (set when opening a card
 * on the Applications list). Footer actions: Request re-assessment (a request
 * only, currently unavailable) and Export report (client-side download).
 */

const TAB_IDS = ["frameworks", "summary", "metrics", "evidence", "history"] as const;
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
  const matrix = useComplianceMatrix();
  const [tab, setTab] = useState<TabId>("frameworks");

  // No application selected (e.g. deep link / refresh) → send back to the list.
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
  // Normalized dimension count — matches the Metrics tab roll-up (collapses
  // mixed backend taxonomies) so Summary and Metrics agree.
  const dimensionCount = new Set((app.report?.metric_results ?? []).map((m) => humanizeDimension(m.dimension))).size;

  const tabs: TabDef[] = [
    { id: "frameworks", label: "Frameworks", count: system.selected_frameworks.length || undefined },
    { id: "summary", label: "Summary" },
    { id: "metrics", label: "Metrics", count: metricCounts.total || undefined },
    { id: "evidence", label: "Evidence", count: app.report?.evidence.length || undefined },
    { id: "history", label: "History" },
  ];

  // Frameworks assessed for this app, in the app's declared order; controls come
  // from the shared compliance matrix (same hydrated clause data as Compliance).
  const frameworkList = system.selected_frameworks;

  return (
    <div className="space-y-5">
      <BackLink onClick={() => navigateTo("/applications")} />

      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-[22px] leading-tight text-ink dark:text-white">{system.name}</h1>
            <VerdictPill meta={verdict} />
            <RiskDot tier={system.risk_tier} />
          </div>
          <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">
            <span className="capitalize">{system.system_type.replace(/[_-]/g, " ")}</span>
            {system.owner && <> · {system.owner}</>}
            {app.assessedRun && <> · last assessed {timeAgo(app.assessedRun.created_at)}</>}
          </p>
        </div>
        <FooterActions report={app.report} system={system} />
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
            {tab === "frameworks" && (
              <FrameworkExplorer
                frameworks={frameworkList}
                controlsFor={(fw) => matrix.cell(fw, appId).controls}
              />
            )}
            {tab === "summary" && <SummaryTab app={app} verdictText={verdict.text} metricCounts={metricCounts} dimensionCount={dimensionCount} />}
            {tab === "metrics" && <MetricsTab report={app.report} />}
            {tab === "evidence" && <EvidenceTab evidence={app.report?.evidence ?? []} />}
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

/* ───────────────────────────────────────────────────── footer actions ── */

function FooterActions({ report, system }: { report: GovernanceReport | null; system: { name: string } }) {
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
    <div className="flex items-center gap-2">
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

function SummaryTab({
  app, verdictText, metricCounts, dimensionCount,
}: {
  app: ReturnType<typeof useAuditorApplication>;
  verdictText: string;
  metricCounts: { passed: number; total: number };
  dimensionCount: number;
}) {
  const verdict = app.report?.verdict;
  const failedMetrics = app.report?.metric_results.filter(metricFailed).length ?? 0;
  const needsReviewMetrics = Math.max(metricCounts.total - metricCounts.passed - failedMetrics, 0);
  const plain = plainLanguageVerdict(verdictText, app.report, {
    total: metricCounts.total,
    passed: metricCounts.passed,
    failed: failedMetrics,
    needsReview: needsReviewMetrics,
  });
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Overall verdict" value={<span className="text-[18px]">{verdictText}</span>}
          tone={verdictText === "Compliant" ? "good" : verdictText === "Not compliant" ? "danger" : verdictText === "Conditional" ? "warn" : "default"} />
        <StatTile label="Metrics passed" value={`${metricCounts.passed}/${metricCounts.total}`} />
        <StatTile label="Dimensions assessed" value={dimensionCount} />
        <StatTile label="Last assessed" value={<span className="text-[15px]">{app.assessedRun ? timeAgo(app.assessedRun.created_at) : "—"}</span>} />
      </div>

      {/* Lead with the answer */}
      <div className="rounded-xl border border-hairline dark:border-white/10 bg-white dark:bg-slate-900 p-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-700 dark:text-brand-400">What this means</p>
        <p className="mt-2 text-[14px] leading-relaxed text-ink dark:text-slate-200">{plain}</p>
        {verdict?.synthesis && (
          <p className="mt-3 border-t border-hairline dark:border-white/10 pt-3 text-[13px] leading-relaxed text-slate-600 dark:text-slate-400">
            {verdict.synthesis}
          </p>
        )}
      </div>
    </div>
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
    ? `${metricCounts.failed} of ${metricCounts.total} assessed checks failed`
    : "No metric checks are available yet";
  switch (verdictText) {
    case "Compliant":
      return "This application meets the assessed requirements. No blocking issues were found across the evaluated dimensions.";
    case "Conditional":
      return `This application is broadly compliant but has open items that need attention${topDim ? `, most notably around ${topDim.toLowerCase()}` : ""}. It can proceed with the noted conditions addressed.`;
    case "Not compliant":
      return `This application does not currently meet the assessed requirements${topDim ? ` — the main blocker is in ${topDim.toLowerCase()}` : ""}. ${critical.length} higher-severity issue${critical.length === 1 ? "" : "s"} must be resolved before it can be considered compliant.`;
    case "Under review":
      return `This assessment is inconclusive and has been routed for human review${typeof confidence === "number" ? ` (engine confidence ${Math.round(confidence * 100)}%)` : ""}. ${metricSummary}; those are real gaps in the assessed requirements. Separately, the overall verdict is unresolved because the engine did not have enough evidence to reach a confident final decision.`;
    case "In progress":
      return "An assessment is currently running for this application. Results will appear here once it completes.";
    default:
      return "This application has not been assessed yet.";
  }
}

/* ─────────────────────────────────────────────────────────── Metrics ── */

function countMetrics(results: MetricResult[]) {
  const passed = results.filter(metricPassed).length;
  return { passed, total: results.length };
}

function MetricsTab({ report }: { report: GovernanceReport | null }) {
  const results = report?.metric_results ?? [];
  const [catalog, setCatalog] = useState<MetricConfigFull[]>([]);
  const [selectedMetric, setSelectedMetric] = useState<MetricResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    listMetricConfigs({ limit: 200 })
      .then((rows) => {
        if (!cancelled) setCatalog(rows);
      })
      .catch(() => {
        if (!cancelled) setCatalog([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const catalogById = useMemo(() => {
    const map = new Map<string, MetricConfigFull>();
    for (const metric of catalog) map.set(metric.metric_id, metric);
    return map;
  }, [catalog]);

  const planById = useMemo(() => {
    const map = new Map<string, RunMetricPlanEntry>();
    for (const metric of report?.metric_plan?.metrics ?? []) map.set(metric.metric_id, metric);
    return map;
  }, [report]);

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of report?.metric_plan?.metrics ?? []) m.set(e.metric_id, e.name);
    for (const e of catalog) m.set(e.metric_id, e.name);
    return m;
  }, [report, catalog]);

  const groups = useMemo(() => {
    // Group by the *normalized* dimension label so mixed backend taxonomies
    // (e.g. "groundedness" and "Groundedness", "fairness" and "Bias and
    // Fairness") collapse into one client-facing dimension instead of showing
    // duplicate rows. Still fully dynamic — no hardcoded metric membership.
    const byDim = new Map<string, MetricResult[]>();
    for (const r of results) {
      const label = humanizeDimension(r.dimension);
      const arr = byDim.get(label) ?? [];
      arr.push(r);
      byDim.set(label, arr);
    }
    return Array.from(byDim.entries())
      .map(([label, rows]) => ({
        label,
        rows,
        passed: rows.filter(metricPassed).length,
        failed: rows.filter(metricFailed).length,
        total: rows.length,
      }))
      .sort((a, b) => a.passed / a.total - b.passed / b.total); // worst first
  }, [results]);

  const assessed = {
    passed: results.filter(metricPassed).length,
    failed: results.filter(metricFailed).length,
    needsReview: results.filter((r) => metricOutcome(r) === "needs_review").length,
    total: results.length,
  };
  const plannedTotal = report?.metric_plan?.metric_count ?? catalog.length;
  const plannedHint = plannedTotal && plannedTotal > assessed.total
    ? `${assessed.total} of ${plannedTotal} catalog checks assessed this run`
    : `${assessed.total} checks assessed this run`;

  if (results.length === 0) {
    return <PanelNote>No metric results are available for this assessment yet.</PanelNote>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Assessed this run" value={`${assessed.total}${plannedTotal && plannedTotal > assessed.total ? `/${plannedTotal}` : ""}`} hint={plannedHint} />
        <StatTile label="Passed" value={assessed.passed} tone={assessed.passed ? "good" : "default"} />
        <StatTile label="Failed" value={assessed.failed} tone={assessed.failed ? "danger" : "default"} />
        <StatTile label="Needs review" value={assessed.needsReview} tone={assessed.needsReview ? "warn" : "default"} />
      </div>

      <div className="rounded-xl border border-hairline dark:border-white/10 bg-white dark:bg-slate-900 px-4 py-3">
        <p className="text-[13px] font-semibold text-ink dark:text-white">Metric checks by dimension</p>
        <p className="mt-1 text-[12px] leading-5 text-slate-500 dark:text-slate-400">
          Each row rolls up the real engine checks for this run. Failed means the normalized score did not meet the configured threshold.
          Expand a dimension, then select a check to see the plain-language detail and framework mapping.
        </p>
      </div>
      {groups.map((g) => (
        <DimensionRow
          key={g.label}
          label={g.label}
          rows={g.rows}
          passed={g.passed}
          failed={g.failed}
          total={g.total}
          nameById={nameById}
          catalogById={catalogById}
          planById={planById}
          onSelectMetric={setSelectedMetric}
        />
      ))}
      {selectedMetric && (
        <MetricDetailDrawer
          metric={selectedMetric}
          name={nameById.get(selectedMetric.metric_id) ?? selectedMetric.metric_id}
          config={catalogById.get(selectedMetric.metric_id) ?? null}
          plan={planById.get(selectedMetric.metric_id) ?? null}
          onClose={() => setSelectedMetric(null)}
        />
      )}
    </div>
  );
}

function DimensionRow({
  label, rows, passed, failed, total, nameById, catalogById, planById, onSelectMetric,
}: {
  label: string;
  rows: MetricResult[];
  passed: number;
  failed: number;
  total: number;
  nameById: Map<string, string>;
  catalogById: Map<string, MetricConfigFull>;
  planById: Map<string, RunMetricPlanEntry>;
  onSelectMetric: (metric: MetricResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const passPct = total ? Math.round((passed / total) * 100) : 0;
  const failPct = total ? Math.round((failed / total) * 100) : 0;
  const allPass = passed === total;
  const statusText = failed > 0 ? `${failed} failed` : allPass ? "All passed" : "Needs review";
  return (
    <div className="rounded-xl border border-hairline dark:border-white/10 bg-white dark:bg-slate-900">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-4 px-4 py-3 text-left"
      >
        <ChevronRight className={clsx("h-4 w-4 shrink-0 text-slate-400 transition-transform", open && "rotate-90")} aria-hidden />
        <span className="w-40 shrink-0 truncate text-[13px] font-semibold text-ink dark:text-white">{label}</span>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div className="flex h-full">
            {passPct > 0 && <div className="h-full bg-emerald-500" style={{ width: `${passPct}%` }} />}
            {failPct > 0 && <div className="h-full bg-red-500" style={{ width: `${failPct}%` }} />}
            {passPct + failPct < 100 && <div className="h-full bg-amber-500" style={{ width: `${100 - passPct - failPct}%` }} />}
          </div>
        </div>
        <span className={clsx("w-28 shrink-0 text-right text-[12px] font-semibold", allPass ? "text-emerald-600 dark:text-emerald-400" : failed > 0 ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400")}>
          {statusText}
        </span>
      </button>
      {open && (
        <div className="border-t border-hairline dark:border-white/10">
          <div className="grid grid-cols-[1fr_120px_120px_160px_90px] gap-3 border-b border-hairline dark:border-white/10 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">
            <span>Check</span>
            <span>Result</span>
            <span>Score</span>
            <span>Frameworks</span>
            <span>Evidence</span>
          </div>
          {rows.map((r) => {
            const outcome = metricOutcome(r);
            const config = catalogById.get(r.metric_id);
            const plan = planById.get(r.metric_id);
            const frameworks = config?.framework_ids.length ? config.framework_ids : plan?.framework_ids ?? [];
            return (
              <button
                key={r.id}
                onClick={() => onSelectMetric(r)}
                className="grid w-full grid-cols-[1fr_120px_120px_160px_90px] items-center gap-3 px-4 py-2.5 text-left text-[12px] hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink dark:text-white">{nameById.get(r.metric_id) ?? r.metric_id}</span>
                  <span className="block font-mono text-[10px] text-slate-400">{r.metric_id}</span>
                </span>
                <MetricOutcomeChip outcome={outcome} />
                <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                  {r.normalized_score != null ? r.normalized_score.toFixed(2) : "—"}
                  {r.threshold != null && <span className="text-slate-300 dark:text-slate-600"> / {r.threshold.toFixed(2)}</span>}
                </span>
                <span className="flex min-w-0 flex-wrap gap-1">
                  {frameworks.slice(0, 2).map((framework) => (
                    <span key={framework} className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500 dark:text-slate-400">{frameworkLabel(framework)}</span>
                  ))}
                  {frameworks.length > 2 && <span className="text-[10px] text-slate-400">+{frameworks.length - 2}</span>}
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">{r.evidence_ids.length ? `${r.evidence_ids.length} linked` : "None"}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────── Evidence ── */

function MetricOutcomeChip({ outcome }: { outcome: MetricOutcome }) {
  const meta = metricOutcomeMeta(outcome);
  const tone =
    outcome === "passed"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
      : outcome === "failed"
        ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
        : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300";
  return <span className={clsx("w-fit rounded-full border px-2 py-0.5 text-[11px] font-semibold", tone)}>{meta.label}</span>;
}

function MetricDetailDrawer({
  metric,
  name,
  config,
  plan,
  onClose,
}: {
  metric: MetricResult;
  name: string;
  config: MetricConfigFull | null;
  plan: RunMetricPlanEntry | null;
  onClose: () => void;
}) {
  const outcome = metricOutcome(metric);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/20" role="dialog" aria-modal="true" aria-label="Metric detail">
      <button className="flex-1 cursor-default" aria-label="Close metric detail" onClick={onClose} />
      <aside className="h-full w-full max-w-[480px] overflow-y-auto border-l border-hairline dark:border-white/10 bg-white dark:bg-slate-950 shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-hairline dark:border-white/10 bg-white/95 dark:bg-slate-950/95 px-5 py-4 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] text-slate-400">{metric.metric_id}</p>
              <h3 className="mt-1 text-[18px] font-semibold leading-snug text-ink dark:text-white">{name}</h3>
            </div>
            <button onClick={onClose} className="rounded-lg border border-hairline dark:border-slate-700 px-2.5 py-1.5 text-[12px] font-medium text-slate-500 hover:text-ink dark:hover:text-white">Close</button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <MetricOutcomeChip outcome={outcome} />
            <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300">{humanizeDimension(metric.dimension)}</span>
          </div>
        </div>

        <div className="space-y-5 px-5 py-5">
          <MetricDetailSections metric={metric} config={config} plan={plan} />

          <section className="grid grid-cols-3 gap-2">
            <DetailStat label="Normalized" value={metric.normalized_score != null ? metric.normalized_score.toFixed(2) : "n/a"} />
            <DetailStat label="Threshold" value={metric.threshold != null ? metric.threshold.toFixed(2) : "n/a"} />
            <DetailStat label="Raw score" value={metric.raw_score != null ? metric.raw_score.toFixed(2) : "n/a"} />
          </section>

          {metric.evidence_ids.length > 0 && (
            <section className="rounded-xl border border-hairline dark:border-white/10 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Linked evidence records</p>
              <div className="mt-2 space-y-1.5">
                {metric.evidence_ids.map((id) => (
                  <p key={id} className="truncate rounded bg-slate-50 dark:bg-slate-900 px-2 py-1 font-mono text-[11px] text-slate-500 dark:text-slate-400">{id}</p>
                ))}
              </div>
            </section>
          )}
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

function EvidenceTab({ evidence }: { evidence: EvidenceRecord[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (evidence.length === 0) return <PanelNote>No evidence artifacts are available for this assessment yet.</PanelNote>;
  return (
    <div className="space-y-2">
      <p className="text-[12px] text-slate-500 dark:text-slate-400">{evidence.length} sealed evidence records. Read-only.</p>
      {evidence.map((e) => {
        const open = openId === e.id;
        return (
          <div key={e.id} className="rounded-xl border border-hairline dark:border-white/10 bg-white dark:bg-slate-900">
            <button onClick={() => setOpenId(open ? null : e.id)} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-2.5 text-left">
              <FileSearch className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-ink dark:text-white">{e.source_name}</p>
                <p className="truncate text-[11px] text-slate-400">{e.tool_name ?? e.source_type} · {timeAgo(e.created_at)}</p>
              </div>
              {e.sensitivity && (
                <span className="shrink-0 rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium capitalize text-slate-500 dark:text-slate-400">
                  {e.sensitivity}
                </span>
              )}
              <span className={clsx("w-14 shrink-0 text-right text-[11px] font-semibold",
                e.passed === true ? "text-emerald-600 dark:text-emerald-400" : e.passed === false ? "text-red-600 dark:text-red-400" : "text-slate-400")}>
                {e.passed === true ? "Pass" : e.passed === false ? "Fail" : "N/A"}
              </span>
            </button>
            {open && (
              <div className="border-t border-hairline dark:border-white/10 px-4 py-3 text-[12px]">
                <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-slate-600 dark:text-slate-300">
                  <Detail k="Source type" v={e.source_type} />
                  <Detail k="Tool" v={e.tool_name ?? "—"} />
                  <Detail k="Score" v={e.normalized_score != null ? `${e.normalized_score.toFixed(2)}${e.threshold != null ? ` / ${e.threshold.toFixed(2)}` : ""}` : "—"} />
                  <Detail k="Trace id" v={e.trace_id ?? "—"} mono />
                </dl>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Detail({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-24 shrink-0 text-slate-400">{k}</dt>
      <dd className={clsx("truncate", mono && "font-mono text-[11px]")}>{v}</dd>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── History ── */

// Cap the history list (and its per-run verdict fetches) to the most recent runs.
const HISTORY_LIMIT = 30;

const RUN_STATUS_META: Record<string, { label: string; tone: string }> = {
  completed: { label: "Completed", tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
  report_ready: { label: "Completed", tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
  failed: { label: "Failed", tone: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300" },
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
        // Fetch each run's verdict (lightweight) so the row shows the same
        // tier-first client verdict as the rest of the workspace.
        const entries = await Promise.all(
          mine.map(async (r) => [r.id, await getRunVerdict(r.id)] as const),
        );
        if (!cancelled) setVerdicts(new Map(entries));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load run history.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appId]);

  if (error) return <PanelNote>{error}</PanelNote>;
  if (!runs) return <AuditorSkeleton rows={3} />;
  if (runs.length === 0) return <PanelNote>No assessments have been run for this application yet.</PanelNote>;

  return (
    <div className="space-y-2">
      <p className="text-[12px] text-slate-500 dark:text-slate-400">
        {runs.length === HISTORY_LIMIT
          ? `Most recent ${HISTORY_LIMIT} assessments for this application, newest first. Read-only.`
          : `${runs.length} assessment${runs.length === 1 ? "" : "s"} run for this application, newest first. Read-only.`}
      </p>
      {runs.map((r) => (
        <HistoryRow key={r.id} run={r} verdict={verdicts.get(r.id) ?? null} isCurrent={r.id === currentRunId} />
      ))}
    </div>
  );
}

function HistoryRow({ run, verdict, isCurrent }: { run: EvaluationRun; verdict: Verdict | null; isCurrent: boolean }) {
  const status = runStatusMeta(run.status);
  const runInFlight = IN_FLIGHT_STATUSES.has(run.status);
  const client = verdictToClient(verdict?.label ?? null, {
    actionTier: verdict?.action_tier ?? null,
    hasTerminalRun: verdict != null,
    runInFlight,
  });
  const when = new Date(run.created_at);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-hairline dark:border-white/10 bg-white dark:bg-slate-900 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-ink dark:text-white" title={when.toLocaleString()}>
            {when.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
            {", "}
            {when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
          </span>
          <span className="text-[11px] text-slate-400">· {timeAgo(run.created_at)}</span>
          {isCurrent && (
            <span className="rounded-full bg-brand-50 dark:bg-brand-950/40 px-2 py-0.5 text-[10px] font-semibold text-brand-700 dark:text-brand-300">Current</span>
          )}
        </div>
        <p className="mt-0.5 font-mono text-[10px] text-slate-400">run {run.id.slice(0, 8)}</p>
      </div>
      {verdict != null || runInFlight ? <VerdictPill meta={client} size="sm" /> : <span className="text-[11px] text-slate-400">No verdict</span>}
      <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-medium", status.tone)}>{status.label}</span>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── util ── */

function PanelNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-[13px] text-slate-500 dark:text-slate-400">
      {children}
    </div>
  );
}
