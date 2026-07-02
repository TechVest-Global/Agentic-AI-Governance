import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  ChevronDown,
  ChevronUp,
  Copy,
  FileText,
  Info,
  X,
  Zap,
} from "lucide-react";
import clsx from "clsx";
import type { AuditLedgerEntry } from "@/api/governanceApi";

type EventTone = "info" | "finding" | "action" | "warning" | "escalation";

const toneConfig: Record<EventTone, { icon: typeof Info; color: string; bg: string }> = {
  info: { icon: Info, color: "text-slate-500", bg: "bg-slate-100 dark:bg-slate-800" },
  finding: { icon: FileText, color: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-red-950/40" },
  action: { icon: Zap, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950/40" },
  warning: { icon: AlertTriangle, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/40" },
  escalation: { icon: Bell, color: "text-purple-600 dark:text-purple-400", bg: "bg-purple-50 dark:bg-purple-950/40" },
};

function toneFor(eventType: string): EventTone {
  if (eventType.includes("finding")) return "finding";
  if (eventType.includes("escalat")) return "escalation";
  if (eventType.includes("fail") || eventType.includes("gap")) return "warning";
  if (eventType.includes("completed") || eventType.includes("prepared") || eventType.includes("generated")) return "action";
  return "info";
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function titleCase(value: string): string {
  return value.replace(/[_.]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Real audit-ledger entries for this run, optionally filtered to one pipeline phase. Click a row to inspect its full payload and hash chain. */
export function RuntimeEventStream({ entries, phaseFilter }: { entries: AuditLedgerEntry[]; phaseFilter?: string }) {
  const [expanded, setExpanded] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [openEntry, setOpenEntry] = useState<AuditLedgerEntry | null>(null);

  const events = phaseFilter
    ? entries.filter((e) => (e.payload?.phase as string | undefined) === phaseFilter)
    : entries;
  const sorted = [...events].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const visibleEvents = showAll ? sorted : sorted.slice(0, 8);

  return (
    <>
      <div className="rounded-xl bg-white dark:bg-slate-900 shadow-card ring-1 ring-black/3 dark:ring-white/6">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700/50 px-4 py-3">
          <div>
            <p className="text-[13px] font-semibold text-slate-950 dark:text-white">Runtime Event Stream</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {phaseFilter ? `${titleCase(phaseFilter)} — chronological` : "Audit ledger — chronological"}
            </p>
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? "Collapse" : "Expand"}
          </button>
        </div>

        {expanded && (
          <div className="divide-y divide-slate-50 dark:divide-slate-800">
            {events.length === 0 && (
              <p className="px-4 py-6 text-center text-[12px] text-slate-400 dark:text-slate-500">
                No ledger events recorded for this layer yet.
              </p>
            )}
            {visibleEvents.map((event) => {
              const tone = toneFor(event.event_type);
              const config = toneConfig[tone];
              const Icon = config.icon;

              return (
                <button
                  key={event.id}
                  onClick={() => setOpenEntry(event)}
                  className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                >
                  <div className={clsx("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded", config.bg)}>
                    <Icon className={clsx("h-3 w-3", config.color)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] font-medium text-slate-500 dark:text-slate-400">{formatTime(event.created_at)}</span>
                      <ArrowRight className="h-2.5 w-2.5 text-slate-300 dark:text-slate-600 shrink-0" />
                      <span className="truncate text-[12px] text-slate-800 dark:text-slate-200">{titleCase(event.event_type)}</span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-slate-400 dark:text-slate-500">{event.actor_id ?? titleCase(event.actor_type)}</p>
                  </div>
                  <span className="shrink-0 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {titleCase((event.payload?.phase as string | undefined) ?? event.actor_type)}
                  </span>
                </button>
              );
            })}

            {sorted.length > 8 && (
              <div className="px-4 py-2.5">
                <button
                  onClick={() => setShowAll(!showAll)}
                  className="text-[11px] font-medium text-blue-700 dark:text-blue-400 hover:underline"
                >
                  {showAll ? "Show fewer events" : `Show all ${sorted.length} events`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <EventDetailDrawer entry={openEntry} onClose={() => setOpenEntry(null)} />
    </>
  );
}

function EventDetailDrawer({ entry, onClose }: { entry: AuditLedgerEntry | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!entry) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entry, onClose]);

  if (!entry) return null;

  const tone = toneFor(entry.event_type);
  const config = toneConfig[tone];
  const Icon = config.icon;

  function copyHash() {
    navigator.clipboard.writeText(entry!.entry_hash).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <button aria-label="Close" className="absolute inset-0 bg-black/40" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white dark:bg-slate-900 shadow-2xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className={clsx("flex h-9 w-9 items-center justify-center rounded-lg", config.bg)}>
              <Icon className={clsx("h-4 w-4", config.color)} />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
                {titleCase((entry.payload?.phase as string | undefined) ?? entry.actor_type)}
              </p>
              <h2 className="text-[15px] font-semibold text-slate-950 dark:text-white">{titleCase(entry.event_type)}</h2>
            </div>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 dark:text-slate-500">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 p-5 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Actor</p>
              <p className="mt-0.5 text-[12.5px] font-medium text-slate-900 dark:text-white">{entry.actor_id ?? titleCase(entry.actor_type)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Recorded</p>
              <p className="mt-0.5 text-[12.5px] font-medium text-slate-900 dark:text-white">{new Date(entry.created_at).toLocaleString()}</p>
            </div>
          </div>

          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">What happened</p>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
              <table className="w-full text-[12px]">
                <tbody>
                  {Object.entries(entry.payload ?? {}).map(([key, value]) => (
                    <tr key={key} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                      <td className="w-2/5 px-3 py-2 align-top text-[11px] font-medium text-slate-500 dark:text-slate-400">{titleCase(key)}</td>
                      <td className="px-3 py-2 align-top font-mono text-[11.5px] text-slate-800 dark:text-slate-200 wrap-break-word">
                        {typeof value === "object" ? JSON.stringify(value) : String(value)}
                      </td>
                    </tr>
                  ))}
                  {Object.keys(entry.payload ?? {}).length === 0 && (
                    <tr><td className="px-3 py-2 text-[12px] text-slate-400 dark:text-slate-500">No structured payload recorded.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Hash chain — how it's proven</p>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">This entry's hash</p>
                <button onClick={copyHash} className="flex items-center gap-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-[10px] text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                  <Copy className="h-3 w-3" /> {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <p className="font-mono text-[11px] text-slate-800 dark:text-slate-200 break-all">{entry.entry_hash}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Parent hash</p>
              <p className="font-mono text-[11px] text-slate-500 dark:text-slate-500 break-all">{entry.previous_hash ?? "genesis"}</p>
              <p className="text-[10.5px] leading-relaxed text-slate-400 dark:text-slate-500">
                Each entry's hash is derived from its own payload plus the previous entry's hash — so any change to an earlier
                entry would break every hash after it, which is what makes the chain tamper-evident.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
