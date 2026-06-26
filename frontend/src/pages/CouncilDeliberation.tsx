import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  MessageSquareText,
  Scale,
  Shield,
} from "lucide-react";
import clsx from "clsx";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useAppStore } from "@/store/useAppStore";
import { useGovernanceBackend } from "@/hooks/useGovernanceBackend";

const deliberationSteps = [
  {
    id: "synthesis",
    step: "Step 1",
    title: "Synthesis Memo",
    status: "Complete",
    tone: "green" as const,
    icon: CheckCircle2,
    description: "The Council synthesises all specialist agent findings into a coherent narrative. This step identifies compounding risks — where two moderate findings together create a high-severity posture.",
    content: (
      <div className="space-y-3">
        <p className="text-[13px] leading-6 text-slate-700 dark:text-slate-300">
          The registered target may present compounding risks across misuse resistance, retrieval grounding, documentation, and monitoring. The council synthesizes those signals only after findings and metric results are available.
        </p>
        <p className="text-[12px] leading-5 text-slate-600 dark:text-slate-400">
          The council weighs blast radius, evidence strength, sample adequacy, and framework coverage before assigning a confidence score and action tier.
        </p>
      </div>
    ),
  },
  {
    id: "themes",
    step: "Step 2",
    title: "Key Risk Themes",
    status: "Complete",
    tone: "green" as const,
    icon: CheckCircle2,
    description: "Four primary themes emerge from the synthesis. Each theme corresponds to one or more specialist agent findings and maps to specific framework clauses.",
    themes: [
      {
        label: "Bias and drift compound in boundary-case reasoning.",
        detail: "The Bias Auditor's age-disparity finding (34% language difference, BA-P24 to BA-P50) and the Drift Analyst's semantic divergence (0.61 vs 0.80 threshold) together suggest the model is drifting away from equitable behavior in edge cases.",
        framework: "EU AI Act Art.10(2)(f), NIST AI RMF Measure 2.5",
      },
      {
        label: "Annex IV documentation gaps block compliance demonstration.",
        detail: "Training data description (Annex IV 3.2) and performance metrics (Annex IV 4.1) are absent from the conformity file. This is a legal compliance gap independent of model behavior.",
        framework: "EU AI Act Annex IV 3.2 and 4.1",
      },
      {
        label: "Explainability fidelity is weak in high-consequence cases.",
        detail: "Early results from the Explainability Agent show the debt ratio feature is underexplained in the model's output rationale. Full probes are still running.",
        framework: "EU AI Act Art.13, ISO 42001",
      },
      {
        label: "Blast radius multiplier applies — 125,000 daily users.",
        detail: "Per internal governance policy, systems with >100,000 daily users receive a 1.3× severity multiplier on all weighted scores. This system crosses that threshold.",
        framework: "Internal Governance Policy §3.2",
      },
    ],
  },
  {
    id: "advocate",
    step: "Step 3",
    title: "Devil's Advocate",
    status: "Objection",
    tone: "amber" as const,
    icon: AlertTriangle,
    description: "An adversarial council member challenges the evidence strength of the primary findings. This step prevents over-confident verdicts from thin probe coverage.",
    objections: [
      {
        label: "Probe count below regulatory threshold",
        detail: "Age disparity is based on 24 probe pairs, below the n=50 threshold typically required for regulatory submission. Confidence deducted by 13 points. The finding is valid but cannot be submitted as conclusive evidence to a regulator without additional probing.",
        impact: "-13 confidence points",
      },
      {
        label: "Drift finding limited to boundary cases",
        detail: "The semantic drift score of 0.61 is observed across 17 replay prompts, concentrated in boundary cases. Core decision logic appears stable. This may not affect mainstream decisions.",
        impact: "-4 confidence points",
      },
    ],
  },
  {
    id: "verdict-input",
    step: "Step 4",
    title: "Verdict Agent Input",
    status: "In Progress",
    tone: "blue" as const,
    icon: MessageSquareText,
    description: "The Verdict Agent aggregates cross-agent agreement, evidence strength, sample adequacy, and citation specificity into a final confidence score and tier recommendation.",
    inputs: [
      { label: "Evidence strength", value: "High", description: "Multiple independent agents corroborate the bias and drift signals." },
      { label: "Cross-agent agreement", value: "Moderate", description: "Bias and Drift agents agree. Explainability is still running — final agreement is pending." },
      { label: "Sample adequacy", value: "Weak", description: "24 pairs for bias is below the 50-pair regulatory standard. This limits the verdict's certifiability." },
      { label: "Citation specificity", value: "High", description: "Findings are tied to specific framework clauses and probe identifiers." },
    ],
    finalScore: 75,
    tier: "Supervised",
  },
];

export function CouncilDeliberation() {
  const backend = useGovernanceBackend();
  const navigateTo = useAppStore((state) => state.navigateTo);
  const [expandedStep, setExpandedStep] = useState<string>("synthesis");
  const [expandedTheme, setExpandedTheme] = useState<string | null>(null);
  const [expandedObjection, setExpandedObjection] = useState<string | null>(null);
  const [deliberationError, setDeliberationError] = useState<string | null>(null);
  const [deliberating, setDeliberating] = useState(false);

  async function handleDeliberate() {
    setDeliberating(true);
    setDeliberationError(null);
    try {
      await backend.deliberate();
    } catch (error) {
      setDeliberationError(
        error instanceof Error
          ? error.message
          : "Council deliberation failed.",
      );
    } finally {
      setDeliberating(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Intro */}
      <div className="flex items-start justify-between border-b border-slate-200 dark:border-white/10 pb-5">
        <div className="max-w-2xl space-y-1">
          <p className="text-[13px] leading-5 text-slate-600 dark:text-slate-400">
            The Council is a multi-step deliberation process that synthesises specialist agent findings into a verdict. Click each step to expand its full content and reasoning.
          </p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500">Four steps: Synthesis → Key Themes → Devil's Advocate → Verdict Input</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => navigateTo("/verdicts")}
            className="flex items-center gap-2 rounded bg-[#111827] px-3 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-slate-700"
          >
            <Shield className="h-4 w-4" /> View Final Verdict
          </button>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Backend Council Status"
          eyebrow={
            backend.usingBackend && backend.latestRun
              ? `Latest run ${backend.latestRun.id.slice(0, 8)}`
              : "Prototype fallback"
          }
          action={<Badge tone={backend.report?.verdict ? "green" : "amber"}>{backend.report?.verdict ? "Verdict ready" : "No verdict"}</Badge>}
        />
        <div className="grid gap-4 p-4 lg:grid-cols-[1fr_220px]">
          <div>
            {backend.report?.verdict ? (
              <div className="space-y-2">
                <p className="text-[13px] font-semibold text-slate-950 dark:text-white">
                  {backend.report.verdict.label} · {Math.round(backend.report.verdict.confidence_score * 100)}% confidence · {backend.report.verdict.action_tier}
                </p>
                <p className="text-[12px] leading-5 text-slate-600 dark:text-slate-400">
                  {backend.report.verdict.synthesis ?? backend.report.verdict.reasoning ?? "Backend verdict is stored for this run."}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Required actions: {backend.report.verdict.required_actions.length}. Objections: {backend.report.verdict.objections.length}.
                </p>
              </div>
            ) : (
              <p className="text-[13px] leading-5 text-slate-600 dark:text-slate-400">
                {backend.loading
                  ? "Loading backend verdict..."
                  : "No backend verdict exists for the latest run yet. You can trigger the council route from here after metrics/findings are present."}
              </p>
            )}
            {deliberationError && (
              <p className="mt-2 text-[11px] text-red-700 dark:text-red-400">
                Council route returned: {deliberationError}
              </p>
            )}
          </div>
          <button
            onClick={handleDeliberate}
            disabled={!backend.latestRun || deliberating || Boolean(backend.report?.verdict)}
            className="flex items-center justify-center gap-2 rounded bg-[#111827] dark:bg-brand-700 px-3 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-slate-700 dark:hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-700"
          >
            <Scale className="h-4 w-4" />
            {deliberating ? "Running Council..." : "Run Council Route"}
          </button>
        </div>
      </Card>

      {/* Deliberation steps */}
      <div className="space-y-3">
        {deliberationSteps.map((step) => {
          const expanded = expandedStep === step.id;
          return (
            <Card key={step.id} className={clsx("overflow-hidden", expanded && "border-blue-300")}>
              <button
                onClick={() => setExpandedStep(expanded ? "" : step.id)}
                className="flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700">
                  <step.icon className={clsx("h-4 w-4",
                    step.tone === "green" ? "text-emerald-600" :
                    step.tone === "amber" ? "text-amber-600" : "text-blue-600"
                  )} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{step.step}</span>
                    <p className="text-[14px] font-semibold text-slate-950 dark:text-white">{step.title}</p>
                    <Badge tone={step.tone}>{step.status}</Badge>
                  </div>
                  <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">{step.description}</p>
                </div>
                {expanded
                  ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                  : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
              </button>

              {expanded && (
                <div className="border-t border-slate-200 dark:border-white/10 bg-slate-50/60 dark:bg-slate-800/40 p-4">
                  {/* Synthesis content */}
                  {step.id === "synthesis" && step.content}

                  {/* Key themes */}
                  {step.id === "themes" && step.themes && (
                    <div className="space-y-2">
                      {step.themes.map((theme) => {
                        const isExpanded = expandedTheme === theme.label;
                        return (
                          <div key={theme.label} className={clsx("rounded border bg-white dark:bg-slate-800 transition-colors",
                            isExpanded ? "border-blue-200 dark:border-blue-700" : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
                          )}>
                            <button
                              onClick={() => setExpandedTheme(isExpanded ? null : theme.label)}
                              className="flex w-full items-start gap-2 p-3 text-left"
                            >
                              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
                              <p className="flex-1 text-[12px] font-medium text-slate-800 dark:text-slate-200">{theme.label}</p>
                              {isExpanded
                                ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                            </button>
                            {isExpanded && (
                              <div className="border-t border-blue-100 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-950/30 px-3 py-3">
                                <p className="text-[12px] leading-5 text-slate-700 dark:text-slate-300">{theme.detail}</p>
                                <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                  Framework: <span className="font-mono normal-case text-slate-700 dark:text-slate-300">{theme.framework}</span>
                                </p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Devil's advocate */}
                  {step.id === "advocate" && step.objections && (
                    <div className="space-y-2">
                      {step.objections.map((obj) => {
                        const isExpanded = expandedObjection === obj.label;
                        return (
                          <div key={obj.label} className={clsx("rounded border bg-white dark:bg-slate-800 transition-colors",
                            isExpanded ? "border-amber-200 dark:border-amber-700" : "border-slate-200 dark:border-slate-700 hover:border-amber-200 dark:hover:border-amber-700"
                          )}>
                            <button
                              onClick={() => setExpandedObjection(isExpanded ? null : obj.label)}
                              className="flex w-full items-start gap-3 p-3 text-left"
                            >
                              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                              <div className="flex-1">
                                <p className="text-[12px] font-medium text-slate-800 dark:text-slate-200">{obj.label}</p>
                                <p className="mt-0.5 text-[11px] font-semibold text-red-600 dark:text-red-400">{obj.impact}</p>
                              </div>
                              {isExpanded
                                ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                            </button>
                            {isExpanded && (
                              <div className="border-t border-amber-100 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 px-3 py-3">
                                <p className="text-[12px] leading-5 text-slate-700 dark:text-slate-300">{obj.detail}</p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Verdict input */}
                  {step.id === "verdict-input" && step.inputs && (
                    <div className="grid gap-4 lg:grid-cols-[1fr_200px]">
                      <div className="space-y-2">
                        {step.inputs.map((input) => (
                          <div key={input.label} className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 transition-colors hover:border-blue-200 dark:hover:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/30">
                            <div className="flex items-center justify-between">
                              <span className="text-[12px] font-medium text-slate-700 dark:text-slate-300">{input.label}</span>
                              <span className={clsx("text-[12px] font-semibold",
                                input.value === "High" ? "text-emerald-700 dark:text-emerald-400" :
                                input.value === "Moderate" ? "text-amber-700 dark:text-amber-400" : "text-red-700 dark:text-red-400"
                              )}>{input.value}</span>
                            </div>
                            <p className="mt-1 text-[11px] leading-4 text-slate-500 dark:text-slate-400">{input.description}</p>
                          </div>
                        ))}
                      </div>
                      <div className="rounded border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 p-4 text-center">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-400">Projected Confidence</p>
                        <p className="mt-2 text-[40px] font-bold leading-none text-blue-950 dark:text-blue-100">{step.finalScore}%</p>
                        <p className="mt-2 text-[12px] font-semibold text-amber-700 dark:text-amber-400">{step.tier} Tier</p>
                        <button
                          onClick={() => navigateTo("/verdicts")}
                          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded border border-blue-300 dark:border-blue-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-[11px] font-medium text-blue-800 dark:text-blue-400 transition-colors hover:bg-blue-100 dark:hover:bg-blue-950/40"
                        >
                          <ExternalLink className="h-3 w-3" /> Full verdict
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Navigation footer */}
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          onClick={() => navigateTo("/agents")}
          className="flex items-center justify-center gap-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 text-[13px] font-medium text-slate-800 dark:text-slate-200 transition-colors hover:border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30 hover:text-blue-800 dark:hover:text-blue-400"
        >
          <Scale className="h-4 w-4" /> ← View Source Agent Findings
        </button>
        <button
          onClick={() => navigateTo("/verdicts")}
          className="flex items-center justify-center gap-2 rounded border border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/40 p-3 text-[13px] font-medium text-blue-800 dark:text-blue-400 transition-colors hover:bg-blue-100 dark:hover:bg-blue-900/50"
        >
          <Shield className="h-4 w-4" /> View Final Verdict & Actions →
        </button>
      </div>
    </div>
  );
}
