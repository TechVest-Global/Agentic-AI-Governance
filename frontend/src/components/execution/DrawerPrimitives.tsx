import type { ReactNode } from "react";
import clsx from "clsx";

/** Labeled section with a trailing rule, matching the engine reference's drawer sections. */
export function DrawerSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-6">
      <div className="mb-2.5 flex items-center gap-2">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500 shrink-0">{label}</p>
        <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
      </div>
      {children}
    </div>
  );
}

/** Arrow-bulleted "Receives" list. */
export function ReceivesList({ items }: { items: string[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item) => (
        <div key={item} className="flex items-start gap-2.5 text-[12.5px] text-slate-700 dark:text-slate-300">
          <span className="font-bold text-brand-600 dark:text-brand-400 shrink-0">→</span>
          {item}
        </div>
      ))}
    </div>
  );
}

/** 4-up "At a glance" stat grid. */
export function StatGrid({ stats }: { stats: Array<[label: string, value: string]> }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {stats.map(([label, value]) => (
        <div key={label} className="rounded-[10px] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-2.5 py-2.5 text-center">
          <p className="text-[17px] font-bold tabular-nums tracking-tight text-slate-950 dark:text-white">{value}</p>
          <p className="mt-0.5 text-[9.5px] font-semibold uppercase tracking-[0.03em] text-slate-400 dark:text-slate-500">{label}</p>
        </div>
      ))}
    </div>
  );
}

/** Simple data table matching .mtable — columns are header labels, rows are arrays of ReactNode. */
export function DrawerTable({ columns, rows }: { columns: string[]; rows: ReactNode[][] }) {
  return (
    <table className="w-full text-[12px]">
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c} className="border-b border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-left text-[10px] font-bold uppercase tracking-[0.04em] text-slate-400 dark:text-slate-500">{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j} className="border-b border-slate-100 dark:border-slate-800 px-2.5 py-2 align-top text-slate-700 dark:text-slate-300">{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Horizontal bar row for comparing weighted contributions (budget allocation, confidence dims). */
export function BarRow({ label, value, max, color, dotColor }: { label: ReactNode; value: string; max: number; color?: string; dotColor?: string }) {
  const pct = max > 0 ? Math.min(100, (Number(value.replace(/[^0-9.-]/g, "")) / max) * 100) : 0;
  return (
    <div className="grid grid-cols-[minmax(0,140px)_1fr_44px] items-center gap-3 py-1">
      <div className="flex items-center gap-1.5 text-[12px] text-slate-700 dark:text-slate-300 truncate">
        {dotColor && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dotColor }} />}
        <span className="truncate">{label}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <div className="h-full rounded-full transition-[width]" style={{ width: `${pct}%`, background: color ?? "#0d9488" }} />
      </div>
      <p className="text-right text-[12px] font-bold tabular-nums text-slate-950 dark:text-white">{value}</p>
    </div>
  );
}

/** Callout note with left accent border, optionally with a dashed "design note" footer. */
export function DrawerNote({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="rounded-[10px] border border-brand-100 dark:border-brand-900/40 border-l-[3px] border-l-brand-500 bg-brand-50/40 dark:bg-brand-950/20 p-3.5 text-[12.5px] leading-relaxed text-slate-700 dark:text-slate-300">
      {children}
      {footer && (
        <div className="mt-3 flex items-start gap-2 rounded-[9px] border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-[11.5px] text-slate-500 dark:text-slate-400">
          <span className="text-brand-600 dark:text-brand-400 shrink-0">⚑</span>
          {footer}
        </div>
      )}
    </div>
  );
}

/** Drawer header — icon, name, role/meta line, serif headline, mono method line. */
export function DrawerHeader({
  icon,
  iconColor,
  title,
  meta,
  headline,
  method,
}: {
  icon: ReactNode;
  iconColor: string;
  title: string;
  meta: ReactNode;
  headline: string;
  method?: string;
}) {
  return (
    <div className="border-b border-slate-200 dark:border-slate-700 px-5 py-5">
      <div className="flex items-center gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] text-white shadow-md"
          style={{ background: iconColor }}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <h2 className="text-[18px] font-semibold tracking-tight text-slate-950 dark:text-white">{title}</h2>
          <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-400 dark:text-slate-500">{meta}</p>
        </div>
      </div>
      <p className="font-display mt-3.5 text-[15.5px] leading-snug text-slate-700 dark:text-slate-300">{headline}</p>
      {method && <p className="mt-1.5 font-mono text-[11px] text-slate-400 dark:text-slate-500">{method}</p>}
    </div>
  );
}

export function severityTone(severity: string): "red" | "amber" | "green" | "slate" {
  const s = severity.toLowerCase();
  if (s === "critical" || s === "high") return "red";
  if (s === "medium" || s === "med") return "amber";
  if (s === "low") return "green";
  return "slate";
}

export function SeverityPill({ severity }: { severity: string }) {
  const tone = severityTone(severity);
  const classes = {
    red: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
    green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
    slate: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  }[tone];
  return <span className={clsx("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide", classes)}>{severity}</span>;
}
