import {
  AlertTriangle,
  ArrowRight,
  ClipboardList,
  FileCheck2,
  GitBranch,
  Inbox,
  ListChecks,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import clsx from "clsx";
import { Card, CardHeader } from "@/components/ui/Card";
import { useAppStore } from "@/store/useAppStore";
import { useSelectionStore } from "@/store/useSelectionStore";
import { useAuditorWorkspace } from "@/hooks/useAuditorWorkspace";
import {
  AuditorPageHeader,
  AuditorSkeleton,
  BackendError,
  PanelEmpty,
  SeverityTag,
  VerdictTag,
} from "./components";

export function AuditorOverview() {
  const navigateTo = useAppStore((s) => s.navigateTo);
  const focusRun = useSelectionStore((s) => s.focusRun);
  const data = useAuditorWorkspace();

  if (data.loading && !data.connected) return <AuditorSkeleton rows={6} />;
  if (data.error) return <BackendError message={data.error} onRetry={data.refresh} />;

  const p = data.priorities;

  const openReview = (runId: string, systemId: string, path: string) => {
    focusRun(runId, systemId);
    navigateTo(path);
  };

  const pendingReviewItems = data.reviewItems.filter((r) => r.reviewable).slice(0, 6);

  return (
    <div className="space-y-5">
      <AuditorPageHeader
        eyebrow="Auditor workspace"
        title="Overview"
        description="Your assurance priorities across every AI system in scope — what needs review, what's critical, and what's awaiting a decision."
        connected={data.connected}
        onRefresh={data.refresh}
        refreshing={data.loading}
      />

      {/* Priority KPI grid — the six things an auditor triages first. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <PriorityCard
          icon={Inbox}
          label="My Assignments"
          value={p.assignedSystems}
          emptyValue="—"
          detail={p.assignedSystems === null ? "Assignment routing not provisioned" : "Systems assigned to you"}
          tone="slate"
          onClick={() => navigateTo("/my-assignments")}
        />
        <PriorityCard
          icon={ListChecks}
          label="Pending Reviews"
          value={p.pendingReviews}
          detail="Completed runs ready for review"
          tone={p.pendingReviews > 0 ? "amber" : "green"}
          onClick={() => navigateTo("/review-queue")}
        />
        <PriorityCard
          icon={ShieldAlert}
          label="Critical Findings"
          value={p.criticalFindings}
          detail="Open critical / high severity"
          tone={p.criticalFindings > 0 ? "red" : "green"}
          onClick={() => navigateTo("/findings-review")}
        />
        <PriorityCard
          icon={GitBranch}
          label="Pending Verdicts"
          value={p.pendingVerdicts}
          detail="Missing, conditional, or blocked"
          tone={p.pendingVerdicts > 0 ? "amber" : "green"}
          onClick={() => navigateTo("/verdict-review")}
        />
        <PriorityCard
          icon={FileCheck2}
          label="Reports Awaiting Sign-off"
          value={p.reportsAwaitingSignoff}
          detail="Governance reports ready to sign"
          tone={p.reportsAwaitingSignoff > 0 ? "amber" : "green"}
          onClick={() => navigateTo("/compliance-reports")}
        />
        <PriorityCard
          icon={Wrench}
          label="Overdue Remediation"
          value={p.openRemediation}
          detail="Open remediation items"
          tone={p.openRemediation > 0 ? "red" : "green"}
          onClick={() => navigateTo("/remediation")}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        {/* Review queue preview */}
        <Card>
          <CardHeader
            title="Runs Awaiting Review"
            eyebrow="Review queue"
            action={
              <button
                onClick={() => navigateTo("/review-queue")}
                className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:underline dark:text-brand-400"
              >
                View all <ArrowRight className="h-3.5 w-3.5" />
              </button>
            }
          />
          {pendingReviewItems.length > 0 ? (
            <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {pendingReviewItems.map((item) => (
                <button
                  key={item.run.id}
                  onClick={() => openReview(item.run.id, item.systemId, "/findings-review")}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-slate-950 dark:text-white">{item.systemName}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                      {item.openFindings} open finding{item.openFindings === 1 ? "" : "s"}
                      {item.criticalHigh > 0 ? ` · ${item.criticalHigh} critical/high` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {item.verdictLabel ? <VerdictTag label={item.verdictLabel} /> : (
                      <span className="rounded bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400">No verdict</span>
                    )}
                    <ArrowRight className="h-4 w-4 text-slate-300 dark:text-slate-600" />
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="p-4">
              <PanelEmpty label="Nothing awaiting review" hint="Completed governance runs will appear here for review." />
            </div>
          )}
        </Card>

        {/* Critical findings */}
        <Card>
          <CardHeader title="Critical & High Findings" eyebrow={`${data.criticalFindings.length} open`} />
          {data.criticalFindings.length > 0 ? (
            <div className="max-h-[420px] divide-y divide-slate-100 dark:divide-slate-700/60 overflow-y-auto">
              {data.criticalFindings.slice(0, 10).map((f) => (
                <button
                  key={f.id}
                  onClick={() => openReview(f.runId, "", "/findings-review")}
                  className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  <div className="min-w-0">
                    <p className="line-clamp-1 text-[12px] font-semibold text-slate-950 dark:text-white">{f.title}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{f.systemName}</p>
                  </div>
                  <SeverityTag severity={f.severity} />
                </button>
              ))}
            </div>
          ) : (
            <div className="p-4">
              <PanelEmpty label="No critical findings" hint="No open critical or high-severity findings in scope." />
            </div>
          )}
        </Card>
      </div>

      {/* Remediation preview */}
      <Card>
        <CardHeader
          title="Remediation Backlog"
          eyebrow="Prescribed actions"
          action={
            <button
              onClick={() => navigateTo("/remediation")}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:underline dark:text-brand-400"
            >
              Open remediation <ArrowRight className="h-3.5 w-3.5" />
            </button>
          }
        />
        {data.remediationItems.length > 0 ? (
          <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {data.remediationItems.slice(0, 5).map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <ClipboardList className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <p className="line-clamp-1 text-[12px] font-semibold text-slate-950 dark:text-white">{item.title}</p>
                  </div>
                  <p className="mt-0.5 pl-5 text-[11px] text-slate-500 dark:text-slate-400">
                    {item.systemName}
                    {item.owner ? ` · ${item.owner}` : ""}
                    {` · ${item.source === "verdict" ? "Verdict action" : "Finding remediation"}`}
                  </p>
                </div>
                <SeverityTag severity={item.severity} />
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4">
            <PanelEmpty label="No open remediation" hint="Verdict-prescribed actions and finding remediations appear here." />
          </div>
        )}
      </Card>
    </div>
  );
}

function PriorityCard({
  icon: Icon,
  label,
  value,
  emptyValue = "0",
  detail,
  tone,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: number | null;
  emptyValue?: string;
  detail: string;
  tone: "slate" | "green" | "amber" | "red";
  onClick: () => void;
}) {
  const iconTone = {
    slate: "text-slate-400",
    green: "text-emerald-500",
    amber: "text-amber-500",
    red: "text-red-500",
  }[tone];
  return (
    <button
      onClick={onClick}
      className="group rounded-xl bg-white dark:bg-slate-900 px-4 py-3.5 text-left shadow-card ring-1 ring-black/[0.03] dark:ring-white/6 transition-shadow hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">{label}</p>
        <Icon className={clsx("h-4 w-4 shrink-0", iconTone)} />
      </div>
      <p className="mt-1.5 text-3xl font-bold tracking-tight text-slate-900 dark:text-white tabular-nums">
        {value === null ? emptyValue : value}
      </p>
      <p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500">
        {detail}
        <ArrowRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
      </p>
    </button>
  );
}
