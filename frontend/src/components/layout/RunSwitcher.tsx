import { ListChecks } from "lucide-react";
import { useActiveRun } from "@/hooks/useActiveRun";

function statusDot(status: string): string {
  const s = status.toLowerCase();
  if (s === "completed" || s === "report_ready") return "bg-emerald-500";
  if (s === "failed" || s === "cancelled") return "bg-red-500";
  if (s === "created") return "bg-slate-400";
  return "bg-amber-500";
}

/**
 * Global run switcher in the header. Selecting a run here drives every
 * run-scoped tab (Evidence, Metric Results, Findings, Verdicts, Reports,
 * Compliance, Governance State, LLM Boundary, Live Run) through the shared
 * selection store.
 */
export function RunSwitcher() {
  const { runs, runId, setRunId, systemNameById } = useActiveRun();
  if (runs.length === 0) return null;

  const current = runs.find((r) => r.id === runId);

  return (
    <label className="hidden items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 pl-2.5 pr-1 py-1 md:flex">
      <ListChecks className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
      {current && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(current.status)}`} />}
      <select
        value={runId ?? ""}
        onChange={(e) => setRunId(e.target.value)}
        aria-label="Active evaluation run"
        className="max-w-[230px] bg-transparent text-[12px] font-medium text-slate-700 dark:text-slate-200 outline-none"
      >
        {runs.map((run, i) => (
          <option key={run.id} value={run.id}>
            {i === 0 ? "Latest" : run.id.slice(0, 8)} · {systemNameById.get(run.ai_system_id) ?? "system"} ·{" "}
            {run.status.replace(/_/g, " ")}
          </option>
        ))}
      </select>
    </label>
  );
}
