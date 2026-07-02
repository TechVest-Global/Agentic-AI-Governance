import { ListChecks } from "lucide-react";
import clsx from "clsx";
import { useActiveRun } from "@/hooks/useActiveRun";

// Cap the dropdown to the most recent real runs so the selector stays scannable.
const MAX_RUNS = 8;

function statusDot(status: string): string {
  const s = status.toLowerCase();
  if (s === "completed" || s === "report_ready") return "bg-emerald-500";
  if (s === "failed" || s === "cancelled") return "bg-red-500";
  if (s === "created") return "bg-slate-400";
  return "bg-amber-500";
}

/** Muted, non-interactive pill for the honest empty/loading states. */
function StatePill({ children }: { children: React.ReactNode }) {
  return (
    <span className="hidden items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[12px] font-medium text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500 md:flex">
      <ListChecks className="h-3.5 w-3.5 shrink-0" />
      {children}
    </span>
  );
}

/**
 * Global run switcher in the header. Backend-driven and honest: it only ever
 * lists real evaluation runs, and shows a clear disabled state when there is no
 * AI system or no run yet. Selecting a run drives every run-scoped tab through
 * the shared selection store.
 */
export function RunSwitcher() {
  const { runs, runId, setRunId, systemNameById, loading } = useActiveRun();

  if (loading) return <StatePill>Loading runs…</StatePill>;
  if (systemNameById.size === 0) return <StatePill>No AI system registered</StatePill>;
  if (runs.length === 0) return <StatePill>No governance runs yet</StatePill>;

  // Show the latest N real runs. If the selected run is older than that window,
  // keep it in the list so the selection stays visible and switchable.
  const visible = runs.slice(0, MAX_RUNS);
  if (runId && !visible.some((r) => r.id === runId)) {
    const selected = runs.find((r) => r.id === runId);
    if (selected) visible.push(selected);
  }
  const current = runs.find((r) => r.id === runId);
  const latestId = runs[0].id;

  return (
    <label className="hidden items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 pl-2.5 pr-1 py-1 md:flex">
      <ListChecks className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
      {current && <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", statusDot(current.status))} />}
      <select
        value={runId ?? ""}
        onChange={(e) => setRunId(e.target.value)}
        aria-label="Active evaluation run"
        className="max-w-[230px] bg-transparent text-[12px] font-medium text-slate-700 dark:text-slate-200 outline-none"
      >
        {visible.map((run) => (
          <option key={run.id} value={run.id}>
            {run.id === latestId ? "Latest" : run.id.slice(0, 8)} · {systemNameById.get(run.ai_system_id) ?? "system"} ·{" "}
            {run.status.replace(/_/g, " ")}
          </option>
        ))}
      </select>
    </label>
  );
}
