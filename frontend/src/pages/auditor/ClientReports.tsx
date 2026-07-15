import { useEffect, useMemo, useState } from "react";
import { BookOpen, Download, FileText } from "lucide-react";
import clsx from "clsx";
import {
  getFrameworkMap,
  getGovernanceReport,
  listMetricConfigs,
  type FrameworkComplianceMap,
  type FrameworkControlAssessment,
  type GovernanceReport,
  type MetricConfigFull,
} from "@/api/governanceApi";
import { useAppStore } from "@/store/useAppStore";
import { useSelectionStore } from "@/store/useSelectionStore";
import { useAuditorWorkspace, type ReviewItem } from "@/hooks/useAuditorWorkspace";
import { AuditorPageHeader, AuditorSkeleton, BackendError, SeverityTag, timeAgo } from "./components";
import {
  StatTile,
  VerdictPill,
  frameworkLabel,
  humanizeDimension,
  metricOutcome,
  metricOutcomeMeta,
  metricPassed,
  verdictToClient,
} from "./clientComponents";

/**
 * Reports — split view: available reports (left) + an in-app preview (right).
 * Reading a report never requires a download; export is the secondary action.
 * Reframed from the developer "compliance reports" (no sign-off framing): to a
 * client a report is either available or still in progress.
 */

const IN_FLIGHT = new Set([
  "created", "context_assembly", "planned", "metrics_running", "agents_running", "council_running",
]);

export function ClientReports() {
  const ws = useAuditorWorkspace();
  const navigateTo = useAppStore((s) => s.navigateTo);
  const setSelectedRunId = useSelectionStore((s) => s.setSelectedRunId);

  // One report per application: its latest run that produced a verdict. (Not
  // keyed on report_ready — real runs hang at council_running with a verdict.)
  const reports = useMemo(() => {
    const latest = new Map<string, ReviewItem>();
    for (const item of ws.reviewItems) {
      if (item.verdict == null) continue;
      const prev = latest.get(item.systemId);
      if (!prev || item.createdAt > prev.createdAt) latest.set(item.systemId, item);
    }
    return Array.from(latest.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [ws.reviewItems]);

  // Genuinely in-flight = a run executing that hasn't produced a verdict yet.
  const inProgress = useMemo(
    () => ws.reviewItems.filter((i) => i.verdict == null && IN_FLIGHT.has(i.status)).map((i) => i.systemName),
    [ws.reviewItems],
  );

  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedRun && reports.length) setSelectedRun(reports[0].run.id);
  }, [reports, selectedRun]);

  if (ws.loading) {
    return <div className="space-y-5"><AuditorPageHeader eyebrow="Assurance" title="Reports" description="Assurance reports for your applications." /><AuditorSkeleton rows={2} /></div>;
  }
  if (ws.error) {
    return <div className="space-y-5"><AuditorPageHeader eyebrow="Assurance" title="Reports" /><BackendError message={ws.error} onRetry={ws.refresh} /></div>;
  }

  return (
    <div className="space-y-5">
      <AuditorPageHeader
        eyebrow="Assurance"
        title="Reports"
        description="Read an assurance report in-app, or download it. One report per application, from its latest assessment."
        connected={ws.connected}
        onRefresh={ws.refresh}
      />

      {reports.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-10 text-center">
          <FileText className="mx-auto mb-3 h-7 w-7 text-slate-400" aria-hidden />
          <p className="text-[14px] font-semibold text-ink dark:text-white">No reports available yet</p>
          <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">
            {inProgress.length ? `${inProgress.length} assessment(s) in progress.` : "Reports appear here once an assessment completes."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          {/* list */}
          <div className="space-y-2">
            {reports.map((r) => {
              const meta = verdictToClient(r.verdictLabel, { actionTier: r.verdict?.action_tier, hasTerminalRun: true });
              const active = selectedRun === r.run.id;
              return (
                <button
                  key={r.run.id}
                  onClick={() => setSelectedRun(r.run.id)}
                  className={clsx(
                    "flex w-full flex-col gap-1.5 rounded-xl border px-3.5 py-3 text-left transition-colors",
                    active
                      ? "border-brand-400 bg-brand-50/50 dark:border-brand-600 dark:bg-brand-950/30"
                      : "border-hairline dark:border-white/10 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/40",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink dark:text-white">{r.systemName}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <VerdictPill meta={meta} size="sm" />
                    <span className="text-[11px] text-slate-400">{timeAgo(r.createdAt)}</span>
                  </div>
                </button>
              );
            })}
            {inProgress.length > 0 && (
              <p className="px-1 pt-2 text-[11px] text-slate-400 dark:text-slate-500">
                {inProgress.length} assessment(s) in progress — reports will appear when complete.
              </p>
            )}
          </div>

          {/* preview */}
          <ReportPreview
            key={selectedRun ?? "none"}
            runId={selectedRun}
            onOpenLedger={(runId) => { setSelectedRunId(runId); navigateTo("/audit-ledger"); }}
          />
        </div>
      )}
    </div>
  );
}

function ReportPreview({ runId, onOpenLedger }: { runId: string | null; onOpenLedger: (runId: string) => void }) {
  const [report, setReport] = useState<GovernanceReport | null>(null);
  const [frameworkMap, setFrameworkMap] = useState<FrameworkComplianceMap | null>(null);
  const [metricCatalog, setMetricCatalog] = useState<MetricConfigFull[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      getGovernanceReport(runId),
      getFrameworkMap(runId).catch(() => null),
      listMetricConfigs({ limit: 200 }).catch(() => [] as MetricConfigFull[]),
    ])
      .then(([r, fm, catalog]) => {
        if (!cancelled) {
          setReport(r);
          setFrameworkMap(fm);
          setMetricCatalog(catalog);
        }
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load report."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [runId]);

  if (!runId) {
    return <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-300 dark:border-slate-700 py-20 text-[13px] text-slate-400">Select a report to read it.</div>;
  }
  if (loading) return <AuditorSkeleton rows={2} />;
  if (error) return <BackendError message={error} onRetry={() => setReport(null)} />;
  if (!report) return null;

  const verdict = verdictToClient(report.verdict?.label, { actionTier: report.verdict?.action_tier, hasTerminalRun: true });
  const metricsPassed = report.metric_results.filter(metricPassed).length;
  // Normalize to the client-facing dimension label so mixed backend taxonomies
  // (e.g. "groundedness" vs "Groundedness") collapse to one — matches the
  // Metrics tab roll-up.
  const dimensions = new Set(report.metric_results.map((m) => humanizeDimension(m.dimension)));
  const openFindings = report.findings.filter((f) => f.status?.toLowerCase() === "open");
  const topFindings = [...openFindings]
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
    .slice(0, 5);

  function exportReport() {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${report!.ai_system.name.replace(/\s+/g, "-").toLowerCase()}-assurance-report.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-xl border border-hairline dark:border-white/10 bg-white dark:bg-slate-900">
      {/* report header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-hairline dark:border-white/10 px-6 py-5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-700 dark:text-brand-400">Assurance report</p>
          <h2 className="mt-1 font-display text-[20px] leading-tight text-ink dark:text-white">{report.ai_system.name}</h2>
          <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">Generated {timeAgo(report.run.created_at)} · {frameworkList(report)}</p>
        </div>
        <div className="flex items-center gap-2">
          <VerdictPill meta={verdict} />
          <button onClick={exportReport} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-[12px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
            <Download className="h-3.5 w-3.5" aria-hidden />
            Download
          </button>
        </div>
      </div>

      <div className="space-y-6 px-6 py-5">
        {/* stat tiles */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Verdict" value={<span className="text-[16px]">{verdict.text}</span>} tone={verdict.key === "compliant" ? "good" : verdict.key === "not_compliant" ? "danger" : verdict.key === "under_review" ? "default" : "warn"} />
          <StatTile label="Metrics passed" value={`${metricsPassed}/${report.metric_results.length}`} />
          <StatTile label="Dimensions" value={dimensions.size} />
          <StatTile label="Open findings" value={openFindings.length} tone={openFindings.length ? "warn" : "default"} />
        </div>

        {/* executive summary */}
        <section>
          <h3 className="text-[13px] font-semibold text-ink dark:text-white">Executive summary</h3>
          {report.verdict?.synthesis ? (
            <p className="mt-2 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">{report.verdict.synthesis}</p>
          ) : (
            <p className="mt-2 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
              This assessment evaluated {report.metric_results.length} checks across {dimensions.size} dimensions against {report.ai_system.selected_frameworks.length} frameworks.
            </p>
          )}
        </section>

        {/* dimensions */}
        <section>
          <h3 className="text-[13px] font-semibold text-ink dark:text-white">Dimensions assessed</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {Array.from(dimensions).sort().map((d) => (
              <span key={d} className="rounded-full border border-hairline dark:border-white/10 px-2.5 py-1 text-[11px] text-slate-600 dark:text-slate-300">
                {d}
              </span>
            ))}
          </div>
        </section>

        <FrameworkMappingPreview frameworkMap={frameworkMap} metricCatalog={metricCatalog} />

        {/* key findings */}
        <section>
          <h3 className="text-[13px] font-semibold text-ink dark:text-white">Key findings</h3>
          {topFindings.length === 0 ? (
            <p className="mt-2 text-[13px] text-slate-500 dark:text-slate-400">No open findings.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {topFindings.map((f) => (
                <li key={f.id} className="flex items-start gap-2.5 rounded-lg border border-hairline dark:border-white/10 px-3 py-2.5">
                  <SeverityTag severity={f.severity} />
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-ink dark:text-white">{f.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-[12px] text-slate-500 dark:text-slate-400">{f.summary}</p>
                    {f.recommended_action && (
                      <p className="mt-1 text-[12px] text-slate-600 dark:text-slate-300"><span className="font-semibold">Remediation:</span> {f.recommended_action}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* footer link to demoted ledger */}
        <div className="border-t border-hairline dark:border-white/10 pt-4">
          <button onClick={() => onOpenLedger(report.run.id)} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-slate-500 dark:text-slate-400 hover:text-ink dark:hover:text-white">
            <BookOpen className="h-3.5 w-3.5" aria-hidden />
            View activity ledger for this assessment
          </button>
        </div>
      </div>
    </div>
  );
}

function severityRank(s: string): number {
  return ({ critical: 5, high: 4, medium: 3, low: 2, info: 1 } as Record<string, number>)[s.toLowerCase()] ?? 0;
}

function FrameworkMappingPreview({
  frameworkMap,
  metricCatalog,
}: {
  frameworkMap: FrameworkComplianceMap | null;
  metricCatalog: MetricConfigFull[];
}) {
  const metricById = useMemo(() => {
    const map = new Map<string, MetricConfigFull>();
    for (const metric of metricCatalog) map.set(metric.metric_id, metric);
    return map;
  }, [metricCatalog]);

  const grouped = useMemo(() => {
    const map = new Map<string, FrameworkControlAssessment[]>();
    for (const control of frameworkMap?.controls ?? []) {
      const arr = map.get(control.framework_name) ?? [];
      arr.push(control);
      map.set(control.framework_name, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [frameworkMap]);

  if (!frameworkMap || grouped.length === 0) {
    return (
      <section>
        <h3 className="text-[13px] font-semibold text-ink dark:text-white">Framework mapping & checks</h3>
        <p className="mt-2 text-[13px] text-slate-500 dark:text-slate-400">No framework mapping is available for this report yet.</p>
      </section>
    );
  }

  return (
    <section>
      <h3 className="text-[13px] font-semibold text-ink dark:text-white">Framework mapping & checks</h3>
      <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
        Clauses are mapped to the metric checks that produced this report. Failed checks are shown with their score and threshold.
      </p>
      <div className="mt-3 space-y-3">
        {grouped.map(([frameworkName, controls]) => (
          <div key={frameworkName} className="rounded-xl border border-hairline dark:border-white/10">
            <div className="flex items-center justify-between gap-3 border-b border-hairline dark:border-white/10 px-3 py-2.5">
              <p className="text-[12px] font-semibold text-ink dark:text-white">{frameworkName}</p>
              <span className="text-[11px] text-slate-400">{controls.length} clauses</span>
            </div>
            <div className="divide-y divide-hairline dark:divide-white/10">
              {controls.map((control) => (
                <div key={control.control_ref} className="px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-ink dark:text-white">
                        <span className="font-mono text-[10px] text-slate-400">{control.control_ref}</span>{" "}
                        {control.control_title ?? "Untitled clause"}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        {control.passed_metric_count} passed / {control.failed_metric_count} failed / {control.pending_metric_count} pending / {control.finding_count} findings
                      </p>
                    </div>
                    <ControlStatusLabel status={control.status} />
                  </div>
                  <div className="mt-2 grid gap-1.5">
                    {(control.metric_results.length ? control.metric_results : []).map((metric) => {
                      const config = metricById.get(metric.metric_id);
                      const outcome = metricOutcome(metric);
                      const meta = metricOutcomeMeta(outcome);
                      return (
                        <div key={metric.id} className="grid grid-cols-[1fr_110px_110px] items-center gap-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 px-2.5 py-2 text-[12px]">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-800 dark:text-slate-200">{config?.name ?? metric.metric_id}</p>
                            <p className="font-mono text-[10px] text-slate-400">{metric.metric_id} · {humanizeDimension(config?.dimension ?? metric.dimension)}</p>
                          </div>
                          <span className={clsx("font-semibold", meta.tone)}>{meta.label}</span>
                          <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                            {metric.normalized_score != null ? metric.normalized_score.toFixed(2) : "n/a"}
                            {metric.threshold != null ? ` / ${metric.threshold.toFixed(2)}` : ""}
                          </span>
                        </div>
                      );
                    })}
                    {control.metric_results.length === 0 && control.metric_ids.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {control.metric_ids.map((metricId) => (
                          <span key={metricId} className="rounded border border-hairline dark:border-white/10 px-2 py-0.5 font-mono text-[10px] text-slate-500 dark:text-slate-400">{metricId}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ControlStatusLabel({ status }: { status: FrameworkControlAssessment["status"] }) {
  const label = status === "passed" ? "Fully satisfied" : status === "failed" ? "Not satisfied" : status === "needs_review" ? "Partially satisfied" : "Not evaluated";
  const tone =
    status === "passed"
      ? "text-emerald-700 dark:text-emerald-300"
      : status === "failed"
        ? "text-red-700 dark:text-red-300"
        : status === "needs_review"
          ? "text-amber-700 dark:text-amber-300"
          : "text-slate-400";
  return <span className={clsx("shrink-0 text-[12px] font-semibold", tone)}>{label}</span>;
}

function frameworkList(report: GovernanceReport): string {
  return report.ai_system.selected_frameworks.map(frameworkLabel).join(", ") || "no frameworks";
}
