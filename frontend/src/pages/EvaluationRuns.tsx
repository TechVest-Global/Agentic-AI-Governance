import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ListChecks, Loader2, PlayCircle, XCircle } from "lucide-react";
import clsx from "clsx";
import { Card, CardHeader } from "@/components/ui/Card";
import { MetricCard } from "@/components/ui/MetricCard";
import { Badge } from "@/components/ui/Badge";
import { useAppStore } from "@/store/useAppStore";
import { useSelectionStore } from "@/store/useSelectionStore";
import {
  listAISystems,
  listEvaluationRuns,
  type BackendAISystem,
  type EvaluationRun,
} from "@/api/governanceApi";

type StatusFilter = "all" | "running" | "completed" | "failed";

const TERMINAL_FAILED = ["failed", "cancelled", "canceled"];

function humanize(text: string): string {
  return text
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function fmtTime(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function statusTone(status: string): "green" | "red" | "amber" | "blue" | "slate" {
  const s = status.toLowerCase();
  if (s === "completed") return "green";
  if (TERMINAL_FAILED.includes(s)) return "red";
  if (s === "running") return "amber";
  if (s === "created") return "slate";
  return "blue";
}

function isActive(status: string): boolean {
  const s = status.toLowerCase();
  return s !== "completed" && !TERMINAL_FAILED.includes(s);
}

function summarize(record: Record<string, unknown> | null | undefined): string {
  if (!record) return "—";
  const entries = Object.entries(record);
  if (entries.length === 0) return "—";
  return entries
    .slice(0, 3)
    .map(([k, v]) => `${humanize(k)}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

export function EvaluationRuns() {
  const navigateTo = useAppStore((s) => s.navigateTo);
  const focusRun = useSelectionStore((s) => s.focusRun);
  const [runs, setRuns] = useState<EvaluationRun[]>([]);
  const [systems, setSystems] = useState<BackendAISystem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([listEvaluationRuns(50), listAISystems().catch(() => [] as BackendAISystem[])])
      .then(([runList, systemList]) => {
        if (cancelled) return;
        setRuns(runList);
        setSystems(systemList);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load evaluation runs.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const systemNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of systems) map.set(s.id, s.name);
    return map;
  }, [systems]);

  const counts = useMemo(() => {
    let active = 0;
    let completed = 0;
    let failed = 0;
    for (const r of runs) {
      const s = r.status.toLowerCase();
      if (s === "completed") completed += 1;
      else if (TERMINAL_FAILED.includes(s)) failed += 1;
      else active += 1;
    }
    return { total: runs.length, active, completed, failed };
  }, [runs]);

  const filtered = useMemo(() => {
    return runs.filter((r) => {
      const s = r.status.toLowerCase();
      if (filter === "all") return true;
      if (filter === "running") return isActive(r.status);
      if (filter === "completed") return s === "completed";
      if (filter === "failed") return TERMINAL_FAILED.includes(s);
      return true;
    });
  }, [runs, filter]);

  const pills: Array<{ key: StatusFilter; label: string }> = [
    { key: "all", label: "All" },
    { key: "running", label: "Running" },
    { key: "completed", label: "Completed" },
    { key: "failed", label: "Failed" },
  ];

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-700 dark:text-blue-400">
          Run History
        </p>
        <h1 className="mt-1 flex items-center gap-2 text-[20px] font-semibold tracking-tight text-slate-950 dark:text-white">
          <ListChecks className="h-5 w-5 text-slate-400" />
          Run history
        </h1>
        <p className="mt-1 max-w-3xl text-[13px] leading-5 text-slate-600 dark:text-slate-400">
          Historical governance evaluations triggered against registered AI systems, with status, phase, and result summary.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Total Runs" value={counts.total} icon={ListChecks} compact />
        <MetricCard label="Active" value={counts.active} icon={PlayCircle} tone="amber" compact />
        <MetricCard label="Completed" value={counts.completed} icon={CheckCircle2} tone="green" compact />
        <MetricCard label="Failed" value={counts.failed} icon={XCircle} tone="red" compact />
      </div>

      <div className="flex flex-wrap gap-2">
        {pills.map((p) => (
          <button
            key={p.key}
            onClick={() => setFilter(p.key)}
            className={clsx(
              "rounded border px-3 py-1.5 text-[12px] font-medium transition-colors",
              filter === p.key
                ? "border-slate-900 bg-slate-900 dark:border-brand-600 dark:bg-brand-700 text-white"
                : "border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader
          title="Run History"
          eyebrow={loading ? "Loading…" : `${filtered.length} of ${runs.length} runs shown`}
        />
        {loading ? (
          <div className="flex items-center gap-2 px-5 py-12 text-[13px] text-slate-500 dark:text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading evaluation runs…
          </div>
        ) : error ? (
          <div className="m-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">Could not load evaluation runs.</p>
              <p className="mt-0.5 break-all">{error}</p>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-slate-500 dark:text-slate-400">
            No evaluation runs match this filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-2.5">Run</th>
                  <th className="px-4 py-2.5">AI System</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Current Phase</th>
                  <th className="px-4 py-2.5">Frameworks</th>
                  <th className="px-4 py-2.5">Metrics</th>
                  <th className="px-4 py-2.5">Started</th>
                  <th className="px-4 py-2.5">Completed</th>
                  <th className="px-4 py-2.5">Result / Error</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((run) => {
                  const hasError = run.error_summary && Object.keys(run.error_summary).length > 0;
                  return (
                    <tr
                      key={run.id}
                      className="border-b border-slate-100 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono text-[11px] font-semibold text-slate-950 dark:text-white">
                          {shortId(run.id)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[12px] text-slate-700 dark:text-slate-300">
                        {systemNameById.get(run.ai_system_id) ?? (
                          <span className="font-mono text-[11px] text-slate-500">{shortId(run.ai_system_id)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={statusTone(run.status)}>{humanize(run.status)}</Badge>
                      </td>
                      <td className="px-4 py-3 text-[12px] text-slate-700 dark:text-slate-300">
                        {run.current_phase ? humanize(run.current_phase) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {run.selected_frameworks.length === 0 ? (
                            <span className="text-slate-400">—</span>
                          ) : (
                            run.selected_frameworks.map((fw) => (
                              <span
                                key={fw}
                                className="rounded bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 dark:text-slate-300"
                              >
                                {fw}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-medium tabular-nums text-slate-900 dark:text-slate-100">
                        {run.selected_metrics.length}
                      </td>
                      <td className="px-4 py-3 text-[11px] text-slate-600 dark:text-slate-400">
                        {fmtTime(run.started_at)}
                      </td>
                      <td className="px-4 py-3 text-[11px] text-slate-600 dark:text-slate-400">
                        {fmtTime(run.completed_at)}
                      </td>
                      <td className="px-4 py-3 max-w-[260px]">
                        {hasError ? (
                          <span className="block truncate text-[11px] text-red-600 dark:text-red-400">
                            {summarize(run.error_summary)}
                          </span>
                        ) : (
                          <span className="block truncate text-[11px] text-slate-600 dark:text-slate-400">
                            {summarize(run.result_summary)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        <button
                          onClick={() => { focusRun(run.id, run.ai_system_id); navigateTo("/runs"); }}
                          className="text-[11px] font-semibold text-blue-700 hover:underline dark:text-blue-400"
                        >
                          View live run →
                        </button>
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
