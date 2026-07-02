import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FlaskConical, Gauge, Info, Loader2, MinusCircle, XCircle } from "lucide-react";
import clsx from "clsx";
import { Card, CardHeader } from "@/components/ui/Card";
import { MetricCard } from "@/components/ui/MetricCard";
import { Badge } from "@/components/ui/Badge";
import { useAppStore } from "@/store/useAppStore";
import { useActiveRun } from "@/hooks/useActiveRun";
import { listMetricResults, type MetricResult } from "@/api/governanceApi";

type PassFilter = "all" | "passed" | "failed" | "review";

function humanize(text: string): string {
  return text.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function fmtNumber(value?: number | null): string {
  if (value === null || value === undefined) return "—";
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded);
}

function statusTone(status: string): "green" | "red" | "amber" | "blue" | "slate" {
  const s = status.toLowerCase();
  if (["completed", "passed", "success"].includes(s)) return "green";
  if (["failed", "error"].includes(s)) return "red";
  if (["running", "pending"].includes(s)) return "amber";
  if (["skipped", "not_applicable", "na"].includes(s)) return "slate";
  return "blue";
}

// Single source of truth for pass/fail so the "Passed" column, counts, and
// filters never contradict the Status column. Prefer the backend boolean; else
// derive from score vs threshold (the documented rule); else from status text.
function effectivePassed(r: MetricResult): boolean | null {
  if (r.passed === true || r.passed === false) return r.passed;
  if (r.normalized_score != null && r.threshold != null) return r.normalized_score >= r.threshold;
  const s = r.status.toLowerCase();
  if (["passed", "completed", "success"].includes(s)) return true;
  if (["failed", "error"].includes(s)) return false;
  return null;
}

function passedTone(passed: boolean | null): "green" | "red" | "neutral" {
  if (passed === true) return "green";
  if (passed === false) return "red";
  return "neutral";
}

function passedLabel(passed: boolean | null): string {
  if (passed === true) return "Passed";
  if (passed === false) return "Failed";
  return "Needs review";
}

// A metric result is "mock/dev" when the run was executed with the mock
// evaluator (result_summary flags) or the row was produced by the mock runner.
function isMockResult(r: MetricResult): boolean {
  return typeof r.tool_name === "string" && r.tool_name.toLowerCase().includes("mock");
}

function EmptyState({ title, body, cta }: { title: string; body: string; cta?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
        <Gauge className="h-6 w-6 text-slate-400 dark:text-slate-500" />
      </div>
      <p className="text-[15px] font-semibold text-slate-900 dark:text-white">{title}</p>
      <p className="max-w-md text-[13px] leading-5 text-slate-500 dark:text-slate-400">{body}</p>
      {cta && (
        <button
          onClick={cta.onClick}
          className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-brand-700"
        >
          {cta.label}
        </button>
      )}
    </div>
  );
}

export function MetricResults() {
  const navigateTo = useAppStore((s) => s.navigateTo);
  const { runId, run, runs, systemNameById, loading: runsLoading } = useActiveRun();
  const [results, setResults] = useState<MetricResult[]>([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [dimensionFilter, setDimensionFilter] = useState<string>("all");
  const [passFilter, setPassFilter] = useState<PassFilter>("all");

  useEffect(() => {
    if (!runId) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setResultsLoading(true);
    setError(null);
    setDimensionFilter("all");
    setPassFilter("all");
    listMetricResults(runId, 200)
      .then((rows) => {
        if (!cancelled) setResults(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load metric results.");
      })
      .finally(() => {
        if (!cancelled) setResultsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const hasSystems = systemNameById.size > 0;
  const hasRuns = runs.length > 0;
  const loading = runsLoading || resultsLoading;

  // Mock/dev detection: the run was executed with the mock evaluator, or the
  // rows come from the mock metric runner. Real (threshold) runs are unlabeled.
  const summary = (run?.result_summary ?? {}) as Record<string, unknown>;
  const isMockRun =
    summary.mock_execution === true ||
    summary.evaluator_name === "mock" ||
    (results.length > 0 && results.every(isMockResult));

  const counts = useMemo(() => {
    let passed = 0;
    let failed = 0;
    let pending = 0;
    for (const r of results) {
      const p = effectivePassed(r);
      if (p === true) passed += 1;
      else if (p === false) failed += 1;
      else pending += 1;
    }
    return { total: results.length, passed, failed, pending };
  }, [results]);

  const dimensions = useMemo(
    () => Array.from(new Set(results.map((r) => r.dimension))).sort(),
    [results],
  );

  const filtered = useMemo(() => {
    return results.filter((r) => {
      if (dimensionFilter !== "all" && r.dimension !== dimensionFilter) return false;
      const p = effectivePassed(r);
      if (passFilter === "passed") return p === true;
      if (passFilter === "failed") return p === false;
      if (passFilter === "review") return p === null;
      return true;
    });
  }, [results, dimensionFilter, passFilter]);

  const passPills: Array<{ key: PassFilter; label: string }> = [
    { key: "all", label: "All" },
    { key: "passed", label: "Passed" },
    { key: "failed", label: "Failed" },
    { key: "review", label: "Needs review" },
  ];

  const hasResults = results.length > 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-700 dark:text-blue-400">
            Metric Results
          </p>
          <h1 className="mt-1 flex items-center gap-2 text-[20px] font-semibold tracking-tight text-slate-950 dark:text-white">
            <Gauge className="h-5 w-5 text-slate-400" />
            Scored metrics
          </h1>
          <p className="mt-1 max-w-3xl text-[13px] leading-5 text-slate-600 dark:text-slate-400">
            Per-metric scores, thresholds, and pass/fail outcomes produced by the evaluation engine.
          </p>
        </div>
      </div>

      {/* Summary cards + filters render only when real results exist. */}
      {hasResults && !loading && !error && (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <MetricCard label="Total" value={counts.total} icon={Gauge} compact />
            <MetricCard label="Passed" value={counts.passed} icon={CheckCircle2} tone="green" compact />
            <MetricCard label="Failed" value={counts.failed} icon={XCircle} tone="red" compact />
            <MetricCard label="Pending / NA" value={counts.pending} icon={MinusCircle} tone="amber" compact />
          </div>

          {isMockRun && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-[12px] text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <span className="font-semibold">Mock / dev data.</span> These results were produced by the mock metric evaluator (not a real tool backend). Run the pipeline with the real evaluator to see production metric results.
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <select
              value={dimensionFilter}
              onChange={(e) => setDimensionFilter(e.target.value)}
              className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-[12px] font-medium text-slate-700 dark:text-slate-300"
            >
              <option value="all">All dimensions</option>
              {dimensions.map((d) => (
                <option key={d} value={d}>
                  {humanize(d)}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap gap-2">
              {passPills.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPassFilter(p.key)}
                  className={clsx(
                    "rounded border px-3 py-1.5 text-[12px] font-medium transition-colors",
                    passFilter === p.key
                      ? "border-slate-900 bg-slate-900 dark:border-brand-600 dark:bg-brand-700 text-white"
                      : "border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-[12px] text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Passed when normalized score ≥ threshold; failed/error → failed; pending/skipped → needs review.
            </span>
          </div>
        </>
      )}

      <Card>
        <CardHeader
          title="Metric Results"
          eyebrow={
            loading
              ? "Loading…"
              : hasResults
                ? `${filtered.length} of ${results.length} results shown${runId ? ` · run ${shortId(runId)}` : ""}`
                : "No results"
          }
        />
        {loading ? (
          <div className="flex items-center gap-2 px-5 py-12 text-[13px] text-slate-500 dark:text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading metric results…
          </div>
        ) : error ? (
          <div className="m-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">Could not load metric results.</p>
              <p className="mt-0.5 break-all">{error}</p>
            </div>
          </div>
        ) : !hasSystems ? (
          <EmptyState
            title="No metric results yet"
            body="Register an AI system and start a governance run. Scored metrics will appear here once the evaluation engine runs."
            cta={{ label: "Register an AI system", onClick: () => navigateTo("/systems") }}
          />
        ) : !hasRuns ? (
          <EmptyState
            title="No governance runs yet"
            body="This system has no evaluation runs. Start a governance run to produce metric results."
            cta={{ label: "Go to AI Systems", onClick: () => navigateTo("/systems") }}
          />
        ) : !hasResults ? (
          <EmptyState
            title="Metrics not executed yet"
            body="The selected run has not produced metric results. They appear once the run reaches the metric-execution phase."
            cta={{ label: "Open Live Run", onClick: () => navigateTo("/runs") }}
          />
        ) : filtered.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-slate-500 dark:text-slate-400">
            No metric results match this filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-2.5">Metric ID</th>
                  <th className="px-4 py-2.5">Dimension</th>
                  <th className="px-4 py-2.5">Tool</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Raw Score</th>
                  <th className="px-4 py-2.5">Normalized</th>
                  <th className="px-4 py-2.5">Threshold</th>
                  <th className="px-4 py-2.5">Passed</th>
                  <th className="px-4 py-2.5">Evidence</th>
                  <th className="px-4 py-2.5">Capability</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const passed = effectivePassed(r);
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-slate-100 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                    >
                      <td className="px-4 py-3 font-mono text-[11px] font-semibold text-slate-950 dark:text-white">
                        {r.metric_id}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone="violet">{humanize(r.dimension)}</Badge>
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                        <span className="inline-flex items-center gap-1.5">
                          {r.tool_name ?? "—"}
                          {isMockResult(r) && (
                            <span className="rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">mock</span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={statusTone(r.status)}>{humanize(r.status)}</Badge>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-700 dark:text-slate-300">
                        {fmtNumber(r.raw_score)}
                      </td>
                      <td className="px-4 py-3 font-medium tabular-nums text-slate-900 dark:text-slate-100">
                        {fmtNumber(r.normalized_score)}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-600 dark:text-slate-400">
                        {fmtNumber(r.threshold)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={passedTone(passed)}>{passedLabel(passed)}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        {r.evidence_ids.length > 0 ? (
                          <button
                            onClick={() => navigateTo("/evidence")}
                            className="text-[11px] font-medium text-blue-700 hover:underline dark:text-blue-400"
                          >
                            {r.evidence_ids.length} record{r.evidence_ids.length === 1 ? "" : "s"}
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                        {r.ai_system_capability_id ? shortId(r.ai_system_capability_id) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
