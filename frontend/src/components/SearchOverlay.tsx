import { Search } from "lucide-react";
import clsx from "clsx";
import { navigation } from "@/data/mockData";
import type { Persona } from "@/types";

/**
 * Header quick-search. Navigates to pages the current persona can actually reach
 * — it respects both `personas` (who may access) and `hiddenFor` (pages kept out
 * of a persona's nav, e.g. the auditor-oriented Governance Workflow is hidden for
 * developers who use the Developer Workspace instead). Backend-driven entity
 * search (systems, runs, findings) is intentionally not faked here.
 */
export function SearchOverlay({
  query,
  onSelect,
  persona,
}: {
  query: string;
  onSelect: (path: string) => void;
  persona: Persona;
}) {
  const normalizedQuery = query.trim().toLowerCase();
  const pages = navigation.filter(
    (item) => item.personas.includes(persona) && !(item.hiddenFor?.includes(persona)),
  );
  const results = (normalizedQuery
    ? pages.filter((item) => `${item.label} ${item.section}`.toLowerCase().includes(normalizedQuery))
    : pages
  ).slice(0, 8);

  return (
    <div
      className="absolute left-0 top-11 z-50 w-full overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900"
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="border-b border-slate-100 px-3 py-2 text-[11px] font-medium text-slate-500 dark:border-slate-700/50 dark:text-slate-400">
        {normalizedQuery ? `${results.length} matches` : "Jump to a page"}
      </div>
      <div className="max-h-[420px] overflow-y-auto p-1.5">
        {results.length > 0 ? (
          results.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => onSelect(item.path)}
                className={clsx(
                  "flex w-full items-start gap-3 rounded px-2.5 py-2 text-left transition-colors",
                  "hover:bg-slate-50 focus:bg-slate-50 focus:outline-none dark:hover:bg-slate-800 dark:focus:bg-slate-800",
                )}
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-slate-950 dark:text-white">{item.label}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-slate-500 dark:text-slate-400">{item.section} workspace</span>
                </span>
                <span className="mt-1 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500 dark:border-slate-700 dark:text-slate-500">
                  Page
                </span>
              </button>
            );
          })
        ) : (
          <div className="flex items-center gap-2 px-3 py-8 text-[12px] text-slate-500 dark:text-slate-400">
            <Search className="h-4 w-4" />
            No matching page.
          </div>
        )}
      </div>
    </div>
  );
}
