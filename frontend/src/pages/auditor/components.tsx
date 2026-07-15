import type { LucideIcon } from "lucide-react";
import { FlaskConical, Info, RefreshCw, ServerCrash, X } from "lucide-react";
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

/* ───────────────────────────────────────────── priority + modal ── */

const PRIORITY_TONE: Record<string, string> = {
  high: "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400",
  medium: "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400",
  low: "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300",
};

export function PriorityTag({ priority }: { priority: string }) {
  const key = priority.toLowerCase();
  return (
    <span className={clsx("shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", PRIORITY_TONE[key] ?? PRIORITY_TONE.low)}>
      {priority}
    </span>
  );
}

/**
 * Honest disclosure that a surface is a local-only interactive preview. Used on
 * My Assignments and Notes & Queries, which have no backend entity yet — the
 * auditor can genuinely use them, but the data lives in this browser only.
 */
export function DemoDataBanner({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/30 px-3.5 py-2.5 text-[12px] leading-5 text-amber-800 dark:text-amber-300">
      <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
      <span>{children}</span>
    </div>
  );
}

/** Lightweight centered modal shell shared by the auditor collaboration pages. */
export function AuditorModal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  maxWidth = "max-w-lg",
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[3px]" onClick={onClose} />
      <div className={clsx("relative z-10 flex max-h-[85vh] w-full flex-col rounded-xl bg-white shadow-2xl ring-1 ring-black/10 dark:bg-slate-900 dark:ring-white/10", maxWidth)}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div>
            <p className="text-[15px] font-semibold text-slate-950 dark:text-white">{title}</p>
            {subtitle && <p className="text-[11px] text-slate-500 dark:text-slate-400">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex gap-2 border-t border-slate-200 px-5 py-3.5 dark:border-slate-700">{footer}</div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────── time helpers ── */

/** Short relative time ("just now", "3h ago", "2d ago", else a date). */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.floor((Date.now() - then) / 1000);
  if (secs < 45) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Format a yyyy-mm-dd due date for display; null → "No due date". */
export function formatDueDate(date: string | null): string {
  if (!date) return "No due date";
  const d = new Date(date + "T00:00:00");
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** A due date is overdue when it is strictly before today (local). */
export function isOverdue(date: string | null): boolean {
  if (!date) return false;
  const d = new Date(date + "T00:00:00").getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return !Number.isNaN(d) && d < today.getTime();
}

/** First 8 chars of a run id, for compact display. */
export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}
