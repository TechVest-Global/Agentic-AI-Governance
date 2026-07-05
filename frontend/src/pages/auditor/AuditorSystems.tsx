import { useMemo, useState } from "react";
import { ArrowRight, Boxes, Search, ShieldCheck } from "lucide-react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge, toneForRisk } from "@/components/ui/Badge";
import { useAppStore } from "@/store/useAppStore";
import { useSelectionStore } from "@/store/useSelectionStore";
import { useAuditorWorkspace } from "@/hooks/useAuditorWorkspace";
import type { BackendAISystem } from "@/api/governanceApi";
import { AuditorPageHeader, AuditorSkeleton, BackendError, PanelEmpty, VerdictTag, humanize } from "./components";

const RISK_LABEL: Record<string, string> = { high: "High", medium: "Medium", low: "Low" };

export function AuditorSystems() {
  const navigateTo = useAppStore((s) => s.navigateTo);
  const setSelectedSystemId = useSelectionStore((s) => s.setSelectedSystemId);
  const focusRun = useSelectionStore((s) => s.focusRun);
  const data = useAuditorWorkspace();
  const [query, setQuery] = useState("");

  // Latest run + verdict per system, derived from the workspace review items.
  const summaryBySystem = useMemo(() => {
    const map = new Map<string, { runs: number; openFindings: number; verdictLabel: string | null; latestRunId: string | null }>();
    for (const item of data.reviewItems) {
      const entry = map.get(item.systemId) ?? { runs: 0, openFindings: 0, verdictLabel: null, latestRunId: null };
      entry.runs += 1;
      entry.openFindings += item.openFindings;
      // reviewItems come newest-first from the API; first seen is the latest.
      if (entry.latestRunId === null) {
        entry.latestRunId = item.run.id;
        entry.verdictLabel = item.verdictLabel;
      }
      map.set(item.systemId, entry);
    }
    return map;
  }, [data.reviewItems]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data.systemsInScope;
    return data.systemsInScope.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.owner.toLowerCase().includes(q) ||
        s.system_type.toLowerCase().includes(q),
    );
  }, [data.systemsInScope, query]);

  if (data.loading && !data.connected) return <AuditorSkeleton rows={3} />;
  if (data.error) return <BackendError message={data.error} onRetry={data.refresh} />;

  const openSystem = (system: BackendAISystem) => {
    setSelectedSystemId(system.id);
    const summary = summaryBySystem.get(system.id);
    if (summary?.latestRunId) {
      focusRun(summary.latestRunId, system.id);
      navigateTo("/findings-review");
    } else {
      navigateTo("/review-queue");
    }
  };

  return (
    <div className="space-y-5">
      <AuditorPageHeader
        eyebrow="Review"
        title="AI Systems"
        description="AI systems in scope for assurance. Read-only — inspect governance posture, findings, and verdicts. Registration and technical configuration are owned by the engineering side."
        connected={data.connected}
        onRefresh={data.refresh}
        refreshing={data.loading}
      />

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, owner, or type…"
          className="h-9 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 pl-9 pr-3 text-[13px] text-slate-900 dark:text-slate-100 outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:focus:ring-brand-700/40"
        />
      </div>

      {data.systemsInScope.length === 0 ? (
        <Card className="p-4">
          <PanelEmpty label="No AI systems in scope" hint="Systems appear here once they are registered by the engineering side, or once runs reference them." />
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-4">
          <PanelEmpty label="No systems match your search" hint="Try a different name, owner, or type." />
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl bg-white dark:bg-slate-900 shadow-card ring-1 ring-black/[0.03] dark:ring-white/6">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-700/60 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                <th className="px-4 py-3">System</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">Risk tier</th>
                <th className="px-4 py-3">Frameworks</th>
                <th className="px-4 py-3">Runs</th>
                <th className="px-4 py-3">Open findings</th>
                <th className="px-4 py-3">Latest verdict</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {filtered.map((system) => {
                const summary = summaryBySystem.get(system.id);
                return (
                  <tr
                    key={system.id}
                    onClick={() => openSystem(system)}
                    className="cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                          <ShieldCheck className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="truncate font-semibold text-slate-950 dark:text-white">{system.name}</p>
                            {system.status === "archived" && (
                              <span className="shrink-0 rounded bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                Archived
                              </span>
                            )}
                          </div>
                          <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{humanize(system.system_type)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{system.owner}</td>
                    <td className="px-4 py-3">
                      <Badge tone={toneForRisk(RISK_LABEL[system.risk_tier] ?? "Low")}>{RISK_LABEL[system.risk_tier] ?? humanize(system.risk_tier)}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {system.selected_frameworks.slice(0, 2).map((fw) => (
                          <span key={fw} className="rounded bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-300">
                            {fw}
                          </span>
                        ))}
                        {system.selected_frameworks.length > 2 && (
                          <span className="rounded bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:text-slate-400">
                            +{system.selected_frameworks.length - 2}
                          </span>
                        )}
                        {system.selected_frameworks.length === 0 && <span className="text-[11px] text-slate-400">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-600 dark:text-slate-300">{summary?.runs ?? 0}</td>
                    <td className="px-4 py-3">
                      <span className={clsx("tabular-nums font-semibold", (summary?.openFindings ?? 0) > 0 ? "text-red-600 dark:text-red-400" : "text-slate-600 dark:text-slate-300")}>
                        {summary?.openFindings ?? 0}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {summary?.verdictLabel ? <VerdictTag label={summary.verdictLabel} /> : <span className="text-[11px] text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ArrowRight className="ml-auto h-4 w-4 text-slate-300 dark:text-slate-600" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500">
        <Boxes className="h-3.5 w-3.5" />
        {data.systemsInScope.length} system{data.systemsInScope.length === 1 ? "" : "s"} in scope · read-only assurance view
      </p>
    </div>
  );
}
