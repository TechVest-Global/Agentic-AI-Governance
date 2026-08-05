import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import clsx from "clsx";
import {
  getFrameworkMap,
  listMetricConfigs,
  type FrameworkControlAssessment,
  type MetricConfigFull,
  type MetricResult,
  type RunMetricPlanEntry,
} from "@/api/governanceApi";
import { MetricDetailSections } from "./MetricDetail";
import { dimensionInfo } from "./assuranceCopy";
import {
  frameworkLabel,
  humanizeDimension,
  metricOutcome,
  toolLabel,
} from "./clientComponents";

type CtrlStatus = "passed" | "failed" | "needs_review" | "manual";
type StatusFilter = "all" | CtrlStatus;

type FrameworkId = "eu_ai_act" | "iso_42001" | "nist_ai_rmf" | "owasp_llm_top_10";

const FRAMEWORKS: FrameworkId[] = ["eu_ai_act", "iso_42001", "nist_ai_rmf", "owasp_llm_top_10"];

const FRAMEWORK_SUBTITLE: Record<FrameworkId, string> = {
  eu_ai_act: "Grouped by article",
  iso_42001: "Grouped by control objective",
  nist_ai_rmf: "Grouped by function",
  owasp_llm_top_10: "Grouped by risk category",
};

const FRAMEWORK_DESCRIPTION: Record<FrameworkId, string> = {
  eu_ai_act: "EU regulatory obligations for high-risk AI, including risk management, transparency, oversight, and technical documentation.",
  iso_42001: "AI management system controls covering governance, operating controls, accountability, and continual improvement.",
  nist_ai_rmf: "Risk management functions that organise governance, mapping, measurement, and management of AI risks.",
  owasp_llm_top_10: "Security risk categories for LLM applications, including prompt injection, leakage, supply-chain, and agent risks.",
};

// "evidently" is deliberately absent: CM-030/031/032 are now scored by a real
// perturbation experiment against the target, and databases seeded before that
// change still store the old tool name. Listing it here would file automated
// results under "manual review".
const NON_AUTOMATED_TOOLS = new Set(["langfuse", "promptfoo"]);
const STATUS_SORT: Record<CtrlStatus, number> = { failed: 0, needs_review: 1, manual: 2, passed: 3 };
const FILTERS: Array<[StatusFilter, string]> = [
  ["all", "All controls"],
  ["failed", "Failed"],
  ["needs_review", "Warning"],
  ["passed", "Passed"],
  ["manual", "Manual review"],
];

type Counts = Record<CtrlStatus, number> & { total: number };
type ControlView = {
  control: FrameworkControlAssessment;
  status: CtrlStatus;
  score: number | null;
  threshold: number | null;
  evidenceCount: number;
  mappedMetricCount: number;
  dimension: string;
  tool: string;
  displayCode: string;
};

export function ControlAssurance({
  frameworks,
  metricResults,
  lastAssessed,
  plan = [],
  runId,
}: {
  frameworks: string[];
  metricResults: MetricResult[];
  lastAssessed?: string | null;
  plan?: RunMetricPlanEntry[];
  runId?: string | null;
}) {
  const [selectedFw, setSelectedFw] = useState<FrameworkId>(firstSelectedFramework(frameworks));
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [selectedControl, setSelectedControl] = useState<ControlView | null>(null);
  const [controls, setControls] = useState<FrameworkControlAssessment[]>([]);
  const [catalog, setCatalog] = useState<MetricConfigFull[]>([]);

  useEffect(() => {
    let cancelled = false;
    listMetricConfigs({ limit: 200 })
      .then((rows) => { if (!cancelled) setCatalog(rows); })
      .catch(() => { if (!cancelled) setCatalog([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!runId) {
      setControls([]);
      return () => { cancelled = true; };
    }
    getFrameworkMap(runId)
      .then((map) => { if (!cancelled) setControls(map.controls); })
      .catch(() => { if (!cancelled) setControls([]); });
    return () => { cancelled = true; };
  }, [runId]);

  const configById = useMemo(() => {
    const m = new Map<string, MetricConfigFull>();
    for (const c of catalog) m.set(c.metric_id, c);
    return m;
  }, [catalog]);
  const planById = useMemo(() => {
    const m = new Map<string, RunMetricPlanEntry>();
    for (const p of plan) m.set(p.metric_id, p);
    return m;
  }, [plan]);

  const metricBackedControls = useMemo(
    () => controlsFromMetrics(metricResults, configById, planById, controls),
    [metricResults, configById, planById, controls],
  );

  const allControls = metricBackedControls.length > 0 ? metricBackedControls : controls;
  const viewsByFramework = useMemo(() => {
    const map = new Map<FrameworkId, ControlView[]>();
    for (const fw of FRAMEWORKS) {
      const rows = allControls
        .filter((control) => control.framework_id === fw)
        .map((control) => toControlView(control, configById, planById))
        .sort((a, b) => STATUS_SORT[a.status] - STATUS_SORT[b.status] || a.control.control_ref.localeCompare(b.control.control_ref));
      assignDimensionCodes(rows);
      map.set(fw, rows);
    }
    return map;
  }, [allControls, configById, planById]);

  const selectedViews = viewsByFramework.get(selectedFw) ?? [];
  const selectedCounts = countViews(selectedViews);
  const filteredViews = selectedViews.filter((row) => filter === "all" || row.status === filter);
  const groupedViews = groupByDimension(filteredViews);
  const selectedControlStillVisible = selectedControl && selectedControl.control.framework_id === selectedFw;

  useEffect(() => {
    if (!FRAMEWORKS.includes(selectedFw)) setSelectedFw(firstSelectedFramework(frameworks));
  }, [frameworks, selectedFw]);

  if (!frameworks.length && metricResults.length === 0 && controls.length === 0) {
    return <Empty>No compliance data is available for this application.</Empty>;
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {FRAMEWORKS.map((fw) => (
          <FrameworkSummaryCard
            key={fw}
            frameworkId={fw}
            selected={fw === selectedFw}
            counts={countViews(viewsByFramework.get(fw) ?? [])}
            onSelect={() => {
              setSelectedFw(fw);
              setFilter("all");
              setSelectedControl(null);
            }}
          />
        ))}
      </div>

      <section className="space-y-4 rounded-xl border border-hairline dark:border-white/10 bg-white dark:bg-slate-900 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold text-ink dark:text-white">{frameworkLabel(selectedFw)}</h2>
            <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">{FRAMEWORK_DESCRIPTION[selectedFw]}</p>
            {lastAssessed && (
              <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">Last assessed {formatDate(lastAssessed)}</p>
            )}
          </div>
          <PostureBadge counts={selectedCounts} />
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Kpi label="Controls assessed" value={selectedCounts.total} />
          <Kpi label="Passed" value={selectedCounts.passed} tone="good" />
          <Kpi label="Failed" value={selectedCounts.failed} tone="danger" />
          <Kpi label="Needs review" value={selectedCounts.needs_review} tone="warn" />
          <Kpi label="Manual review" value={selectedCounts.manual} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {FILTERS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                aria-pressed={filter === key}
                className={clsx(
                  "rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors",
                  filter === key
                    ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950"
                    : "border border-hairline bg-white text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 dark:text-slate-500">Click a control to view evaluation method, gate criteria &amp; tool coverage</p>
        </div>

        <DimensionControlList groups={groupedViews} empty={selectedViews.length === 0 ? "No controls were assessed for this framework in the selected run." : "No controls match this filter."} onOpen={setSelectedControl} />
      </section>

      {selectedControl && selectedControlStillVisible && (
        <ControlDetailDrawer
          view={selectedControl}
          configById={configById}
          planById={planById}
          onClose={() => setSelectedControl(null)}
        />
      )}
    </div>
  );
}

function FrameworkSummaryCard({
  frameworkId,
  selected,
  counts,
  onSelect,
}: {
  frameworkId: FrameworkId;
  selected: boolean;
  counts: Counts;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={clsx(
        "group rounded-xl border bg-white p-4 text-left transition-colors dark:bg-slate-900",
        selected
          ? "border-brand-300 ring-2 ring-brand-100 dark:border-brand-700 dark:ring-brand-900/40"
          : "border-hairline hover:border-brand-200 dark:border-white/10 dark:hover:border-brand-800",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold text-ink dark:text-white">{frameworkLabel(frameworkId)}</h3>
          <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">{FRAMEWORK_SUBTITLE[frameworkId]}</p>
        </div>
        <PostureBadge counts={counts} compact />
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2">
        <MiniCount label="Passed" value={counts.passed} tone="text-emerald-700 dark:text-emerald-400" />
        <MiniCount label="Failed" value={counts.failed} tone="text-slate-700 dark:text-slate-300" />
        <MiniCount label="Review" value={counts.needs_review} tone="text-amber-700 dark:text-amber-400" />
        <MiniCount label="Manual" value={counts.manual} tone="text-slate-500 dark:text-slate-400" />
      </div>

      <ProgressBar counts={counts} />

      <span className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700 dark:text-brand-400">
        View framework <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </button>
  );
}

function DimensionControlList({
  groups,
  empty,
  onOpen,
}: {
  groups: Array<{ dimension: string; rows: ControlView[] }>;
  empty: string;
  onOpen: (row: ControlView) => void;
}) {
  if (groups.length === 0) return <Empty>{empty}</Empty>;
  return (
    <div className="space-y-6">
      {groups.map((group) => {
        const dim = dimensionInfo(group.dimension);
        return (
        <section key={group.dimension}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">{group.dimension}</p>
          {dim && <p className="mb-2 mt-0.5 max-w-3xl text-[12px] leading-relaxed text-slate-400 dark:text-slate-500">{dim.blurb}</p>}
          <div className={clsx("space-y-2.5", !dim && "mt-2")}>
            {group.rows.map((row) => (
              <DimensionControlRow key={`${row.control.framework_id}:${row.control.control_ref}`} row={row} onOpen={() => onOpen(row)} />
            ))}
          </div>
        </section>
        );
      })}
    </div>
  );
}

function DimensionControlRow({ row, onOpen }: { row: ControlView; onOpen: () => void }) {
  const accent =
    row.status === "passed" ? "border-l-emerald-500"
      : row.status === "failed" ? "border-l-slate-500"
        : row.status === "needs_review" ? "border-l-amber-500"
          : "border-l-violet-500";
  return (
    <button
      type="button"
      onClick={onOpen}
      className={clsx(
        "flex w-full items-center gap-3 rounded-lg border border-l-4 border-hairline bg-white px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:border-white/10 dark:bg-slate-900 dark:hover:bg-slate-800/60",
        accent,
      )}
    >
      <span className="shrink-0 rounded bg-slate-900 px-2 py-1 font-mono text-[11px] font-semibold text-white dark:bg-slate-700">{row.displayCode}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink dark:text-white">{row.control.control_title ?? row.control.control_ref}</span>
      <span className="shrink-0 font-mono text-[12px] font-semibold tabular-nums text-slate-700 dark:text-slate-200">{displayPercentOrScore(row.score)}</span>
      <StatusChip status={row.status} />
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
    </button>
  );
}

function ControlDetailDrawer({
  view,
  configById,
  planById,
  onClose,
}: {
  view: ControlView;
  configById: Map<string, MetricConfigFull>;
  planById: Map<string, RunMetricPlanEntry>;
  onClose: () => void;
}) {
  const { control } = view;
  const metrics = control.metric_results ?? [];
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/20" role="dialog" aria-modal="true" aria-label="Control detail">
      <button className="flex-1 cursor-default" aria-label="Close control detail" onClick={onClose} />
      <aside className="h-full w-full max-w-[700px] overflow-y-auto border-l border-hairline dark:border-white/10 bg-white dark:bg-slate-950 shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-hairline dark:border-white/10 bg-white/95 dark:bg-slate-950/95 px-5 py-4 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] text-slate-400">{control.control_ref}</p>
              <h3 className="mt-1 text-[18px] font-semibold leading-snug text-ink dark:text-white">{control.control_title ?? "Control"}</h3>
            </div>
            <button onClick={onClose} className="rounded-lg border border-hairline dark:border-slate-700 px-2.5 py-1.5 text-[12px] font-medium text-slate-500 hover:text-ink dark:hover:text-white">Close</button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusChip status={view.status} />
            <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300">{frameworkLabel(control.framework_id)}</span>
            <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300">{view.dimension}</span>
          </div>
        </div>

        <div className="space-y-4 px-5 py-5">
          <DrawerSection title="Why it passed or failed">
            <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">{controlOutcomeExplanation(view)}</p>
          </DrawerSection>

          <DrawerSection title={view.mappedMetricCount === 1 ? "Assessed check" : `Assessed checks (${view.mappedMetricCount})`}>
            {metrics.length === 0 ? (
              <p className="text-[13px] text-slate-400">No metric results are linked to this control.</p>
            ) : (
              <div className="space-y-2">
                {metrics.map((metric) => {
                  const config = configById.get(metric.metric_id) ?? null;
                  return (
                    <div key={metric.id} className="rounded-lg border border-hairline dark:border-white/10 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium text-ink dark:text-white">{config?.name ?? metric.metric_id}</p>
                          <p className="font-mono text-[10px] text-slate-400">{metric.metric_id}</p>
                        </div>
                        <StatusChip status={statusFromMetric(metric, config)} />
                      </div>
                      <div className="mt-2">
                        <MetricDetailSections metric={metric} config={config} plan={planById.get(metric.metric_id) ?? null} showTechnicalFooter={false} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </DrawerSection>

          <DrawerSection title="Evidence summary">
            <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
              {view.evidenceCount} evidence record{view.evidenceCount === 1 ? "" : "s"} linked through {view.mappedMetricCount} mapped metric{view.mappedMetricCount === 1 ? "" : "s"}.
              {control.evidence_requirements.length > 0 && <> Required evidence: {control.evidence_requirements.join(", ")}.</>}
            </p>
          </DrawerSection>
        </div>
      </aside>
    </div>
  );
}

function FrameworklessControl({
  metric,
  fw,
  config,
  plan,
  mappedControl,
}: {
  metric: MetricResult;
  fw: string;
  config: MetricConfigFull | null;
  plan: RunMetricPlanEntry | null;
  mappedControl: FrameworkControlAssessment | null;
}): FrameworkControlAssessment {
  const outcome = metricOutcome(metric);
  return {
    framework_id: fw,
    framework_name: mappedControl?.framework_name ?? frameworkLabel(fw),
    framework_version: mappedControl?.framework_version ?? "",
    control_ref: metric.metric_id,
    control_title: config?.name ?? plan?.name ?? metric.metric_id,
    control_category: config?.dimension ?? metric.dimension,
    jurisdiction: mappedControl?.jurisdiction ?? null,
    requirement_text: config?.description ?? mappedControl?.requirement_text ?? null,
    status: outcome === "passed" ? "passed" : outcome === "failed" ? "failed" : "needs_review",
    metric_ids: [metric.metric_id],
    passed_metric_count: outcome === "passed" ? 1 : 0,
    failed_metric_count: outcome === "failed" ? 1 : 0,
    pending_metric_count: outcome === "needs_review" ? 1 : 0,
    finding_count: mappedControl?.findings.length ?? 0,
    highest_severity: mappedControl?.highest_severity ?? null,
    evidence_requirements: mappedControl?.evidence_requirements ?? [],
    metric_results: [metric],
    findings: mappedControl?.findings ?? [],
  };
}

function controlsFromMetrics(
  metrics: MetricResult[],
  configById: Map<string, MetricConfigFull>,
  planById: Map<string, RunMetricPlanEntry>,
  frameworkControls: FrameworkControlAssessment[],
): FrameworkControlAssessment[] {
  const metricById = new Map(metrics.map((metric) => [metric.metric_id, metric]));
  const mappedRows: FrameworkControlAssessment[] = [];
  const seenMapped = new Set<string>();

  for (const control of frameworkControls) {
    if (!FRAMEWORKS.includes(control.framework_id as FrameworkId)) continue;
    const controlMetrics = control.metric_results.length
      ? control.metric_results
      : control.metric_ids.map((metricId) => metricById.get(metricId)).filter((metric): metric is MetricResult => Boolean(metric));

    for (const metric of controlMetrics) {
      const key = `${control.framework_id}:${metric.metric_id}`;
      if (seenMapped.has(key)) continue;
      seenMapped.add(key);
      mappedRows.push(FrameworklessControl({
        metric,
        fw: control.framework_id,
        config: configById.get(metric.metric_id) ?? null,
        plan: planById.get(metric.metric_id) ?? null,
        mappedControl: control,
      }));
    }
  }

  if (mappedRows.length > 0) return mappedRows;

  const rows: FrameworkControlAssessment[] = [];
  for (const metric of metrics) {
    const config = configById.get(metric.metric_id) ?? null;
    const plan = planById.get(metric.metric_id) ?? null;
    const frameworkIds = config?.framework_ids.length ? config.framework_ids : plan?.framework_ids ?? [];
    for (const fw of frameworkIds.filter((id): id is FrameworkId => FRAMEWORKS.includes(id as FrameworkId))) {
      const mappedControl = frameworkControls.find((control) => {
        if (control.framework_id !== fw) return false;
        return control.metric_ids.includes(metric.metric_id) || control.metric_results.some((result) => result.metric_id === metric.metric_id);
      }) ?? null;
      rows.push(FrameworklessControl({ metric, fw, config, plan, mappedControl }));
    }
  }
  return rows;
}

function toControlView(
  control: FrameworkControlAssessment,
  configById: Map<string, MetricConfigFull>,
  planById: Map<string, RunMetricPlanEntry>,
): ControlView {
  const metrics = control.metric_results ?? [];
  const statuses = metrics.map((metric) => statusFromMetric(metric, configById.get(metric.metric_id) ?? null));
  const status = controlStatus(control, statuses);
  const scored = metrics.filter((metric) => metric.normalized_score != null);
  const thresholded = metrics.filter((metric) => metric.threshold != null);
  return {
    control,
    status,
    score: scored.length ? average(scored.map((metric) => metric.normalized_score as number)) : null,
    threshold: thresholded.length ? average(thresholded.map((metric) => metric.threshold as number)) : null,
    evidenceCount: new Set(metrics.flatMap((metric) => metric.evidence_ids)).size,
    mappedMetricCount: metrics.length || control.metric_ids.length,
    dimension: dimensionForControl(control, configById),
    tool: toolsForControl(control, configById, planById),
    displayCode: control.control_ref,
  };
}

function controlStatus(control: FrameworkControlAssessment, metricStatuses: CtrlStatus[]): CtrlStatus {
  if (control.status === "failed" || metricStatuses.includes("failed")) return "failed";
  if (metricStatuses.includes("needs_review") || control.status === "needs_review") return "needs_review";
  if (control.status === "not_evaluated") return "manual";
  if (metricStatuses.includes("manual") || (control.metric_results.length === 0 && control.metric_ids.length === 0)) return "manual";
  return "passed";
}

function statusFromMetric(metric: MetricResult, config: MetricConfigFull | null): CtrlStatus {
  const outcome = metricOutcome(metric);
  if (outcome === "passed") return "passed";
  if (outcome === "failed") return "failed";
  const tool = (metric.tool_name ?? config?.tool_name ?? "").toLowerCase();
  return NON_AUTOMATED_TOOLS.has(tool) ? "manual" : "needs_review";
}

function dimensionForControl(control: FrameworkControlAssessment, configById: Map<string, MetricConfigFull>): string {
  const firstMetric = control.metric_results[0];
  const metricId = firstMetric?.metric_id ?? control.metric_ids[0];
  const dimension = configById.get(metricId)?.dimension ?? firstMetric?.dimension ?? control.control_category ?? "Control";
  return humanizeDimension(dimension);
}

function toolsForControl(
  control: FrameworkControlAssessment,
  configById: Map<string, MetricConfigFull>,
  planById: Map<string, RunMetricPlanEntry>,
): string {
  const tools = new Set<string>();
  const metricIds = new Set([...control.metric_ids, ...control.metric_results.map((m) => m.metric_id)]);
  for (const metric of control.metric_results) {
    const tool = displayTool(metric.tool_name ?? configById.get(metric.metric_id)?.tool_name ?? planById.get(metric.metric_id)?.tool_name ?? null);
    if (tool) tools.add(tool);
  }
  for (const metricId of metricIds) {
    const tool = displayTool(configById.get(metricId)?.tool_name ?? planById.get(metricId)?.tool_name ?? null);
    if (tool) tools.add(tool);
  }
  return tools.size ? Array.from(tools).join(", ") : "Not recorded";
}

function displayTool(tool: string | null | undefined): string | null {
  const clean = tool?.trim();
  if (!clean) return null;
  return toolLabel(clean);
}

function countViews(rows: ControlView[]): Counts {
  const counts: Counts = { total: rows.length, passed: 0, failed: 0, needs_review: 0, manual: 0 };
  for (const row of rows) counts[row.status]++;
  return counts;
}

function assignDimensionCodes(rows: ControlView[]): void {
  const groups = groupByDimension(rows);
  groups.forEach((group, dimensionIndex) => {
    group.rows
      .sort((a, b) => a.control.control_ref.localeCompare(b.control.control_ref))
      .forEach((row, metricIndex) => {
        row.displayCode = `D${dimensionIndex + 1}.${metricIndex + 1}`;
      });
  });
}

function groupByDimension(rows: ControlView[]): Array<{ dimension: string; rows: ControlView[] }> {
  const grouped = new Map<string, ControlView[]>();
  for (const row of rows) {
    (grouped.get(row.dimension) ?? grouped.set(row.dimension, []).get(row.dimension)!).push(row);
  }
  return Array.from(grouped.entries())
    .map(([dimension, groupRows]) => ({
      dimension,
      rows: groupRows.slice().sort((a, b) => STATUS_SORT[a.status] - STATUS_SORT[b.status] || a.displayCode.localeCompare(b.displayCode)),
    }))
    .sort((a, b) => dimensionRank(a.dimension) - dimensionRank(b.dimension) || a.dimension.localeCompare(b.dimension));
}

function dimensionRank(dimension: string): number {
  const key = dimension.toLowerCase();
  const order = [
    "task fulfilment",
    "groundedness",
    "retrieval",
    "safety",
    "fairness",
    "privacy",
    "security",
    "robustness",
    "transparency",
    "human oversight",
  ];
  const index = order.findIndex((item) => key.includes(item));
  return index === -1 ? order.length : index;
}

function firstSelectedFramework(frameworks: string[]): FrameworkId {
  return FRAMEWORKS.find((fw) => frameworks.includes(fw)) ?? FRAMEWORKS[0];
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function displayPercentOrScore(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  if (value >= 0 && value <= 1) return `${(value * 100).toFixed(1)}%`;
  return value.toFixed(1);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function posture(counts: Counts): "mostly" | "review" | "risk" {
  if (counts.failed > 0) return "risk";
  if (counts.needs_review > 0 || counts.manual > 0 || counts.total === 0) return "review";
  return "mostly";
}

function PostureBadge({ counts, compact = false }: { counts: Counts; compact?: boolean }) {
  const p = posture(counts);
  const label = p === "mostly" ? "Mostly compliant" : p === "risk" ? "At risk" : "Needs review";
  const cls =
    p === "mostly"
      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
      : p === "risk"
        ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
        : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300";
  return <span className={clsx("shrink-0 rounded-full px-2 py-0.5 font-semibold", compact ? "text-[10px]" : "text-[11px]", cls)}>{label}</span>;
}

function StatusChip({ status }: { status: CtrlStatus }) {
  const label = status === "needs_review" ? "Needs review" : status === "manual" ? "Manual review" : status.charAt(0).toUpperCase() + status.slice(1);
  const dot =
    status === "passed" ? "bg-emerald-500"
      : status === "failed" ? "bg-slate-500"
        : status === "needs_review" ? "bg-amber-500"
          : "bg-violet-500";
  const text =
    status === "passed" ? "text-emerald-700 dark:text-emerald-400"
      : status === "failed" ? "text-slate-700 dark:text-slate-300"
        : status === "needs_review" ? "text-amber-700 dark:text-amber-400"
          : "text-violet-700 dark:text-violet-300";
  return (
    <span className={clsx("inline-flex items-center gap-1.5 text-[12px] font-semibold", text)}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", dot)} aria-hidden />
      {label}
    </span>
  );
}

function ProgressBar({ counts }: { counts: Counts }) {
  const total = counts.total || 1;
  return (
    <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden>
      <div className="bg-emerald-500" style={{ width: `${(counts.passed / total) * 100}%` }} />
      <div className="bg-amber-500" style={{ width: `${(counts.needs_review / total) * 100}%` }} />
      <div className="bg-violet-500" style={{ width: `${(counts.manual / total) * 100}%` }} />
      <div className="bg-slate-500" style={{ width: `${(counts.failed / total) * 100}%` }} />
    </div>
  );
}

function MiniCount({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div>
      <p className={clsx("font-display text-[18px] font-semibold leading-none tabular-nums", tone)}>{value}</p>
      <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">{label}</p>
    </div>
  );
}

function Kpi({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "good" | "warn" | "danger" }) {
  const cls =
    tone === "good" ? "text-emerald-700 dark:text-emerald-400"
      : tone === "warn" ? "text-amber-700 dark:text-amber-400"
        : tone === "danger" ? "text-slate-700 dark:text-slate-300"
          : "text-ink dark:text-white";
  return (
    <div className="rounded-lg border border-hairline dark:border-white/10 px-3 py-2.5">
      <p className="text-[10px] font-medium text-slate-400">{label}</p>
      <p className={clsx("mt-1 font-display text-[22px] leading-none tabular-nums", cls)}>{value}</p>
    </div>
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

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-[13px] text-slate-500 dark:text-slate-400">
      {children}
    </div>
  );
}

function controlOutcomeExplanation(view: ControlView): string {
  const { control, status } = view;
  if (status === "passed") {
    return `${control.passed_metric_count} mapped metric${control.passed_metric_count === 1 ? "" : "s"} met the configured threshold, and no mapped metric failed.`;
  }
  if (status === "failed") {
    return `${control.failed_metric_count} mapped metric${control.failed_metric_count === 1 ? "" : "s"} scored below threshold, so this control is at risk.`;
  }
  if (status === "manual") {
    return "This control requires manual or documentary evidence because no automated metric result was available for a decisive assessment.";
  }
  return `${control.pending_metric_count} mapped metric${control.pending_metric_count === 1 ? "" : "s"} returned an inconclusive or review-required result.`;
}

