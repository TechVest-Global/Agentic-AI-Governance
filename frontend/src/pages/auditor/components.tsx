import type { LucideIcon } from "lucide-react";
import { Info, RefreshCw, ServerCrash } from "lucide-react";
import clsx from "clsx";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { useAppStore } from "@/store/useAppStore";

/**
 * Auditor custom pages render their own rich header (eyebrow + title +
 * connected pill + refresh), so we suppress the global AppShell page header
 * while one is mounted to avoid a duplicate title. The reused assurance pages
 * (Evidence, Findings, Reports, Ledger) don't use this and keep the standard
 * AppShell header, matching the rest of the app.
 */
function useSuppressGlobalHeader() {
  const setHeaderHidden = useAppStore((s) => s.setHeaderHidden);
  useEffect(() => {
    setHeaderHidden(true);
    return () => setHeaderHidden(false);
  }, [setHeaderHidden]);
}

/* ─────────────────────────────────────────────────────────── states ── */

export function AuditorSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl bg-slate-200/70 dark:bg-slate-800" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-xl bg-slate-200/70 dark:bg-slate-800" />
    </div>
  );
}

export function BackendError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 text-center shadow-card">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 dark:bg-red-950/40 text-red-500">
          <ServerCrash className="h-6 w-6" />
        </div>
        <h2 className="mt-4 font-display text-[18px] text-ink dark:text-white">Backend unavailable</h2>
        <p className="mt-2 text-[13px] text-slate-500 dark:text-slate-400">
          Could not reach the governance API. Start the backend, then retry.
        </p>
        <code className="mt-3 block truncate rounded bg-slate-50 dark:bg-slate-800 px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400">
          {message}
        </code>
        <button
          onClick={onRetry}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-brand-700"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </button>
      </div>
    </div>
  );
}

/**
 * Honest empty state. Use for surfaces that have no backing data — either
 * because nothing has been produced yet, or because the backend concept
 * (assignments, notes) does not exist. The optional `note` is where we say so
 * plainly rather than faking rows.
 */
export function AuditorEmptyState({
  icon: Icon,
  title,
  description,
  note,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  note?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="max-w-lg rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-10 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
          <Icon className="h-6 w-6" />
        </div>
        <h2 className="font-display text-[18px] text-ink dark:text-white">{title}</h2>
        <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
          {description}
        </p>
        {note && (
          <div className="mx-auto mt-4 flex max-w-md items-start gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-3.5 py-2.5 text-left text-[12px] leading-5 text-slate-600 dark:text-slate-400">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <span>{note}</span>
          </div>
        )}
        {action && <div className="mt-5 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}

/** Small inline empty state that sits inside a panel/card body. */
export function PanelEmpty({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 p-8 text-center">
      <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-300">{label}</p>
      {hint && <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

/* ────────────────────────────────────────────────────── page header ── */

export function AuditorPageHeader({
  eyebrow,
  title,
  description,
  connected,
  onRefresh,
  refreshing,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  connected?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  action?: ReactNode;
}) {
  useSuppressGlobalHeader();
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && (
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-700 dark:text-brand-400">
            {eyebrow}
          </p>
        )}
        <h1 className="mt-1 font-display text-[22px] leading-tight text-ink dark:text-white">{title}</h1>
        {description && (
          <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
            {description}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        {action}
        {connected !== undefined && (
          <span
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
              connected
                ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400"
                : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400",
            )}
          >
            <span className={clsx("h-1.5 w-1.5 rounded-full", connected ? "bg-emerald-500" : "bg-slate-400")} />
            {connected ? "Backend connected" : "Offline"}
          </span>
        )}
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-[12px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            <RefreshCw className={clsx("h-3.5 w-3.5", refreshing && "animate-spin")} />
            Refresh
          </button>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── tags ── */

const SEVERITY_TONE: Record<string, string> = {
  critical: "bg-red-100 dark:bg-red-950/50 text-red-800 dark:text-red-300",
  high: "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400",
  medium: "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400",
  low: "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400",
  info: "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300",
};

export function SeverityTag({ severity }: { severity: string }) {
  const key = severity.toLowerCase();
  return (
    <span className={clsx("shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", SEVERITY_TONE[key] ?? SEVERITY_TONE.info)}>
      {severity}
    </span>
  );
}

const VERDICT_TONE: Record<string, string> = {
  approved: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400",
  conditional_approval: "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400",
  blocked: "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400",
};

export function VerdictTag({ label }: { label: string }) {
  return (
    <span className={clsx("shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold capitalize", VERDICT_TONE[label] ?? "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300")}>
      {label.replace(/_/g, " ")}
    </span>
  );
}

export function humanize(text: string): string {
  return text.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
