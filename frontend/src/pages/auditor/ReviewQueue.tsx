import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, FileSearch, GitBranch } from "lucide-react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { useAppStore } from "@/store/useAppStore";
import { useSelectionStore } from "@/store/useSelectionStore";
import { useAuditorWorkspace, type ReviewItem } from "@/hooks/useAuditorWorkspace";
import { AuditorPageHeader, AuditorSkeleton, BackendError, PanelEmpty, VerdictTag } from "./components";

type QueueFilter = "review" | "verdict" | "all";

const RUN_STATUS_TONE: Record<string, string> = {
  completed: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400",
  report_ready: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400",
  running: "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400",
  failed: "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400",
  cancelled: "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400",
};

export function ReviewQueue() {
  const navigateTo = useAppStore((s) => s.navigateTo);
  const focusRun = useSelectionStore((s) => s.focusRun);
  const selectedRunId = useSelectionStore((s) => s.selectedRunId);
  const data = useAuditorWorkspace();
  const [filter, setFilter] = useState<QueueFilter>("review");

  const filtered = useMemo(() => {
    if (filter === "review") return data.reviewItems.filter((r) => r.reviewable);
    if (filter === "verdict") {
      return data.reviewItems.filter(
        (r) => (r.hasReport && !r.verdict) || (r.verdictLabel !== null && r.verdictLabel !== "approved"),
      );
    }
    return data.reviewItems;
  }, [data.reviewItems, filter]);

  if (data.loading && !data.connected) return <AuditorSkeleton rows={3} />;
  if (data.error) return <BackendError message={data.error} onRetry={data.refresh} />;

  const openIn = (item: ReviewItem, path: string) => {
    focusRun(item.run.id, item.systemId);
    navigateTo(path);
  };

  const filters: Array<{ key: QueueFilter; label: string; count: number }> = [
    { key: "review", label: "Awaiting review", count: data.reviewItems.filter((r) => r.reviewable).length },
    {
      key: "verdict",
      label: "Needs verdict",
      count: data.reviewItems.filter(
        (r) => (r.hasReport && !r.verdict) || (r.verdictLabel !== null && r.verdictLabel !== "approved"),
      ).length,
    },
    { key: "all", label: "All runs", count: data.reviewItems.length },
  ];

  return (
    <div className="space-y-5">
      <AuditorPageHeader
        eyebrow="My workspace"
        title="Review Queue"
        description="Governance runs awaiting your review. Open one to focus the workspace — Evidence, Findings, Verdict, and Reports all follow the run you select here."
        connected={data.connected}
        onRefresh={data.refresh}
        refreshing={data.loading}
      />

      <div className="flex flex-wrap items-center gap-2">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-[12px] font-medium transition-colors",
              filter === f.key
                ? "border-slate-900 bg-slate-900 text-white dark:border-brand-600 dark:bg-brand-700"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700",
            )}
          >
            {f.label}
            <span
              className={clsx(
                "rounded px-1.5 text-[10px] font-bold tabular-nums",
                filter === f.key ? "bg-white/20" : "bg-slate-100 dark:bg-slate-700",
              )}
            >
              {f.count}
            </span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Card className="p-4">
          <PanelEmpty
            label="Queue is clear"
            hint="No governance runs match this filter. New completed runs will appear here for review."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => {
            const isSelected = selectedRunId === item.run.id;
            return (
              <Card
                key={item.run.id}
                className={clsx(
                  "overflow-hidden transition-shadow hover:shadow-md",
                  isSelected && "ring-2 ring-brand-500 dark:ring-brand-500",
                )}
              >
                <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[15px] font-semibold text-slate-950 dark:text-white">{item.systemName}</h3>
                      <span
                        className={clsx(
                          "rounded px-2 py-0.5 text-[10px] font-semibold capitalize",
                          RUN_STATUS_TONE[item.status] ?? "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400",
                        )}
                      >
                        {item.status.replace(/_/g, " ")}
                      </span>
                      {item.verdictLabel ? (
                        <VerdictTag label={item.verdictLabel} />
                      ) : (
                        <span className="rounded bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                          No verdict
                        </span>
                      )}
                      {isSelected && (
                        <span className="inline-flex items-center gap-1 rounded bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700 dark:bg-brand-950/40 dark:text-brand-400">
                          <CheckCircle2 className="h-3 w-3" /> In focus
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {new Date(item.createdAt).toLocaleString()}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {item.openFindings} open finding{item.openFindings === 1 ? "" : "s"}
                        {item.criticalHigh > 0 ? ` (${item.criticalHigh} critical/high)` : ""}
                      </span>
                      <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500">
                        run {item.run.id.slice(0, 8)}
                      </span>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <QueueAction icon={FileSearch} label="Evidence" onClick={() => openIn(item, "/evidence-review")} />
                    <QueueAction icon={AlertTriangle} label="Findings" onClick={() => openIn(item, "/findings-review")} />
                    <QueueAction icon={GitBranch} label="Verdict" onClick={() => openIn(item, "/verdict-review")} />
                    <button
                      onClick={() => openIn(item, "/findings-review")}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-brand-700"
                    >
                      Review
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function QueueAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof FileSearch;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
