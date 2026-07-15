import { AlertOctagon, Gavel, Loader2, MessageSquareWarning, ShieldCheck } from "lucide-react";
import clsx from "clsx";
import { Card, CardHeader } from "@/components/ui/Card";
import { useGovernanceBackend } from "@/hooks/useGovernanceBackend";
import { AuditorPageHeader, BackendError, PanelEmpty, SeverityTag, VerdictTag, humanize } from "./components";

export function VerdictReview() {
  const backend = useGovernanceBackend();

  if (backend.loading && !backend.report) {
    return (
      <div className="space-y-5">
        <AuditorPageHeader eyebrow="Review" title="Verdict Review" />
        <Card className="flex items-center gap-2 px-5 py-12 text-[13px] text-slate-500 dark:text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading verdict…
        </Card>
      </div>
    );
  }

  if (backend.error && !backend.report) {
    return (
      <div className="space-y-5">
        <AuditorPageHeader eyebrow="Review" title="Verdict Review" />
        <BackendError message={backend.error} onRetry={backend.refresh} />
      </div>
    );
  }

  const system = backend.report?.ai_system;
  const verdict = backend.report?.verdict ?? null;
  const confidencePct = verdict ? Math.round(verdict.confidence_score * 100) : null;

  return (
    <div className="space-y-5">
      <AuditorPageHeader
        eyebrow="Review"
        title="Verdict Review"
        description={
          system
            ? `Council verdict for ${system.name}. Read-only — the record of the governance decision, its confidence, required actions, and challenges raised.`
            : "Council verdict for the selected run — confidence, required actions, and objections."
        }
        connected={!backend.error}
        onRefresh={backend.refresh}
        refreshing={backend.loading}
      />

      {!verdict ? (
        <Card className="p-4">
          <PanelEmpty
            label="No verdict for this run"
            hint="A verdict is produced after the council deliberates on a completed run. Select a run with a verdict from the Review Queue."
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
            {/* Confidence + tier */}
            <Card>
              <CardHeader title="Decision" eyebrow={humanize(verdict.action_tier)} action={<VerdictTag label={verdict.label} />} />
              <div className="p-5">
                <div className="flex items-end gap-2">
                  <span className="text-5xl font-bold tabular-nums text-slate-950 dark:text-white">{confidencePct}</span>
                  <span className="mb-1.5 text-lg font-semibold text-slate-400 dark:text-slate-500">%</span>
                </div>
                <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
                  Council confidence
                </p>
                <div className="mt-3 h-2 rounded-full bg-slate-100 dark:bg-slate-700">
                  <div
                    className={clsx(
                      "h-2 rounded-full",
                      (confidencePct ?? 0) >= 85 ? "bg-emerald-500" : (confidencePct ?? 0) >= 60 ? "bg-amber-500" : "bg-red-500",
                    )}
                    style={{ width: `${confidencePct ?? 0}%` }}
                  />
                </div>
                <dl className="mt-4 space-y-2 border-t border-slate-100 dark:border-slate-700/60 pt-4 text-[12px]">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500 dark:text-slate-400">Action tier</dt>
                    <dd className="font-medium text-slate-800 dark:text-slate-200">{humanize(verdict.action_tier)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500 dark:text-slate-400">Outcome</dt>
                    <dd className="font-medium capitalize text-slate-800 dark:text-slate-200">{verdict.label.replace(/_/g, " ")}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500 dark:text-slate-400">Recorded</dt>
                    <dd className="font-medium text-slate-800 dark:text-slate-200">{new Date(verdict.created_at).toLocaleString()}</dd>
                  </div>
                </dl>
              </div>
            </Card>

            {/* Synthesis + reasoning */}
            <Card>
              <CardHeader title="Synthesis" eyebrow="Council rationale" action={<Gavel className="h-4 w-4 text-slate-400" />} />
              <div className="space-y-3 p-5 text-[13px] leading-6 text-slate-700 dark:text-slate-300">
                {verdict.synthesis ? <p>{verdict.synthesis}</p> : <p className="text-slate-400">No synthesis recorded.</p>}
                {verdict.reasoning && (
                  <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-3">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Reasoning</p>
                    <p className="text-[12px] leading-5">{verdict.reasoning}</p>
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* Required actions */}
          <Card>
            <CardHeader title="Required Actions" eyebrow={`${verdict.required_actions.length} prescribed`} action={<ShieldCheck className="h-4 w-4 text-slate-400" />} />
            {verdict.required_actions.length > 0 ? (
              <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {verdict.required_actions.map((action, i) => (
                  <div key={i} className="flex items-start justify-between gap-3 px-5 py-3.5">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-slate-950 dark:text-white">{action.action}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        Owner: {action.owner}
                        {action.context ? ` · ${action.context}` : ""}
                      </p>
                    </div>
                    <SeverityTag severity={action.severity} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4">
                <PanelEmpty label="No required actions" hint="The council prescribed no remediation actions for this run." />
              </div>
            )}
          </Card>

          {/* Objections */}
          <Card>
            <CardHeader title="Objections Raised" eyebrow={`${verdict.objections.length} challenge${verdict.objections.length === 1 ? "" : "s"}`} action={<MessageSquareWarning className="h-4 w-4 text-slate-400" />} />
            {verdict.objections.length > 0 ? (
              <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {verdict.objections.map((obj, i) => (
                  <div key={`${obj.objection_id}-${i}`} className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <AlertOctagon className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                      <span className="rounded bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                        {humanize(obj.category)}
                      </span>
                      {obj.target_agent && (
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">vs {humanize(obj.target_agent)}</span>
                      )}
                    </div>
                    <p className="mt-1.5 text-[12px] leading-5 text-slate-700 dark:text-slate-300">{obj.argument}</p>
                    {obj.suggested_fix && (
                      <p className="mt-1 text-[12px] leading-5 text-slate-500 dark:text-slate-400">
                        <span className="font-semibold text-slate-600 dark:text-slate-300">Suggested fix: </span>
                        {obj.suggested_fix}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4">
                <PanelEmpty label="No objections" hint="The devil's-advocate step raised no challenges against this verdict." />
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
