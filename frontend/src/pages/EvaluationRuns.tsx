import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, ListChecks, Loader2, Play, PlayCircle, Plus, X, XCircle } from "lucide-react";
import clsx from "clsx";
import { Card, CardHeader } from "@/components/ui/Card";
import { MetricCard } from "@/components/ui/MetricCard";
import { Badge } from "@/components/ui/Badge";
import { useAppStore } from "@/store/useAppStore";
import { useSelectionStore } from "@/store/useSelectionStore";
import { useEvaluationRunner } from "@/hooks/useEvaluationRunner";
import {
  listAISystems,
  listEvaluationRuns,
  type BackendAISystem,
  type EvaluationRun,
} from "@/api/governanceApi";
import { AuditScopeField, WHOLE_APP_SCOPE, type AuditScope } from "@/components/execution/AuditScopeField";

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
  const runner = useEvaluationRunner();
  const [runs, setRuns] = useState<EvaluationRun[]>([]);
  const [systems, setSystems] = useState<BackendAISystem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [showNewRun, setShowNewRun] = useState(false);
  const [selectedSystemId, setSelectedSystemId] = useState<string>("");
  // Audit scope (whole app vs specific functions), owned by AuditScopeField.
  const [scope, setScope] = useState<AuditScope>(WHOLE_APP_SCOPE);
  const handleScope = useCallback((s: AuditScope) => setScope(s), []);

  const loadRuns = () => {
    setLoading(true);
    setError(null);
    Promise.all([listEvaluationRuns(50), listAISystems().catch(() => [] as BackendAISystem[])])
      .then(([runList, systemList]) => {
        setRuns(runList);
        setSystems(systemList);
        if (!selectedSystemId && systemList.length > 0) {
          setSelectedSystemId(systemList[0].id);
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load evaluation runs.");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleStartRun() {
    const system = systems.find((s) => s.id === selectedSystemId);
    if (!system) return;
    setShowNewRun(false);
    const result = await runner.run(system, {
      selectedCapabilities: scope.capabilities,
      onRunCreated: (run) => {
        focusRun(run.id, system.id);
      },
    });
    if (result) {
      focusRun(result.id, system.id);
      loadRuns();
      navigateTo("/runs");
    }
  }

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
      {/* New Run Modal — portaled to <body> so the fixed overlay is
          viewport-relative, not relative to the transformed page wrapper. */}
      {showNewRun && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[3px]" onClick={() => setShowNewRun(false)} />
          <div className="relative z-10 flex max-h-[calc(100vh-2rem)] w-full max-w-md flex-col overflow-y-auto rounded-xl bg-white shadow-2xl ring-1 ring-black/10 dark:bg-slate-900 dark:ring-white/10">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
              <div>
                <p className="text-[15px] font-semibold text-slate-950 dark:text-white">New Evaluation Run</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Select a registered AI system to evaluate.</p>
              </div>
              <button onClick={() => setShowNewRun(false)} className="flex h-8 w-8 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div className="space-y-1">
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">AI System *</label>
                <select
                  value={selectedSystemId}
                  onChange={(e) => setSelectedSystemId(e.target.value)}
                  className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-[12px] text-slate-900 outline-none focus:border-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                >
                  {systems.length === 0 && <option value="">No systems registered</option>}
                  {systems.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} — {s.risk_tier} risk</option>
                  ))}
                </select>
              </div>
              {selectedSystemId && (
                <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
                  {(() => {
                    const s = systems.find((x) => x.id === selectedSystemId);
                    return s ? (
                      <div className="space-y-1 text-[11px] text-slate-600 dark:text-slate-400">
                        <p><span className="font-semibold text-slate-800 dark:text-slate-200">Frameworks:</span> {s.selected_frameworks.join(", ") || "None"}</p>
                        <p><span className="font-semibold text-slate-800 dark:text-slate-200">Endpoint:</span> {s.target_endpoint_ref || "Not set"}</p>
                        <p><span className="font-semibold text-slate-800 dark:text-slate-200">Model:</span> {s.model_name || "Not set"}</p>
                      </div>
                    ) : null;
                  })()}
                </div>
              )}
              {/* Audit scope — whole app vs specific functions. */}
              <AuditScopeField systemId={selectedSystemId || null} onChange={handleScope} />
              {runner.status === "error" && runner.error && (
                <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">{runner.error}</p>
              )}
              <div className="flex gap-2 pt-1">
                <button onClick={() => setShowNewRun(false)} className="flex-1 rounded border border-slate-300 py-2.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
                  Cancel
                </button>
                <button
                  disabled={!selectedSystemId || runner.status === "running" || !scope.valid}
                  onClick={() => void handleStartRun()}
                  className="flex flex-1 items-center justify-center gap-2 rounded bg-slate-900 py-2.5 text-[13px] font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {runner.status === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  {runner.status === "running" ? "Running…" : "Start Evaluation"}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
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
        <button
          onClick={() => { runner.reset(); setShowNewRun(true); }}
          disabled={runner.status === "running"}
          className="flex items-center gap-2 rounded bg-slate-900 px-4 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {runner.status === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {runner.status === "running" ? "Running…" : "New Run"}
        </button>
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
