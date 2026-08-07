import { useEffect, useState } from "react";
import { CheckCircle2, ClipboardList, FlaskConical, Layers, Loader2, ShieldCheck, Target } from "lucide-react";
import clsx from "clsx";
import { Card, CardHeader } from "@/components/ui/Card";
import { MetricCard } from "@/components/ui/MetricCard";
import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/RunStatus";
import { useAppStore } from "@/store/useAppStore";
import { useAuthStore } from "@/store/useAuthStore";
import { metricPlan, dimensionTone, type MetricDimension, type MetricPlan as MetricPlanShape, type MetricStatus, type PlannedMetric } from "@/data/metricPlan";
import { approvePlan, isAwaitingApproval } from "@/api/governanceApi";
import { loadLivePlan } from "@/data/runMetricPlan";
import { useActiveRun } from "@/hooks/useActiveRun";

const statusTone: Record<MetricStatus, "green" | "amber" | "red" | "slate" | "blue"> = {
  Pass: "green",
  Running: "amber",
  Fail: "red",
  Planned: "slate",
  Skipped: "slate",
};

export function MetricPlan() {
  const { navigateTo } = useAppStore();
  const { run, refresh } = useActiveRun();
  const approverName = useAuthStore((s) => s.user?.name) ?? null;
  const [dimensionFilter, setDimensionFilter] = useState<MetricDimension | "All">("All");
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [plan, setPlan] = useState<MetricPlanShape>(metricPlan);
  const [source, setSource] = useState<"live" | "sample">("sample");

  // Approval-gate state for the active run. The button is only a real control
  // when a live run is paused awaiting approval; otherwise it reflects status.
  const awaitingApproval = source === "live" && !!run && isAwaitingApproval(run);
  const alreadyApproved = !!run?.plan_approved_at;

  async function handleApprove() {
    if (!run || !awaitingApproval || approving) return;
    setApproving(true);
    setApproveError(null);
    try {
      await approvePlan(run.id, { approvedBy: approverName ?? undefined });
      refresh();
      // The run resumes on the backend — send the reviewer to the Live Run view
      // to watch metric execution and the agents pick up.
      navigateTo("/runs");
    } catch (e) {
      setApproveError(e instanceof Error ? e.message : "Could not approve the plan.");
      setApproving(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    if (!run) {
      // No active run — fall back to the bundled sample plan.
      setPlan(metricPlan);
      setSource("sample");
      return;
    }
    loadLivePlan(run)
      .then((live) => {
        if (cancelled) return;
        if (live && live.metrics.length > 0) {
          setPlan(live);
          setSource("live");
        } else {
          setPlan(metricPlan);
          setSource("sample");
        }
      })
      .catch(() => {
        /* keep sample plan on any failure */
      });
    return () => {
      cancelled = true;
    };
  }, [run]);

  const metrics = dimensionFilter === "All" ? plan.metrics : plan.metrics.filter((m) => m.dimension === dimensionFilter);

  const totalProbes = plan.metrics.reduce((sum, m) => sum + m.probeBudget, 0);
  const dimensions = Array.from(new Set(plan.metrics.map((m) => m.dimension)));
  const passing = plan.metrics.filter((m) => m.status === "Pass").length;

  return (
    <div className="space-y-5">
      {/* Plan header */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-[#111827] text-white">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-700 dark:text-blue-400">Metric Plan Review</p>
              <h2 className="mt-1 text-[20px] font-semibold tracking-tight text-slate-950 dark:text-white">
                {plan.metrics.length} metrics selected for {plan.systemName}
              </h2>
              <p className="mt-2 max-w-3xl text-[13px] leading-5 text-slate-600 dark:text-slate-400">
                The orchestrator selected these metrics based on the system&apos;s declared capabilities and modality
                and its {plan.selectedFrameworks.length} selected frameworks, excluding metrics that don&apos;t
                structurally apply (e.g. retrieval-quality checks for a non-retrieval system). The{" "}
                <span className="font-medium">{plan.riskTier}</span> risk tier scales probe depth, not which metrics run.
                Review the plan before the run executes.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge tone={source === "live" ? "green" : "amber"}>
                  {source === "live" ? "Live data" : "Sample data"}
                </Badge>
                <Badge tone="slate">Run mode: {plan.runMode}</Badge>
                {plan.selectedFrameworks.map((fw) => (
                  <Badge key={fw} tone="blue">{fw}</Badge>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <button
              onClick={() => void handleApprove()}
              disabled={!awaitingApproval || approving}
              title={
                awaitingApproval
                  ? "Approve this plan to start metric execution"
                  : alreadyApproved
                    ? "This plan has already been approved"
                    : "The Approve action is available while a run is paused for plan review"
              }
              className={clsx(
                "inline-flex items-center gap-2 rounded px-3 py-2 text-[12px] font-semibold transition-colors",
                awaitingApproval && !approving
                  ? "bg-[#111827] text-white hover:bg-slate-800"
                  : alreadyApproved
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                    : "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500 cursor-not-allowed",
              )}
            >
              {approving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : alreadyApproved ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <ShieldCheck className="h-4 w-4" />
              )}
              {approving
                ? "Approving…"
                : alreadyApproved
                  ? "Plan approved"
                  : "Approve plan"}
            </button>
            {awaitingApproval && (
              <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                Run paused — awaiting your approval to execute
              </p>
            )}
            {alreadyApproved && run?.plan_approved_by && (
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                Approved by {run.plan_approved_by}
              </p>
            )}
            {approveError && (
              <p className="max-w-55 text-right text-[10px] text-red-600 dark:text-red-400">{approveError}</p>
            )}
          </div>
        </div>
      </Card>

      {/* Summary metrics */}
      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Metrics Selected" value={plan.metrics.length} icon={Target} compact />
        <MetricCard label="Total Probe Budget" value={totalProbes} icon={FlaskConical} tone="blue" compact />
        <MetricCard label="Dimensions Covered" value={dimensions.length} icon={Layers} tone="amber" compact />
        <MetricCard label="Passing" value={`${passing}/${plan.metrics.length}`} icon={CheckCircle2} tone="green" compact />
      </div>

      {/* Probe budget by dimension */}
      <Card>
        <CardHeader title="Probe Budget by Dimension" eyebrow="Allocation across risk perspectives" />
        <div className="space-y-3 p-4">
          {dimensions.map((dim) => {
            const dimProbes = plan.metrics.filter((m) => m.dimension === dim).reduce((s, m) => s + m.probeBudget, 0);
            const pct = totalProbes > 0 ? Math.round((dimProbes / totalProbes) * 100) : 0;
            return (
              <div key={dim} className="flex items-center gap-3">
                <div className="w-28 shrink-0">
                  <Badge tone={dimensionTone[dim]}>{dim}</Badge>
                </div>
                <ProgressBar value={pct} tone={dimensionTone[dim] === "violet" ? "slate" : dimensionTone[dim]} className="flex-1" />
                <span className="w-24 text-right text-[11px] tabular-nums text-slate-600 dark:text-slate-400">{dimProbes} probes ({pct}%)</span>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Dimension filter */}
      <div className="flex flex-wrap gap-2">
        {(["All", ...dimensions] as const).map((dim) => (
          <button
            key={dim}
            onClick={() => setDimensionFilter(dim as MetricDimension | "All")}
            className={clsx(
              "rounded border px-3 py-1.5 text-[12px] font-medium transition-colors",
              dimensionFilter === dim ? "border-slate-900 bg-slate-900 dark:border-brand-600 dark:bg-brand-700 text-white" : "border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
            )}
          >
            {dim}
          </button>
        ))}
      </div>

      {/* Metric table */}
      <Card>
        <CardHeader title="Selected Metrics" eyebrow={`${metrics.length} shown — tool, owner agent, framework, and threshold`} />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                <th className="px-4 py-2.5">Metric</th>
                <th className="px-4 py-2.5">Dimension</th>
                <th className="px-4 py-2.5">Tool</th>
                <th className="px-4 py-2.5">Owner Agent</th>
                <th className="px-4 py-2.5">Probes</th>
                <th className="px-4 py-2.5">Threshold</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((metric) => (
                <MetricRow key={metric.id} metric={metric} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => navigateTo("/runs")}
          className="inline-flex items-center gap-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-[12px] font-medium text-slate-900 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
        >
          View specialist agents
        </button>
        <button
          onClick={() => navigateTo("/engine")}
          className="inline-flex items-center gap-2 rounded bg-[#111827] px-3 py-2 text-[12px] font-semibold text-white hover:bg-slate-800"
        >
          Open pipeline prototype
        </button>
      </div>
    </div>
  );
}

function MetricRow({ metric }: { metric: PlannedMetric }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <tr
        onClick={() => setExpanded((v) => !v)}
        className="cursor-pointer border-b border-slate-100 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-800/60"
      >
        <td className="px-4 py-3">
          <p className="font-mono text-[11px] font-semibold text-slate-950 dark:text-white">{metric.id}</p>
          <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-400">{metric.name}</p>
        </td>
        <td className="px-4 py-3"><Badge tone={dimensionTone[metric.dimension]}>{metric.dimension}</Badge></td>
        <td className="px-4 py-3">
          <span className="font-mono text-[11px] text-slate-800 dark:text-slate-200">{metric.tool}</span>
          <span className="ml-1.5 rounded bg-slate-100 dark:bg-slate-700 px-1 py-0.5 text-[9px] font-medium uppercase text-slate-500 dark:text-slate-400">{metric.toolMode}</span>
        </td>
        <td className="px-4 py-3 text-[11px] text-slate-700 dark:text-slate-300">{metric.ownerAgent}</td>
        <td className="px-4 py-3 font-medium tabular-nums text-slate-900 dark:text-white">{metric.probeBudget}</td>
        <td className="px-4 py-3 font-mono text-[11px] text-slate-600 dark:text-slate-400">{metric.threshold}</td>
        <td className="px-4 py-3"><Badge tone={statusTone[metric.status]}>{metric.status}</Badge></td>
      </tr>
      {expanded && (
        <tr className="border-b border-slate-100 dark:border-slate-700/50 bg-slate-50/60 dark:bg-slate-800/40">
          <td colSpan={7} className="px-4 py-3">
            <p className="text-[12px] leading-5 text-slate-700 dark:text-slate-300">{metric.description}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Frameworks:</span>
              {metric.frameworks.map((fw) => (
                <span key={fw} className="rounded bg-white dark:bg-slate-700 px-2 py-0.5 text-[10px] text-slate-700 dark:text-slate-300 ring-1 ring-slate-200 dark:ring-slate-600">{fw}</span>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
