import { useEffect, useRef, useState } from "react";
import { Inbox, RefreshCw } from "lucide-react";
import clsx from "clsx";
import { useAssessmentRequestsInbox, type InboxRequest } from "@/hooks/useAssessmentRequestsInbox";
import { useAppStore } from "@/store/useAppStore";
import { useRequestsInboxNav } from "@/store/useRequestsInboxNav";

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Top-bar inbox for auditor → developer assessment requests — separate from
 * the governance-events notification bell since these need a developer to
 * act on them (acknowledge / run / resolve), not just read a status update. */
export function RequestsInboxMenu() {
  const { items, unreadCount, markRead, markAllRead } = useAssessmentRequestsInbox();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigateTo = useAppStore((s) => s.navigateTo);
  const goToSystemRequests = useRequestsInboxNav((s) => s.goToSystemRequests);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function handleSelect(item: InboxRequest) {
    markRead(item.id);
    goToSystemRequests(item.ai_system_id);
    setOpen(false);
    navigateTo("/systems");
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Assessment requests"
        aria-haspopup="true"
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-700 dark:hover:text-white transition-colors"
      >
        <Inbox className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute right-1.5 top-1.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-brand-600 px-0.5 text-[8.5px] font-bold leading-none text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-80 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg dark:shadow-black/40 z-50 animate-fade-in overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 px-3.5 py-2.5">
            <p className="text-[12.5px] font-semibold text-slate-900 dark:text-white">Assessment requests</p>
            {items.length > 0 && (
              <button
                onClick={() => markAllRead()}
                className="text-[11px] font-medium text-brand-600 dark:text-brand-400 hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Inbox className="mx-auto h-5 w-5 text-slate-300 dark:text-slate-600 mb-2" />
                <p className="text-[12px] text-slate-500 dark:text-slate-400">No open requests from auditors.</p>
              </div>
            ) : (
              items.map((item) => {
                const unread = !item.read;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleSelect(item)}
                    className={clsx(
                      "flex w-full items-start gap-2.5 border-b border-slate-50 dark:border-slate-700/60 px-3.5 py-2.5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/50",
                      unread && "bg-brand-50/50 dark:bg-brand-900/10"
                    )}
                  >
                    <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-medium text-slate-800 dark:text-slate-200">
                        {item.status === "pending" ? "Re-assessment requested" : "Re-assessment in progress"} — {item.systemName}
                      </p>
                      <p
                        title={`${item.requested_by_name} · ${item.requested_by_role}${item.note ? ` — "${item.note}"` : ""}`}
                        className="mt-0.5 line-clamp-2 text-[11.5px] text-slate-500 dark:text-slate-400"
                      >
                        {item.requested_by_name} · {item.requested_by_role}
                        {item.note ? ` — "${item.note}"` : ""}
                      </p>
                      <p className="mt-1 text-[10.5px] text-slate-400 dark:text-slate-500">{timeAgo(item.created_at)}</p>
                    </div>
                    {unread && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
