import { useMemo, useState } from "react";
import { ArrowRight, GitBranch, Info, ShieldAlert, Wrench } from "lucide-react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { MetricCard } from "@/components/ui/MetricCard";
import { useAppStore } from "@/store/useAppStore";
import { useSelectionStore } from "@/store/useSelectionStore";
import { useAuditorWorkspace, type RemediationItem } from "@/hooks/useAuditorWorkspace";
import { AuditorPageHeader, AuditorSkeleton, BackendError, PanelEmpty, SeverityTag } from "./components";

type SourceFilter = "all" | "verdict" | "finding";

export function Remediation() {
  const navigateTo = useAppStore((s) => s.navigateTo);
  const focusRun = useSelectionStore((s) => s.focusRun);
  const data = useAuditorWorkspace();
  const [source, setSource] = useState<SourceFilter>("all");

  const items = useMemo(() => {
    if (source === "all") return data.remediationItems;
    return data.remediationItems.filter((i) => i.source === source);
  }, [data.remediationItems, source]);

  const counts = useMemo(() => {
    let criticalHigh = 0;
    let fromVerdict = 0;
    for (const it of data.remediationItems) {
      const s = it.severity.toLowerCase();
      if (s === "critical" || s === "high") criticalHigh += 1;
      if (it.source === "verdict") fromVerdict += 1;
    }
    return { total: data.remediationItems.length, criticalHigh, fromVerdict };
  }, [data.remediationItems]);

  if (data.loading && !data.connected) return <AuditorSkeleton rows={3} />;
  if (data.error) return <BackendError message={data.error} onRetry={data.refresh} />;

  const openSource = (item: RemediationItem) => {
    focusRun(item.runId);
    navigateTo(item.source === "verdict" ? "/verdict-review" : "/findings-review");
  };

  const filters: Array<{ key: SourceFilter; label: string }> = [
    { key: "all", label: "All" },
    { key: "verdict", label: "Verdict actions" },
    { key: "finding", label: "Finding remediations" },
  ];

  return (
    <div className="space-y-5">
      <AuditorPageHeader
        eyebrow="Compliance & reporting"
        title="Remediation"
        description="Every open remediation obligation in scope — council-prescribed required actions and open findings with a recommended fix, aggregated across all runs."
        connected={data.connected}
        onRefresh={data.refresh}
        refreshing={data.loading}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Open Remediation" value={counts.total} icon={Wrench} tone={counts.total ? "amber" : "green"} compact />
        <MetricCard label="Critical / High" value={counts.criticalHigh} icon={ShieldAlert} tone={counts.criticalHigh ? "red" : "green"} compact />
        <MetricCard label="From Verdicts" value={counts.fromVerdict} icon={GitBranch} tone="slate" compact />
      </div>

      {/* Honest note: no due-date backend, so "overdue" cannot be computed. */}
      <div className="flex items-start gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-3.5 py-2.5 text-[12px] leading-5 text-slate-600 dark:text-slate-400">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <span>
          These items are derived live from verdicts and open findings. Due dates and formal remediation ownership are not
          tracked by the backend yet, so overdue status cannot be computed — items are ranked by severity.
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setSource(f.key)}
            className={clsx(
              "rounded border px-3 py-1.5 text-[12px] font-medium transition-colors",
              source === f.key
                ? "border-slate-900 bg-slate-900 text-white dark:border-brand-600 dark:bg-brand-700"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <Card className="p-4">
          <PanelEmpty
            label="No open remediation"
            hint="Council-prescribed actions and open finding remediations will appear here as runs complete."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id} className="overflow-hidden">
              <div className="flex items-start gap-3 p-4">
                <div
                  className={clsx(
                    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                    item.source === "verdict"
                      ? "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400"
                      : "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400",
                  )}
                >
                  {item.source === "verdict" ? <GitBranch className="h-4 w-4" /> : <Wrench className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[13px] font-semibold text-slate-950 dark:text-white">{item.title}</p>
                    <SeverityTag severity={item.severity} />
                    <span className="rounded bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {item.source === "verdict" ? "Verdict action" : "Finding"}
                    </span>
                  </div>
                  {item.detail && <p className="mt-1 text-[12px] leading-5 text-slate-600 dark:text-slate-400">{item.detail}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="font-medium text-slate-600 dark:text-slate-300">{item.systemName}</span>
                    {item.owner && <span>Owner: {item.owner}</span>}
                    {item.frameworkRefs.slice(0, 3).map((fw) => (
                      <span key={fw} className="rounded bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-300">
                        {fw}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => openSource(item)}
                  className="inline-flex shrink-0 items-center gap-1 self-center rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  Source
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
