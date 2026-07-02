import { useState } from "react";
import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from "recharts";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Info,
  PauseCircle,
  ShieldCheck,
} from "lucide-react";
import clsx from "clsx";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { useAppStore } from "@/store/useAppStore";
import { useGovernanceBackend } from "@/hooks/useGovernanceBackend";

/** "human_review" → "Human Review", "conditional_approval" → "Conditional Approval". */
function titleCaseWords(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function Verdicts() {
  const navigateTo = useAppStore((state) => state.navigateTo);
  const backend = useGovernanceBackend();
  const [expandedAction, setExpandedAction] = useState<string | null>(null);
  const [hoveredRisk, setHoveredRisk] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<"approve" | "override" | null>(null);
  const targetSystemName = backend.report?.ai_system.name ?? "this system";
  const backendVerdict = backend.report?.verdict;

  // Risk dimensions derived from the run's real findings, grouped by dimension
  // and scored by worst severity. No findings → no risk bars (empty state).
  const riskDimensions = (() => {
    const weight: Record<string, number> = { critical: 100, high: 75, medium: 50, low: 25, info: 10 };
    const byDimension = new Map<string, { score: number; count: number }>();
    for (const f of backend.findings) {
      const w = weight[f.severity] ?? 25;
      const cur = byDimension.get(f.dimension) ?? { score: 0, count: 0 };
      byDimension.set(f.dimension, { score: Math.max(cur.score, w), count: cur.count + 1 });
    }
    return [...byDimension.entries()]
      .map(([name, v]) => ({ name: titleCaseWords(name), score: v.score, count: v.count }))
      .sort((a, b) => b.score - a.score);
  })();

  // No adjudicated verdict yet — show a clean empty state rather than fabricated
  // confidence, tier, and risk numbers.
  if (!backendVerdict) {
    return (
      <div className="flex min-h-[55vh] flex-col items-center justify-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
          <ShieldCheck className="h-7 w-7 text-slate-400 dark:text-slate-500" />
        </div>
        <div>
          <p className="text-[16px] font-semibold text-slate-900 dark:text-white">
            {backend.loading ? "Loading verdict…" : "No verdict yet"}
          </p>
          {!backend.loading && (
            <p className="mt-1 max-w-md text-[13px] leading-5 text-slate-500 dark:text-slate-400">
              The council produces a verdict — confidence score, action tier, and risk breakdown — at the end of a governance run. Run an evaluation to see the adjudicated outcome here.
            </p>
          )}
        </div>
        {!backend.loading && (
          <button
            onClick={() => navigateTo("/runs")}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-brand-700"
          >
            Open Live Run
          </button>
        )}
      </div>
    );
  }

  const confidenceScore = Math.round(backendVerdict.confidence_score * 100);
  const actionTier = backendVerdict.action_tier ? titleCaseWords(backendVerdict.action_tier) : "Supervised Tier";
  const verdictLabelRaw = backendVerdict.label ?? "conditional_approval";
  const verdictLabel = titleCaseWords(verdictLabelRaw);
  // Colour the verdict by outcome, not a fixed amber: blocked/failed → red,
  // conditional/review → amber, approved → green.
  const verdictTone: "red" | "amber" | "green" = /block|fail|not.?align|reject|deny/i.test(verdictLabelRaw)
    ? "red"
    : /condition|partial|review|supervis/i.test(verdictLabelRaw)
      ? "amber"
      : "green";
  // We have the adjudicated final confidence but not a per-finding deduction
  // breakdown, so show the honest total drop from a perfect 100 rather than
  // fabricated per-dimension numbers.
  const totalDeduction = Math.max(0, 100 - confidenceScore);
  const objectionCount = backendVerdict?.objections?.length ?? 0;

  // Prescribed actions come straight from the verdict's required_actions, which
  // the council derives from each open finding's recommended remediation.
  const prescribedActions = (backendVerdict.required_actions ?? []).map((raw, i) => {
    const rec = raw as Record<string, unknown>;
    const severity = typeof rec.severity === "string" ? rec.severity : "medium";
    return {
      id: typeof rec.finding_id === "string" ? rec.finding_id : `action-${i}`,
      title: typeof rec.action === "string" && rec.action.trim() ? rec.action : "Remediation action",
      detail: `Context: ${typeof rec.context === "string" ? titleCaseWords(rec.context) : "Open finding"}. Severity ${severity}.`,
      target: typeof rec.owner === "string" ? titleCaseWords(rec.owner) : "System owner",
      urgency: titleCaseWords(severity),
      urgencyTone: (/crit|high/i.test(severity) ? "red" : "amber") as "red" | "amber",
      findingId: typeof rec.finding_id === "string" ? rec.finding_id : null,
    };
  });

  return (
    <div className="space-y-5">
      {/* Intro */}
      <div className="flex items-start justify-between border-b border-slate-200 dark:border-slate-700 pb-5">
        <div className="max-w-2xl space-y-1">
          <p className="text-[13px] leading-5 text-slate-600 dark:text-slate-300">
            The final verdict for <span className="font-semibold text-slate-950 dark:text-white">{targetSystemName}</span>. This page shows the confidence score, risk dimension breakdown, and prescribed actions. Human approval is required before the supervised tier restrictions can be lifted.
          </p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500">Hover risk bars for finding detail · Click actions to expand · Approve or Override below</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => navigateTo("/council")}
            className="flex items-center gap-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-[12px] font-medium text-slate-900 dark:text-white transition-colors hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            ← Council deliberation
          </button>
        </div>
      </div>

      {/* Action required banner */}
      {!confirmed && (
        <div className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/50">
          <div className="flex items-start justify-between p-4">
            <div className="flex items-start gap-3">
              <PauseCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" />
              <div>
                <p className="text-[13px] font-semibold text-amber-950 dark:text-amber-200">Action pending — {actionTier} assignment</p>
                <p className="mt-1 text-[12px] text-amber-800 dark:text-amber-300">
                  This verdict routed <span className="font-semibold">{targetSystemName}</span> to the {actionTier} with a <span className="font-semibold">{verdictLabel}</span> outcome. The override window is open and remediation actions require human approval to proceed. Approving accepts the verdict and opens the remediation queue. Overriding records a manual review note and returns the system to its prior state pending review.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                onClick={() => setConfirmed("approve")}
                className="rounded border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-800 px-3 py-2 text-[12px] font-semibold text-emerald-800 dark:text-emerald-300 transition-colors hover:bg-emerald-50 dark:hover:bg-emerald-950/50"
              >
                Accept Verdict
              </button>
              <button
                onClick={() => setConfirmed("override")}
                className="rounded border border-red-300 dark:border-red-700 bg-white dark:bg-slate-800 px-3 py-2 text-[12px] font-semibold text-red-800 dark:text-red-300 transition-colors hover:bg-red-50 dark:hover:bg-red-950/50"
              >
                Override
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmed && (
        <div className={clsx("rounded-md border p-4 text-[13px] font-medium",
          confirmed === "approve"
            ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300"
            : "border-red-200 dark:border-red-700 bg-red-50 dark:bg-red-950/50 text-red-800 dark:text-red-300"
        )}>
          <ShieldCheck className="mr-2 inline h-4 w-4" />
          {confirmed === "approve"
            ? `Verdict accepted. Remediation queue is now open. System remains in the ${actionTier}.`
            : "Override recorded. A manual review note is required within 24 hours per model risk policy."}
          <button onClick={() => setConfirmed(null)} className="ml-3 underline text-[11px]">Undo</button>
        </div>
      )}

      {/* Confidence + risk dimensions */}
      <div className="grid gap-5 xl:grid-cols-[0.7fr_1.3fr]">
        <Card>
          <CardHeader
            title={`${confidenceScore}% Confidence`}
            eyebrow={actionTier}
            action={<Badge tone={verdictTone}>{verdictLabel}</Badge>}
          />
          <div className="p-4">
            <div className="relative h-50">
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart
                  innerRadius="72%"
                  outerRadius="100%"
                  data={[{ name: "confidence", value: confidenceScore }]}
                  startAngle={90}
                  endAngle={-270}
                >
                  <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                  <RadialBar dataKey="value" angleAxisId={0} cornerRadius={20} fill="#0d9488" background={{ fill: "#e9edf2" }} />
                </RadialBarChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-4xl font-bold tabular-nums text-slate-900 dark:text-white">
                  <AnimatedNumber value={confidenceScore} duration={1200} />%
                </span>
                <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Confidence</span>
              </div>
            </div>
            <div className="mt-3 space-y-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Score composition</p>
              <p className="text-[11px] text-slate-600 dark:text-slate-300">Started at <span className="font-semibold">100%</span></p>
              <p className="text-[11px] text-slate-600 dark:text-slate-300">
                Deductions from findings{objectionCount > 0 ? ` and ${objectionCount} council objection${objectionCount === 1 ? "" : "s"}` : ""}{" "}
                <span className="font-semibold text-red-700 dark:text-red-400">−{totalDeduction} pts</span>
              </p>
              <p className="text-[11px] font-semibold text-slate-950 dark:text-white">Final: {confidenceScore}% → {actionTier}</p>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Risk Dimensions"
            eyebrow="Derived from this run's findings. Click a dimension to review its findings"
            action={<Info className="h-4 w-4 text-slate-400 dark:text-slate-500" />}
          />
          {riskDimensions.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <ShieldCheck className="h-7 w-7 text-emerald-400 dark:text-emerald-500" />
              <p className="text-[13px] font-semibold text-slate-600 dark:text-slate-300">No findings raised this run</p>
              <p className="max-w-xs text-[11px] text-slate-500 dark:text-slate-400">
                No risk dimensions to score — the specialist agents did not raise any findings.
              </p>
            </div>
          ) : (
          <div className="space-y-3 p-4">
            {riskDimensions.map((risk) => (
              <button
                key={risk.name}
                type="button"
                onClick={() => navigateTo("/findings")}
                className={clsx(
                  "grid w-full grid-cols-[110px_1fr_44px] items-center gap-3 rounded p-1.5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800",
                  "cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
                )}
                onMouseEnter={() => setHoveredRisk(risk.name)}
                onMouseLeave={() => setHoveredRisk(null)}
              >
                <p className="text-[12px] font-medium text-slate-700 dark:text-slate-300">{risk.name}</p>
                <div className="relative">
                  <div className="h-2.5 rounded bg-slate-200 dark:bg-slate-700">
                    <div
                      className={clsx("h-full rounded transition-all",
                        risk.score >= 70 ? "bg-red-500" : risk.score >= 40 ? "bg-amber-400" : "bg-emerald-500"
                      )}
                      style={{ width: `${risk.score}%` }}
                    />
                  </div>
                  {hoveredRisk === risk.name && (
                    <div className="absolute bottom-full left-0 z-10 mb-2 w-72 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2.5 text-[11px] leading-4 text-slate-700 dark:text-slate-300 shadow-lg">
                      {risk.count} finding{risk.count === 1 ? "" : "s"} in this dimension. Worst-severity contribution shown. Click to review findings.
                    </div>
                  )}
                </div>
                <p className="text-right text-[12px] font-semibold text-slate-950 dark:text-white">{risk.score}</p>
              </button>
            ))}
            <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">Scores out of 100 by worst finding severity. Red = high risk contribution. Click a dimension to review its findings.</p>
          </div>
          )}
        </Card>
      </div>

      {/* Prescribed actions */}
      <Card>
        <CardHeader
          title="Prescribed Remediation Actions"
          eyebrow="Click each action to expand · Navigate to the relevant page to act"
        />
        {prescribedActions.length === 0 && (
          <div className="px-4 py-10 text-center text-[12px] text-slate-500 dark:text-slate-400">
            No remediation actions required — the verdict raised no open findings needing follow-up.
          </div>
        )}
        <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
          {prescribedActions.map((action) => {
            const isExpanded = expandedAction === action.id;
            return (
              <div key={action.id}>
                <button
                  onClick={() => setExpandedAction(isExpanded ? null : action.id)}
                  className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <AlertTriangle className={clsx("mt-0.5 h-4 w-4 shrink-0", action.urgencyTone === "red" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400")} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-semibold text-slate-950 dark:text-white">{action.title}</p>
                      <span className={clsx("rounded px-1.5 py-0.5 text-[10px] font-semibold",
                        action.urgencyTone === "red"
                          ? "bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-400"
                          : "bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400"
                      )}>{action.urgency}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{action.target}</p>
                  </div>
                  {isExpanded
                    ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
                    : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />}
                </button>

                {isExpanded && (
                  <div className="border-t border-slate-100 dark:border-slate-700/50 bg-slate-50 dark:bg-slate-800 px-4 py-3">
                    <p className="text-[12px] leading-5 text-slate-700 dark:text-slate-300">{action.detail}</p>
                    <button
                      onClick={() => navigateTo("/findings")}
                      className="mt-3 flex items-center gap-1.5 rounded border border-blue-300 dark:border-blue-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-blue-800 dark:text-blue-300 transition-colors hover:bg-blue-50 dark:hover:bg-blue-950/50"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Review findings
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

