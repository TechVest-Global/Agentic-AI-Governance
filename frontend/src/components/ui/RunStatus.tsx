import type { LucideIcon } from "lucide-react";
import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import clsx from "clsx";
import type { FindingSeverity, RunStatus } from "@/types";

// ─── Run Status Badge ──────────────────────────────────────────────────────────

const statusConfig: Record<RunStatus, { tone: string; icon: LucideIcon; spin?: boolean }> = {
  Running:  { tone: "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-950/50 dark:text-blue-300",       icon: Loader2, spin: true },
  Complete: { tone: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300", icon: CheckCircle2 },
  Waiting:  { tone: "border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400",    icon: Clock },
  Failed:   { tone: "border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-950/50 dark:text-red-300",             icon: XCircle },
};

export function RunStatusBadge({ status, size = "sm" }: { status: RunStatus; size?: "sm" | "md" }) {
  const cfg = statusConfig[status];
  const Icon = cfg.icon;
  return (
    <span className={clsx(
      "inline-flex items-center gap-1.5 rounded border font-medium",
      cfg.tone,
      size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-[12px]"
    )}>
      <Icon className={clsx("h-3 w-3", cfg.spin && "animate-spin")} />
      {status}
    </span>
  );
}

// ─── Progress Bar ──────────────────────────────────────────────────────────────

export function ProgressBar({
  value,
  tone = "blue",
  showLabel = false,
  className,
}: {
  value: number;
  tone?: "blue" | "green" | "amber" | "red" | "slate";
  showLabel?: boolean;
  className?: string;
}) {
  const barColor = {
    blue:  "bg-blue-600",
    green: "bg-emerald-500",
    amber: "bg-amber-500",
    red:   "bg-red-500",
    slate: "bg-slate-400",
  }[tone];

  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div className={clsx("flex items-center gap-2", className)}>
      <div className="h-1.5 flex-1 rounded-full bg-slate-100 dark:bg-slate-700">
        <div className={clsx("h-1.5 rounded-full transition-all", barColor)} style={{ width: `${clamped}%` }} />
      </div>
      {showLabel && (
        <span className="w-9 text-right text-[11px] font-medium tabular-nums text-slate-600 dark:text-slate-400">{clamped}%</span>
      )}
    </div>
  );
}

// ─── Severity Tag ──────────────────────────────────────────────────────────────

const severityConfig: Record<FindingSeverity, string> = {
  Critical: "border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-950/50 dark:text-red-300",
  High:     "border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-700 dark:bg-orange-950/50 dark:text-orange-300",
  Medium:   "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  Low:      "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
};

export function SeverityTag({ severity, size = "sm" }: { severity: FindingSeverity; size?: "sm" | "md" }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded border font-semibold uppercase tracking-wide",
        severityConfig[severity],
        size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]"
      )}
      title={`Severity: ${severity}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {severity}
    </span>
  );
}

// ─── Confidence Meter ──────────────────────────────────────────────────────────

export function ConfidenceMeter({ value, size = "sm" }: { value: number; size?: "sm" | "md" }) {
  const tone = value >= 80 ? "green" : value >= 60 ? "amber" : "red";
  const textColor = {
    green: "text-emerald-700 dark:text-emerald-400",
    amber: "text-amber-700 dark:text-amber-400",
    red:   "text-red-700 dark:text-red-400",
  }[tone];

  return (
    <div className="flex items-center gap-2" title={`Confidence: ${value}%`}>
      <div className={clsx(size === "sm" ? "w-16" : "w-24")}>
        <ProgressBar value={value} tone={tone} />
      </div>
      <span className={clsx("font-semibold tabular-nums", textColor, size === "sm" ? "text-[11px]" : "text-[12px]")}>
        {value}%
      </span>
    </div>
  );
}

// ─── Phase Tracker ─────────────────────────────────────────────────────────────

export type Phase = {
  label: string;
  status: "complete" | "running" | "waiting";
  detail?: string;
};

export function PhaseTracker({ phases, compact = false }: { phases: Phase[]; compact?: boolean }) {
  return (
    <div className="flex items-center gap-0">
      {phases.map((phase, idx) => (
        <div key={phase.label} className="flex flex-1 items-center" title={phase.detail}>
          <div className="flex flex-col items-center gap-1">
            <div className={clsx(
              "flex items-center justify-center rounded-full text-[10px] font-bold",
              compact ? "h-5 w-5" : "h-6 w-6",
              phase.status === "complete"
                ? "bg-emerald-500 text-white"
                : phase.status === "running"
                  ? "bg-blue-600 text-white"
                  : "bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
            )}>
              {phase.status === "complete" ? "✓" : idx + 1}
            </div>
            {!compact && (
              <p className={clsx(
                "text-center text-[9px] font-semibold leading-tight",
                phase.status === "complete"
                  ? "text-emerald-700 dark:text-emerald-400"
                  : phase.status === "running"
                    ? "text-blue-700 dark:text-blue-400"
                    : "text-slate-400 dark:text-slate-600"
              )}>
                {phase.label}
              </p>
            )}
          </div>
          {idx < phases.length - 1 && (
            <div className={clsx(
              "mx-1 h-0.5 flex-1",
              phase.status === "complete"
                ? "bg-emerald-300 dark:bg-emerald-800"
                : phase.status === "running"
                  ? "bg-blue-300 dark:bg-blue-800"
                  : "bg-slate-200 dark:bg-slate-700"
            )} />
          )}
        </div>
      ))}
    </div>
  );
}
