import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  FileSearch,
  FileText,
  ListChecks,
  Loader2,
  PlayCircle,
  Scale,
  ShieldAlert,
  type LucideIcon,
  XCircle,
} from "lucide-react";
import clsx from "clsx";
import { Card, CardHeader } from "@/components/ui/Card";
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

const RUN_HISTORY_RETURN_KEY = "governai-run-history-return";
const ACTIVE_STATUSES = new Set(["running", "active", "council_running", "agents_running", "metrics_running"]);
const FAILED_STATUSES = new Set(["failed", "degraded", "cancelled", "canceled"]);
const TERMINAL_FAILED = Array.from(FAILED_STATUSES);

type RunHistoryReturnState = {
  filter: StatusFilter;
  scrollY: number;
  expandedId: string | null;
};

// The five developer-facing pipeline stages, in order.
const PIPELINE = ["Context", "Metrics", "Agents", "Council", "Report"] as const;

function humanize(text: string): string {
  return text.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function fmtTime(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function fmtDuration(start?: string | null, end?: string | null): string {
  if (!start) return "—";
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return "—";
  const secs = Math.round((e - s) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  if (mins < 60) return `${mins}m ${rem}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function statusTone(status: string): "green" | "red" | "amber" | "blue" | "slate" {
  const s = status.toLowerCase();
  if (s === "completed" || s === "report_ready") return "green";
  if (TERMINAL_FAILED.includes(s)) return "red";
  if (s === "degraded") return "amber";
  if (s === "running" || s.endsWith("_running")) return "amber";
  if (s === "created") return "slate";
  return "blue";
}

function isActive(status: string): boolean {
  return ACTIVE_STATUSES.has(status.toLowerCase());
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// ─── Pipeline progress derivation ─────────────────────────────────────────────

function phaseStepIndex(phase: string): number {
  switch (phase) {
    case "context_assembly":
    case "adaptive_orchestrator":
      return 0;
    case "metric_execution":
      return 1;
    case "specialist_agents":
      return 2;
    case "deliberation_council":
      return 3;
    case "action_reporting":
      return 4;
    default:
      return -1;
  }
}

type StepState = "done" | "active" | "failed" | "pending";

function pipelineStates(run: EvaluationRun): StepState[] {
  const s = run.status.toLowerCase();
  const completed = s === "completed" || s === "report_ready";
  const failed = TERMINAL_FAILED.includes(s);
  const idx = phaseStepIndex(run.current_phase);
  return PIPELINE.map((_, i) => {
    if (completed) return "done";
    if (idx < 0) return "pending";
    if (i < idx) return "done";
    if (i === idx) return failed ? "failed" : "active";
    return "pending";
  });
}

// ─── Run-summary readouts (all sourced from run.result_summary) ────────────────

type RunStats = {
  metrics: number;
  evidence: number | null;
  metricResults: number | null;
  findings: number | null;
  errors: number;
  verdict: { text: "Approved" | "Blocked" | "Pending"; tone: "green" | "red" | "slate" };
  councilConfidence: number | null;
  councilIterations: number | null;
};

function runStats(run: EvaluationRun): RunStats {
  const rs = run.result_summary ?? {};
  const evidence = num(rs.evidence_created);
  const metricResults = num(rs.metric_results_created);
  const findings = num(rs.agent_findings_created);
  const failedAgents = num(rs.agent_executions_failed) ?? 0;
  const hasErrorSummary = !!run.error_summary && Object.keys(run.error_summary).length > 0;
  const errors = failedAgents + (hasErrorSummary && failedAgents === 0 ? 1 : 0);

  const label = typeof rs.council_label === "string" ? rs.council_label.toLowerCase() : "";
  const verdict =
    label === "approved"
      ? ({ text: "Approved", tone: "green" } as const)
      : label === "blocked"
        ? ({ text: "Blocked", tone: "red" } as const)
        : ({ text: "Pending", tone: "slate" } as const);

  return {
    metrics: metricResults ?? run.selected_metrics.length,
    evidence,
    metricResults,
    findings,
    errors,
    verdict,
    councilConfidence: num(rs.council_confidence_score),
    councilIterations: num(rs.council_iterations),
  };
}

// ─── UI atoms ──────────────────────────────────────────────────────────────────

const CHIP_TONE: Record<string, string> = {
  green: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400",
  red: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400",
  amber: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-400",
  blue: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-400",
  slate: "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

function Chip({ label, value, tone = "slate" }: { label: string; value: string | number; tone?: keyof typeof CHIP_TONE }) {
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium", CHIP_TONE[tone])}>
      <span className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </span>
  );
}

function PipelineStepper({ states }: { states: StepState[] }) {
  return (
    <div className="flex items-center">
      {PIPELINE.map((label, i) => {
        const st = states[i];
        return (
          <div key={label} className="flex items-center">
            <div className="flex items-center gap-1.5">
              <span
                className={clsx(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
                  st === "done" && "bg-emerald-500 text-white",
                  st === "active" && "bg-blue-600 text-white",
                  st === "failed" && "bg-red-500 text-white",
                  st === "pending" && "bg-slate-200 text-slate-400 dark:bg-slate-700 dark:text-slate-500",
                )}
              >
                {st === "done" ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : st === "active" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : st === "failed" ? (
                  <XCircle className="h-3 w-3" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                )}
              </span>
              <span
                className={clsx(
                  "text-[10.5px] font-medium",
                  st === "active"
                    ? "text-blue-700 dark:text-blue-400"
                    : st === "done"
                      ? "text-slate-700 dark:text-slate-300"
                      : st === "failed"
                        ? "text-red-600 dark:text-red-400"
                        : "text-slate-400 dark:text-slate-500",
                )}
              >
                {label}
              </span>
            </div>
            {i < PIPELINE.length - 1 && (
              <span
                className={clsx(
                  "mx-1.5 h-px w-5 shrink-0",
                  states[i] === "done" ? "bg-emerald-300 dark:bg-emerald-700" : "bg-slate-200 dark:bg-slate-700",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Frameworks({ frameworks }: { frameworks: string[] }) {
  if (frameworks.length === 0) return <span className="text-[11px] text-slate-400">No frameworks</span>;
  const shown = frameworks.slice(0, 3);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((fw) => (
        <span key={fw} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
          {humanize(fw)}
        </span>
      ))}
      {frameworks.length > shown.length && (
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-400">
          +{frameworks.length - shown.length}
        </span>
      )}
    </div>
  );
}

function readReturnState(): RunHistoryReturnState | null {
  try {
    const raw = sessionStorage.getItem(RUN_HISTORY_RETURN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RunHistoryReturnState>;
    const filter = parsed.filter;
    if (filter !== "all" && filter !== "running" && filter !== "completed" && filter !== "failed") return null;
    return {
      filter,
      scrollY: typeof parsed.scrollY === "number" ? parsed.scrollY : 0,
      expandedId: typeof parsed.expandedId === "string" ? parsed.expandedId : null,
    };
  } catch {
    return null;
  }
}

function writeReturnState(state: RunHistoryReturnState) {
  sessionStorage.setItem(RUN_HISTORY_RETURN_KEY, JSON.stringify(state));
}

function FilterKpiCard({
  label,
  value,
  icon: Icon,
  tone = "slate",
  selected,
  detail,
  onClick,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  tone?: "slate" | "green" | "amber" | "red";
  selected: boolean;
  detail: string;
  onClick: () => void;
}) {
  const iconColor = {
    slate: "text-slate-300 dark:text-slate-600",
    green: "text-emerald-400 dark:text-emerald-600",
    amber: "text-amber-400 dark:text-amber-600",
    red: "text-red-400 dark:text-red-600",
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={clsx(
        "rounded-xl bg-white px-4 py-3 text-left shadow-card ring-1 transition-all dark:bg-slate-900",
        selected
          ? "ring-2 ring-brand-500 dark:ring-brand-500"
          : "ring-black/3 hover:shadow-md hover:ring-slate-200 dark:ring-white/6 dark:hover:ring-slate-700",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className={clsx("text-[11px] font-semibold uppercase tracking-[0.1em]", selected ? "text-brand-700 dark:text-brand-300" : "text-slate-500 dark:text-slate-400")}>{label}</p>
        <Icon className={clsx("h-4 w-4 shrink-0", selected ? "text-brand-600 dark:text-brand-400" : iconColor)} />
      </div>
      <p className="mt-1.5 text-3xl font-bold tracking-tight text-slate-900 tabular-nums dark:text-white">{value}</p>
      <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">{detail}</p>
    </button>
  );
}

// ─── Run card ────────────────────────────────────────────────────────────────

function RunCard({
  run,
  systemName,
  expanded,
  onToggle,
  onOpenRun,
  onNavigate,
}: {
  run: EvaluationRun;
  systemName: string;
  expanded: boolean;
  onToggle: () => void;
  onOpenRun: () => void;
  onNavigate: (path: string) => void;
}) {
  const stats = runStats(run);
  const states = pipelineStates(run);
  const tone = statusTone(run.status);
  const railColor =
    tone === "green" ? "before:bg-emerald-500" : tone === "red" ? "before:bg-red-500" : tone === "amber" ? "before:bg-amber-500" : tone === "blue" ? "before:bg-blue-500" : "before:bg-slate-300 dark:before:bg-slate-600";

  return (
    <div
      className={clsx(
        "relative overflow-hidden rounded-lg border bg-white transition-colors dark:bg-slate-900",
        "before:absolute before:inset-y-0 before:left-0 before:w-1",
        railColor,
        expanded ? "border-brand-300 dark:border-brand-700" : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600",
      )}
    >
      {/* Clickable summary */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        className="flex w-full cursor-pointer flex-col gap-3 px-4 py-3 pl-5 text-left"
      >
        {/* Row 1 — identity + status + action */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
          )}
          <span className="font-mono text-[12px] font-bold text-slate-950 dark:text-white">{shortId(run.id)}</span>
          <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">{systemName}</span>
          <Badge tone={tone}>{humanize(run.status)}</Badge>
          {run.current_phase && (
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              phase: <span className="font-medium text-slate-700 dark:text-slate-300">{humanize(run.current_phase)}</span>
            </span>
          )}
          <span className="ml-auto" />
          <button
            onClick={(e) => { e.stopPropagation(); onOpenRun(); }}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-2.5 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-brand-700"
          >
            <PlayCircle className="h-3.5 w-3.5" /> Open Live Run
          </button>
        </div>

        {/* Row 2 — pipeline progress */}
        <PipelineStepper states={states} />

        {/* Row 3 — structured chips + frameworks + timing */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip label="Metrics" value={stats.metrics} tone="blue" />
            <Chip label="Evidence" value={stats.evidence ?? "—"} tone="slate" />
            <Chip label="Findings" value={stats.findings ?? "—"} tone={stats.findings ? "amber" : "slate"} />
            <Chip label="Verdict" value={stats.verdict.text} tone={stats.verdict.tone} />
            <Chip label="Errors" value={stats.errors} tone={stats.errors > 0 ? "red" : "slate"} />
          </div>
          <span className="h-3.5 w-px bg-slate-200 dark:bg-slate-700" />
          <Frameworks frameworks={run.selected_frameworks} />
          <div className="ml-auto flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" /> {fmtTime(run.started_at)}
            </span>
            <span className="inline-flex items-center gap-1 tabular-nums">
              {isActive(run.status) ? "elapsed" : "took"} {fmtDuration(run.started_at, run.completed_at)}
            </span>
          </div>
        </div>
      </div>

      {/* Expanded investigation panel */}
      {expanded && (
        <RunDetail run={run} stats={stats} onOpenRun={onOpenRun} onNavigate={onNavigate} />
      )}
    </div>
  );
}

function DetailStat({ icon: Icon, label, value, tone = "slate" }: { icon: typeof Database; label: string; value: string | number; tone?: keyof typeof CHIP_TONE }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <p className={clsx("mt-1 text-[15px] font-bold tabular-nums", tone === "red" ? "text-red-600 dark:text-red-400" : tone === "green" ? "text-emerald-600 dark:text-emerald-400" : "text-slate-900 dark:text-white")}>
        {value}
      </p>
    </div>
  );
}

function RunDetail({
  run,
  stats,
  onOpenRun,
  onNavigate,
}: {
  run: EvaluationRun;
  stats: RunStats;
  onOpenRun: () => void;
  onNavigate: (path: string) => void;
}) {
  const hasError = !!run.error_summary && Object.keys(run.error_summary).length > 0;
  const councilStatus =
    stats.verdict.text === "Pending"
      ? "Not yet deliberated"
      : `${stats.verdict.text}${stats.councilConfidence != null ? ` · ${Math.round(stats.councilConfidence * 100)}% confidence` : ""}${stats.councilIterations != null ? ` · ${stats.councilIterations} iteration${stats.councilIterations === 1 ? "" : "s"}` : ""}`;

  const links: Array<{ label: string; icon: typeof FileSearch; path: string }> = [
    { label: "View Evidence", icon: FileSearch, path: "/evidence" },
    { label: "View Findings", icon: ShieldAlert, path: "/findings" },
    { label: "View Verdict", icon: Scale, path: "/verdicts" },
    { label: "View Report", icon: FileText, path: "/reports" },
  ];

  return (
    <div className="border-t border-slate-200 bg-slate-50/70 px-5 py-4 dark:border-slate-700 dark:bg-slate-800/40">
      {/* Run summary line */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Run Summary</p>
        <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{run.id}</span>
        <span className="text-slate-300 dark:text-slate-600">·</span>
        <span className="text-[11px] text-slate-600 dark:text-slate-300">
          {fmtTime(run.started_at)} → {run.completed_at ? fmtTime(run.completed_at) : "in progress"} ({fmtDuration(run.started_at, run.completed_at)})
        </span>
      </div>

      {/* Structured stat grid */}
      <div className="grid gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <DetailStat icon={ListChecks} label="Selected metrics" value={run.selected_metrics.length} />
        <DetailStat icon={Database} label="Evidence created" value={stats.evidence ?? "—"} />
        <DetailStat icon={Boxes} label="Metric results" value={stats.metricResults ?? "—"} />
        <DetailStat icon={ShieldAlert} label="Agent findings" value={stats.findings ?? "—"} tone={stats.findings ? "red" : "slate"} />
        <DetailStat icon={Scale} label="Council" value={stats.verdict.text} tone={stats.verdict.tone === "green" ? "green" : stats.verdict.tone === "red" ? "red" : "slate"} />
        <DetailStat icon={AlertTriangle} label="Errors" value={stats.errors} tone={stats.errors > 0 ? "red" : "slate"} />
      </div>

      {/* Frameworks + council status */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Selected frameworks</p>
          {run.selected_frameworks.length ? (
            <div className="flex flex-wrap gap-1.5">
              {run.selected_frameworks.map((fw) => (
                <span key={fw} className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {humanize(fw)}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-slate-400">None selected — minimal default metric spread used.</p>
          )}
        </div>
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Council status</p>
          <p className="text-[12px] font-medium text-slate-700 dark:text-slate-300">{councilStatus}</p>
        </div>
      </div>

      {/* Error summary, only when present */}
      {hasError && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 dark:border-red-900/50 dark:bg-red-950/30">
          <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">
            <AlertTriangle className="h-3 w-3" /> Error summary
          </p>
          <div className="space-y-0.5">
            {Object.entries(run.error_summary ?? {}).map(([k, v]) => (
              <p key={k} className="text-[11px] text-red-700 dark:text-red-300">
                <span className="font-semibold">{humanize(k)}:</span> {typeof v === "object" ? JSON.stringify(v) : String(v)}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Drill-down actions */}
      <div className="mt-4 flex flex-wrap gap-2">
        {links.map((link) => (
          <button
            key={link.path}
            onClick={() => onNavigate(link.path)}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-brand-700 dark:hover:text-brand-400"
          >
            <link.icon className="h-3.5 w-3.5" /> {link.label}
          </button>
        ))}
        <button
          onClick={onOpenRun}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-brand-700"
        >
          <PlayCircle className="h-3.5 w-3.5" /> Open Live Run <ArrowRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export function EvaluationRuns() {
  const navigateTo = useAppStore((s) => s.navigateTo);
  const focusRun = useSelectionStore((s) => s.focusRun);
  const initialReturnState = useRef<RunHistoryReturnState | null>(readReturnState());
  const [runs, setRuns] = useState<EvaluationRun[]>([]);
  const [systems, setSystems] = useState<BackendAISystem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>(initialReturnState.current?.filter ?? "all");
  const [expandedId, setExpandedId] = useState<string | null>(initialReturnState.current?.expandedId ?? null);

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
      if (ACTIVE_STATUSES.has(s)) active += 1;
      else if (s === "completed") completed += 1;
      else if (FAILED_STATUSES.has(s)) failed += 1;
    }
    return { total: runs.length, active, completed, failed };
  }, [runs]);

  const filtered = useMemo(() => {
    return runs.filter((r) => {
      const s = r.status.toLowerCase();
      if (filter === "all") return true;
      if (filter === "running") return isActive(r.status);
      if (filter === "completed") return s === "completed";
      if (filter === "failed") return FAILED_STATUSES.has(s);
      return true;
    });
  }, [runs, filter]);

  const filterCards: Array<{ key: StatusFilter; label: string; count: number; icon: LucideIcon; tone?: "slate" | "green" | "amber" | "red"; detail: string }> = [
    { key: "all", label: "Total Runs", count: counts.total, icon: ListChecks, detail: "Shows every run" },
    { key: "running", label: "Active", count: counts.active, icon: PlayCircle, tone: "amber", detail: "running, active, council/agents/metrics" },
    { key: "completed", label: "Completed", count: counts.completed, icon: CheckCircle2, tone: "green", detail: "completed only" },
    { key: "failed", label: "Failed", count: counts.failed, icon: XCircle, tone: "red", detail: "failed, degraded, cancelled" },
  ];

  useEffect(() => {
    const state = initialReturnState.current;
    if (!loading && state) {
      window.setTimeout(() => window.scrollTo({ top: state.scrollY, behavior: "auto" }), 0);
      initialReturnState.current = null;
    }
  }, [loading]);

  function openRun(run: EvaluationRun) {
    focusRun(run.id, run.ai_system_id);
    writeReturnState({ filter, scrollY: window.scrollY, expandedId });
    navigateTo("/runs");
  }

  function navigateScoped(run: EvaluationRun, path: string) {
    focusRun(run.id, run.ai_system_id);
    navigateTo(path);
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-700 dark:text-blue-400">Run History</p>
        <h1 className="mt-1 flex items-center gap-2 text-[20px] font-semibold tracking-tight text-slate-950 dark:text-white">
          <ListChecks className="h-5 w-5 text-slate-400" />
          Run investigation
        </h1>
        <p className="mt-1 max-w-3xl text-[13px] leading-5 text-slate-600 dark:text-slate-400">
          Every governance evaluation triggered against a registered system. Scan status and pipeline progress at a glance; expand any run to investigate counts, council outcome, errors, and drill into evidence.
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid gap-3 md:grid-cols-4">
        {filterCards.map((card) => (
          <FilterKpiCard
            key={card.key}
            label={card.label}
            value={card.count}
            icon={card.icon}
            tone={card.tone}
            selected={filter === card.key}
            detail={card.detail}
            onClick={() => {
              setFilter(card.key);
              setExpandedId(null);
            }}
          />
        ))}
      </div>

      {/* Run list */}
      <Card className="overflow-visible">
        <CardHeader title="Runs" eyebrow={loading ? "Loading…" : `${filtered.length} of ${runs.length} shown · click a run to investigate`} />
        {loading ? (
          <div className="flex items-center gap-2 px-5 py-12 text-[13px] text-slate-500 dark:text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading evaluation runs…
          </div>
        ) : error ? (
          <div className="m-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">Could not load evaluation runs.</p>
              <p className="mt-0.5 break-all">{error}</p>
            </div>
          </div>
        ) : systems.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="text-[14px] font-semibold text-slate-900 dark:text-white">No AI system registered</p>
            <p className="mx-auto mt-1 max-w-md text-[13px] text-slate-500 dark:text-slate-400">Register an AI system and start a governance run — real runs will appear here.</p>
          </div>
        ) : runs.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="text-[14px] font-semibold text-slate-900 dark:text-white">No governance runs yet</p>
            <p className="mx-auto mt-1 max-w-md text-[13px] text-slate-500 dark:text-slate-400">Start a governance run from the Developer Workspace to populate run history.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-slate-500 dark:text-slate-400">No runs match this filter.</div>
        ) : (
          <div className="space-y-2.5 p-4">
            {filtered.map((run) => (
              <RunCard
                key={run.id}
                run={run}
                systemName={systemNameById.get(run.ai_system_id) ?? shortId(run.ai_system_id)}
                expanded={expandedId === run.id}
                onToggle={() => setExpandedId((cur) => (cur === run.id ? null : run.id))}
                onOpenRun={() => openRun(run)}
                onNavigate={(path) => navigateScoped(run, path)}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
