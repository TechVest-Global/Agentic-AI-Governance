import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  CheckCircle2,
  ClipboardList,
  FlaskConical,
  Layers,
  ListChecks,
  Loader2,
  ShieldCheck,
  Target,
  X,
} from "lucide-react";
import clsx from "clsx";
import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/RunStatus";
import { approvePlan, type EvaluationRun } from "@/api/governanceApi";
import { loadLivePlan } from "@/data/runMetricPlan";
import { dimensionTone, type MetricPlan as MetricPlanShape } from "@/data/metricPlan";

/**
 * In-canvas metric-plan approval modal. Shows the same plan the Metric Plan page
 * renders (summary, probe-budget-by-dimension, metric table) and offers two
 * actions on a paused run:
 *   • Approve Plan   — approve the orchestrator's selection as-is.
 *   • Select Manually — switch the table to checkboxes and approve a hand-picked
 *     subset (sent to the backend as a metric-selection override).
 * Approving resumes the run without leaving the Live Run canvas.
 */
export function MetricPlanApprovalModal({
  run,
  approverName,
  onClose,
  onApproved,
}: {
  run: EvaluationRun;
  approverName: string | null;
  onClose: () => void;
  onApproved: () => void;
}) {
  const [plan, setPlan] = useState<MetricPlanShape | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadLivePlan(run)
      .then((live) => {
        if (cancelled || !live) return;
        setPlan(live);
        // Pre-select the metrics the orchestrator planned to run (status Planned).
        setSelectedIds(new Set(live.metrics.filter((m) => m.status !== "Skipped").map((m) => m.id)));
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Could not load the metric plan.");
      });
    return () => {
      cancelled = true;
    };
  }, [run]);

  const metrics = plan?.metrics ?? [];
  const totalProbes = metrics.reduce((sum, m) => sum + m.probeBudget, 0);
  const dimensions = useMemo(() => Array.from(new Set(metrics.map((m) => m.dimension))), [metrics]);

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function approve(manual: boolean) {
    if (!plan || approving) return;
    if (manual && selectedIds.size === 0) return;
    setApproving(true);
    setApproveError(null);
    try {
      await approvePlan(run.id, {
        approvedBy: approverName ?? undefined,
        selectedMetrics: manual ? metrics.filter((m) => selectedIds.has(m.id)).map((m) => m.id) : undefined,
      });
      onApproved();
    } catch (e) {
      setApproveError(e instanceof Error ? e.message : "Could not approve the plan.");
      setApproving(false);
    }
  }

  // Rendered through a portal to <body> so the fixed overlay is positioned
  // against the viewport, not against the page's `animate-rise` wrapper — a
  // transformed ancestor would otherwise become the containing block, sizing
  // this modal to the (tall) page and pushing the footer actions below the fold.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[3px]" onClick={onClose} />
      <div className="relative z-10 flex max-h-[calc(100vh-3rem)] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/10 dark:bg-slate-900 dark:ring-white/10">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#111827] text-white">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-700 dark:text-blue-400">
                Metric Plan Review
              </p>
              <h2 className="mt-0.5 text-[16px] font-semibold tracking-tight text-slate-950 dark:text-white">
                {metrics.length} metrics for {plan?.systemName ?? run.ai_system_id}
              </h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {plan && <Badge tone="slate">{plan.riskTier} risk</Badge>}
                {plan?.selectedFrameworks.map((fw) => (
                  <Badge key={fw} tone="blue">{fw}</Badge>
                ))}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body (scrolls) */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {loadError && (
            <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">
              {loadError}
            </p>
          )}
          {!plan && !loadError && (
            <div className="flex items-center gap-2 py-8 text-[13px] text-slate-500 dark:text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading metric plan…
            </div>
          )}

          {plan && (
            <>
              {/* Summary */}
              <div className="grid gap-3 sm:grid-cols-3">
                <SummaryCard icon={Target} label="Metrics Selected" value={metrics.length} />
                <SummaryCard icon={FlaskConical} label="Total Probe Budget" value={totalProbes} tone="blue" />
                <SummaryCard icon={Layers} label="Dimensions Covered" value={dimensions.length} tone="amber" />
              </div>

              {/* Probe budget by dimension */}
              <div className="rounded-lg border border-slate-200 p-3.5 dark:border-slate-700">
                <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                  Probe budget by dimension
                </p>
                <div className="space-y-2">
                  {dimensions.map((dim) => {
                    const dimProbes = metrics.filter((m) => m.dimension === dim).reduce((s, m) => s + m.probeBudget, 0);
                    const pct = totalProbes > 0 ? Math.round((dimProbes / totalProbes) * 100) : 0;
                    return (
                      <div key={dim} className="flex items-center gap-3">
                        <div className="w-24 shrink-0">
                          <Badge tone={dimensionTone[dim]}>{dim}</Badge>
                        </div>
                        <ProgressBar value={pct} tone={dimensionTone[dim] === "violet" ? "slate" : dimensionTone[dim]} className="flex-1" />
                        <span className="w-20 text-right text-[11px] tabular-nums text-slate-600 dark:text-slate-400">{dimProbes} ({pct}%)</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Metric table */}
              <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
                      {manualMode && <th className="w-10 px-3 py-2.5" />}
                      <th className="px-3 py-2.5">Metric</th>
                      <th className="px-3 py-2.5">Dimension</th>
                      <th className="px-3 py-2.5">Owner Agent</th>
                      <th className="px-3 py-2.5">Probes</th>
                      <th className="px-3 py-2.5">Threshold</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.map((m) => {
                      const checked = selectedIds.has(m.id);
                      return (
                        <tr
                          key={m.id}
                          onClick={manualMode ? () => toggle(m.id) : undefined}
                          className={clsx(
                            "border-b border-slate-100 last:border-0 dark:border-slate-700/50",
                            manualMode && "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60",
                            manualMode && !checked && "opacity-50",
                          )}
                        >
                          {manualMode && (
                            <td className="px-3 py-2.5">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggle(m.id)}
                                onClick={(e) => e.stopPropagation()}
                                className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600"
                              />
                            </td>
                          )}
                          <td className="px-3 py-2.5">
                            <p className="font-mono text-[11px] font-semibold text-slate-950 dark:text-white">{m.id}</p>
                            <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-400">{m.name}</p>
                          </td>
                          <td className="px-3 py-2.5"><Badge tone={dimensionTone[m.dimension]}>{m.dimension}</Badge></td>
                          <td className="px-3 py-2.5 text-[11px] text-slate-700 dark:text-slate-300">{m.ownerAgent}</td>
                          <td className="px-3 py-2.5 font-medium tabular-nums text-slate-900 dark:text-slate-200">{m.probeBudget}</td>
                          <td className="px-3 py-2.5 font-mono text-[11px] text-slate-600 dark:text-slate-400">{m.threshold}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3.5 dark:border-slate-700">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {manualMode ? (
              <span className="font-medium text-slate-700 dark:text-slate-300">
                {selectedIds.size} of {metrics.length} metrics selected
              </span>
            ) : (
              <span>Orchestrator-selected plan · review before it runs</span>
            )}
            {approveError && <span className="ml-2 text-red-600 dark:text-red-400">{approveError}</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={approving}
              className="rounded border border-slate-300 px-3 py-2 text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            {manualMode ? (
              <>
                <button
                  onClick={() => setManualMode(false)}
                  disabled={approving}
                  className="rounded border border-slate-300 px-3 py-2 text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Back
                </button>
                <button
                  onClick={() => void approve(true)}
                  disabled={approving || selectedIds.size === 0}
                  className="inline-flex items-center gap-1.5 rounded bg-[#111827] px-3.5 py-2 text-[12px] font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950"
                >
                  {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Approve selected
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setManualMode(true)}
                  disabled={approving || !plan}
                  className="inline-flex items-center gap-1.5 rounded border border-slate-300 px-3.5 py-2 text-[12px] font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <ListChecks className="h-4 w-4" />
                  Select manually
                </button>
                <button
                  onClick={() => void approve(false)}
                  disabled={approving || !plan}
                  className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3.5 py-2 text-[12px] font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  Approve plan
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone = "slate",
}: {
  icon: typeof Target;
  label: string;
  value: number;
  tone?: "slate" | "blue" | "amber";
}) {
  const toneClass = {
    slate: "text-slate-400",
    blue: "text-blue-500",
    amber: "text-amber-500",
  }[tone];
  return (
    <div className="rounded-lg border border-slate-200 px-3.5 py-3 dark:border-slate-700">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">{label}</p>
        <Icon className={clsx("h-4 w-4", toneClass)} />
      </div>
      <p className="mt-1 text-[22px] font-semibold tabular-nums text-slate-950 dark:text-white">{value}</p>
    </div>
  );
}
