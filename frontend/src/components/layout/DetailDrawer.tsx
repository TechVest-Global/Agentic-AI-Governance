import { useEffect } from "react";
import { X } from "lucide-react";
import clsx from "clsx";

/**
 * Right-side slide-over panel — the "open it in place" surface for the
 * Governance Workflow. Clicking an agent, the council, the verdict, an evidence
 * record, or a ledger entry opens its full detail here instead of navigating to
 * a separate tab. Closes on backdrop click or Escape.
 */
export function DetailDrawer({
  open,
  title,
  eyebrow,
  badge,
  onClose,
  children,
  width = "wide",
}: {
  open: boolean;
  title: string;
  eyebrow?: string;
  badge?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  width?: "wide" | "regular";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Lock background scroll while the drawer is open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      {/* Backdrop */}
      <button
        aria-label="Close panel"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/40 dark:bg-slate-950/60 backdrop-blur-[1px] animate-fade-in"
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={clsx(
          "relative flex h-full w-full flex-col bg-white dark:bg-slate-900 shadow-2xl animate-slide-in-right",
          width === "wide" ? "max-w-2xl" : "max-w-md",
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-700 px-5 py-4">
          <div className="min-w-0">
            {eyebrow && (
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-600 dark:text-brand-400">{eyebrow}</p>
            )}
            <div className="mt-0.5 flex items-center gap-2">
              <h2 className="truncate font-display text-[19px] text-ink dark:text-white">{title}</h2>
              {badge}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>
  );
}
