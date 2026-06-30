import type { LucideIcon } from "lucide-react";

/**
 * Temporary scaffold for pages whose full implementation is in progress.
 * Replaced by the real page component; kept as a graceful fallback.
 */
export function PageScaffold({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="max-w-md rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 text-center">
        {Icon && (
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 dark:bg-brand-950/40 text-brand-600">
            <Icon className="h-6 w-6" />
          </div>
        )}
        <h2 className="font-display text-[18px] text-ink dark:text-white">{title}</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">{description}</p>
      </div>
    </div>
  );
}
