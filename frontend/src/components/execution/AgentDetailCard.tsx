import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BarChart3, ChevronDown, ChevronRight, ClipboardCheck, Clock, ExternalLink, FileText, FlaskConical, Layers, Loader2, MessageSquare, SearchCheck, Server, Terminal, Wrench } from "lucide-react";
import clsx from "clsx";
import { useAppStore } from "@/store/useAppStore";
import {
  getLlmCalls,
  type AgentExecution,
  type AgentPlanItem,
  type BackendFinding,
  type ContextAssemblyRead,
  type FindingToolCall,
  type LlmCall,
} from "@/api/governanceApi";
import { metricBlurb, metricName } from "@/data/metricCatalog";
import {
  experimentFor,
  parseRankingScores,
  probeMetaFor,
  type CandidateScore,
  type ProbeExperiment,
} from "@/data/probeMeta";

export type AgentTab = "Overview" | "Probes" | "Evidence" | "Frameworks" | "Remediation" | "Runtime";

export type IntelligenceAgent = {
  id: string;
  name: string;
  status: "Running" | "Complete" | "Waiting";
  severity: "Critical" | "High" | "Medium" | "Low";
  confidence: number;
  confidenceImpact: number;
  probes: string;
  findings: number;
  purpose: string;
  checks: string[];
  methods: string[];
  evidence: string[];
  frameworks: string[];
  remediation: string[];
  timeline: Array<{ label: string; status: "complete" | "running" | "waiting"; detail: string }>;
  toolCalls: FindingToolCall[];
};

export const AGENT_TABS: AgentTab[] = ["Overview", "Probes", "Evidence", "Frameworks", "Remediation", "Runtime"];

// Image/video-generation targets return the generated media as a base64 data
// URL in the same text field a chat target would use for its reply — there's
// no separate media channel on LlmCall. Detect that shape here so it renders
// as actual media instead of dumping the raw base64 into a <pre> block.
const DATA_URL_MEDIA_RE = /^data:(image|video|audio)\/[a-zA-Z0-9.+-]+;base64,/;

function mediaFromResponseText(
  text: string | null | undefined,
): { kind: "image" | "video" | "audio"; url: string } | null {
  if (!text) return null;
  const trimmed = text.trim();
  const match = trimmed.match(DATA_URL_MEDIA_RE);
  if (!match) return null;
  return { kind: match[1] as "image" | "video" | "audio", url: trimmed };
}

/**
 * Turn a raw probe identifier into a readable title, keeping the pass number as
 * a suffix. e.g. "demographic_parity_matched_pair_pass2" → "Demographic Parity
 * Matched Pair (pass 2)"; "proxy_discrimination" → "Proxy Discrimination".
 */
function humanizeProbeTitle(raw: string | null | undefined): string {
  if (!raw) return "Probe";
  // Pull a trailing pass number (pass2 / _pass_3) out to a parenthetical suffix.
  const passMatch = raw.match(/_?pass[_-]?(\d+)$/i);
  const pass = passMatch ? ` (pass ${passMatch[1]})` : "";
  const core = passMatch ? raw.slice(0, passMatch.index) : raw;
  const words = core
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return `${words || "Probe"}${pass}`;
}

// Curated, agent-type reference metadata (purpose / checks / methods / frameworks /
// default remediation). The live run supplies the rest — status, findings, evidence.
type AgentMeta = Pick<IntelligenceAgent, "name" | "purpose" | "checks" | "methods" | "frameworks" | "remediation">;

const AGENT_ALIASES: Record<string, string> = {
  bias_agent: "bias", bias_auditor: "bias",
  misuse_agent: "misuse", misuse_detector: "misuse",
  drift_agent: "drift", drift_analyst: "drift",
  compliance_mapper: "compliance", compliance_agent: "compliance",
  explainability_agent: "explainability",
  risk_scorer: "risk", risk_agent: "risk",
  quality_agent: "quality", quality_evaluator: "quality",
};

const AGENT_META: Record<string, AgentMeta> = {
  bias: {
    name: "Bias Auditor",
    purpose: "Detects demographic and protected-attribute disparities.",
    checks: ["age disparity", "gender disparity", "ethnicity disparity", "proxy discrimination", "disparate impact"],
    methods: ["controlled paired testing", "cohort comparison", "proxy variable testing", "statistical disparity measurement"],
    frameworks: ["EU AI Act Art.10", "SR 11-7 §4.1", "NIST AI RMF", "ISO 42001"],
    remediation: ["expand representative testing data", "review training data distribution", "require human approval before promotion"],
  },
  misuse: {
    name: "Misuse Detector",
    purpose: "Tests jailbreak, prompt injection, role confusion, and policy-boundary abuse.",
    checks: ["prompt injection", "role confusion", "tool misuse", "data leakage", "scope violation"],
    methods: ["adversarial prompt set", "multi-turn jailbreak attempts", "boundary-condition probing"],
    frameworks: ["OWASP LLM Top 10", "MITRE ATLAS", "NIST AI RMF"],
    remediation: ["continue scheduled red-team probes", "retain prompt firewall", "review after model update"],
  },
  drift: {
    name: "Drift Analyst",
    purpose: "Detects behavioral and semantic divergence from validated model baselines.",
    checks: ["semantic drift", "tone shift", "baseline divergence", "decision-boundary changes"],
    methods: ["benchmark replay", "embedding similarity", "golden response comparison", "threshold scoring"],
    frameworks: ["NIST AI RMF Measure 2.5", "ISO 42001 §9.1", "EU AI Act Art.15"],
    remediation: ["review prompt template changes", "revalidate baseline", "increase replay coverage"],
  },
  compliance: {
    name: "Compliance Mapper",
    purpose: "Maps system evidence and behavior to selected governance frameworks.",
    checks: ["technical documentation", "transparency notices", "deployer obligations", "risk classification"],
    methods: ["clause mapping", "document completeness review", "sampled behavioral compliance checks"],
    frameworks: ["EU AI Act Annex IV", "EU AI Act Art.52", "SR 11-7"],
    remediation: ["complete technical file", "add disclosure coverage", "require compliance sign-off"],
  },
  explainability: {
    name: "Explainability Agent",
    purpose: "Evaluates whether model explanations match observed decision behavior.",
    checks: ["feature attribution", "reasoning consistency", "citation fidelity", "explanation faithfulness"],
    methods: ["counterfactual explanations", "factor perturbation", "decision rationale comparison"],
    frameworks: ["NIST AI RMF", "ISO 42001", "EU AI Act Art.13"],
    remediation: ["expand explanation probes", "compare to SHAP baseline", "review rationale template"],
  },
  risk: {
    name: "Risk Scorer",
    purpose: "Aggregates specialist findings into a composite risk and oversight assessment.",
    checks: ["human oversight adequacy", "calibration", "uncertainty communication", "review-queue routing"],
    methods: ["severity weighting", "blast-radius multiplier", "framework threshold comparison"],
    frameworks: ["NIST AI RMF", "ISO 42001", "EU AI Act Art.14"],
    remediation: ["tighten human-in-the-loop thresholds", "review oversight coverage", "escalate low-confidence cases"],
  },
  quality: {
    name: "Quality Evaluator",
    purpose: "Scores task success, instruction following, and output-format adherence.",
    checks: ["task success rate", "instruction following", "schema adherence", "answer completeness"],
    methods: ["promptfoo / deepeval scoring", "schema validation", "rubric evaluation"],
    frameworks: ["ISO 42001", "EU AI Act", "NIST AI RMF", "OECD"],
    remediation: ["expand evaluation set", "tune prompt templates", "add output schema guards"],
  },
};

const SEV_RANK: Record<string, IntelligenceAgent["severity"]> = {
  critical: "Critical", high: "High", medium: "Medium", low: "Low", info: "Low",
};
const SEV_ORDER: IntelligenceAgent["severity"][] = ["Low", "Medium", "High", "Critical"];

function canonicalAgent(name: string): string {
  return AGENT_ALIASES[name] ?? name;
}

function fallbackMeta(name: string): AgentMeta {
  const label = name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    name: label,
    purpose: "Specialist governance agent.",
    checks: [],
    methods: [],
    frameworks: [],
    remediation: [],
  };
}

function highestSeverity(findings: BackendFinding[]): IntelligenceAgent["severity"] {
  let best: IntelligenceAgent["severity"] = "Low";
  for (const f of findings) {
    const sev = SEV_RANK[f.severity] ?? "Low";
    if (SEV_ORDER.indexOf(sev) > SEV_ORDER.indexOf(best)) best = sev;
  }
  return best;
}

function describeContextLoad(assembly: ContextAssemblyRead | null): string {
  if (!assembly) return "Context assembly not yet recorded for this run.";
  const { log_analysis, regulatory_context, gap_count } = assembly;
  const parts = [
    log_analysis.empty
      ? "No production logs supplied — analysis proceeds without real-traffic context."
      : `Analyzed ${log_analysis.total_requests} logged request${log_analysis.total_requests === 1 ? "" : "s"} across ${log_analysis.distinct_request_categories} categor${log_analysis.distinct_request_categories === 1 ? "y" : "ies"}.`,
    `Resolved ${regulatory_context.resolved_frameworks.length}/${regulatory_context.selected_frameworks.length} selected framework${regulatory_context.selected_frameworks.length === 1 ? "" : "s"} (${regulatory_context.control_count} controls).`,
    gap_count > 0 ? `${gap_count} coverage gap${gap_count === 1 ? "" : "s"} identified before probing began.` : "No coverage gaps identified before probing began.",
  ];
  return parts.join(" ");
}

function describeProbeDesign(plan: AgentPlanItem | null): string {
  if (!plan) return "No evaluation plan entry recorded for this agent on this run.";
  if (!plan.activated) return `Not activated for this run. ${plan.rationale}`.trim();
  const metrics = plan.assigned_metric_ids.length
    ? `Assigned metric${plan.assigned_metric_ids.length === 1 ? "" : "s"}: ${plan.assigned_metric_ids
        .map((id) => (metricName(id) !== id ? `${id} (${metricName(id)})` : id))
        .join(", ")}.`
    : "No metrics assigned.";
  return `Priority ${plan.priority} · probe budget ${plan.probe_budget}. ${metrics} ${plan.rationale}`.trim();
}

function describeProbeExecution(calls: LlmCall[]): string {
  const targetCalls = calls.filter((c) => c.call_type === "target");
  if (targetCalls.length === 0) return "No probes were sent to the target model — the agent exited early with no relevant metrics to test.";
  const tasks = Array.from(new Set(targetCalls.map((c) => c.task))).filter(Boolean);
  const errors = targetCalls.filter((c) => c.status !== "success").length;
  const avgLatency = Math.round(targetCalls.reduce((s, c) => s + (c.latency_ms ?? 0), 0) / targetCalls.length);
  const taskList = tasks.length ? ` Probe tasks: ${tasks.join(", ")}.` : "";
  return `Sent ${targetCalls.length} probe${targetCalls.length === 1 ? "" : "s"} to the target model (avg latency ${avgLatency}ms, ${errors} error${errors === 1 ? "" : "s"}).${taskList}`;
}

function describeAnalysis(calls: LlmCall[]): string {
  const govCalls = calls.filter((c) => c.call_type === "governance");
  if (govCalls.length === 0) return "No governance-model analysis call recorded for this agent on this run.";
  const errors = govCalls.filter((c) => c.status !== "success").length;
  const tasks = Array.from(new Set(govCalls.map((c) => c.task))).filter(Boolean);
  const taskList = tasks.length ? ` Analysis task${tasks.length === 1 ? "" : "s"}: ${tasks.join(", ")}.` : "";
  return `Governance model reasoned over the probe evidence in ${govCalls.length} call${govCalls.length === 1 ? "" : "s"} (${errors} error${errors === 1 ? "" : "s"}).${taskList}`;
}

function describeEvidenceEmission(agentFindings: BackendFinding[], status: string): string {
  if (status !== "completed" && status !== "failed") return "Evidence not yet emitted for this agent on this run.";
  if (agentFindings.length === 0) return "Completed with no findings — a clean result was recorded to the evidence package.";
  const bySeverity = new Map<string, number>();
  for (const f of agentFindings) bySeverity.set(f.severity, (bySeverity.get(f.severity) ?? 0) + 1);
  const breakdown = Array.from(bySeverity.entries()).map(([sev, n]) => `${n} ${sev}`).join(", ");
  return `Persisted ${agentFindings.length} finding${agentFindings.length === 1 ? "" : "s"} (${breakdown}) to the evidence package, carried into Council Deliberation.`;
}

function buildTimeline(
  status: string,
  plan: AgentPlanItem | null,
  contextAssembly: ContextAssemblyRead | null,
  agentCalls: LlmCall[],
  agentFindings: BackendFinding[],
): IntelligenceAgent["timeline"] {
  const steps: Array<{ label: string; detail: string }> = [
    { label: "Context Load", detail: describeContextLoad(contextAssembly) },
    { label: "Probe Design", detail: describeProbeDesign(plan) },
    { label: "Probe Execution", detail: describeProbeExecution(agentCalls) },
    { label: "Analysis", detail: describeAnalysis(agentCalls) },
    { label: "Evidence Emission", detail: describeEvidenceEmission(agentFindings, status) },
  ];
  const completed = status === "completed" || status === "failed" ? 5 : status === "running" ? 2 : 0;
  return steps.map((step, i) => ({
    ...step,
    status: i < completed ? "complete" : status === "running" && i === completed ? "running" : "waiting",
  }));
}

function mapStatus(status: string): IntelligenceAgent["status"] {
  if (status === "completed") return "Complete";
  if (status === "running") return "Running";
  return "Waiting";
}

/** Findings carry the same tool_calls payload repeated across every finding from one
 * evaluate() call — dedupe by tool+metric so each real tool invocation shows once. */
function dedupeToolCalls(agentFindings: BackendFinding[]): FindingToolCall[] {
  const byKey = new Map<string, FindingToolCall>();
  for (const f of agentFindings) {
    const calls = f.payload?.tool_calls ?? [];
    for (const call of calls) {
      byKey.set(`${call.tool_name}:${call.metric_id}`, call);
    }
  }
  return Array.from(byKey.values());
}

/** A run can contain multiple execution rows for the same agent (re-probes) — keep only the latest. */
function latestExecutionPerAgent(executions: AgentExecution[]): AgentExecution[] {
  const latestByCanon = new Map<string, AgentExecution>();
  for (const execution of executions) {
    const canon = canonicalAgent(execution.agent_name);
    const existing = latestByCanon.get(canon);
    if (!existing || (execution.started_at ?? "") > (existing.started_at ?? "")) {
      latestByCanon.set(canon, execution);
    }
  }
  return Array.from(latestByCanon.values());
}

export function buildAgentsFromBackend(
  allExecutions: AgentExecution[],
  findings: BackendFinding[],
  plans: AgentPlanItem[] = [],
  contextAssembly: ContextAssemblyRead | null = null,
  llmCalls: LlmCall[] = [],
): IntelligenceAgent[] {
  const executions = latestExecutionPerAgent(allExecutions);
  return executions.map((execution) => {
    const canon = canonicalAgent(execution.agent_name);
    const meta = AGENT_META[canon] ?? fallbackMeta(execution.agent_name);
    const agentFindings = findings.filter((f) => canonicalAgent(f.agent_name ?? "") === canon);
    const realActions = agentFindings.map((f) => f.recommended_action).filter((a): a is string => Boolean(a));
    const toolCalls = dedupeToolCalls(agentFindings);
    const completed = execution.status === "completed";
    const plan = plans.find((p) => canonicalAgent(p.agent_name) === canon) ?? null;
    const namedCalls = llmCalls.filter((c) => c.agent_name && canonicalAgent(c.agent_name) === canon);
    // Scope strictly to this agent. Only fall back to the full set for legacy
    // runs where NO call was attributed (older data lacking agent_name).
    const anyAttributed = llmCalls.some((c) => c.agent_name);
    const agentCalls = anyAttributed ? namedCalls : llmCalls;
    // Real probe count = this agent's target calls (0 when it sent none).
    const probeCount = agentCalls.filter((c) => c.call_type === "target").length;
    return {
      id: execution.agent_name,
      name: meta.name,
      status: mapStatus(execution.status),
      severity: highestSeverity(agentFindings),
      confidence: completed ? (execution.finding_count === 0 ? 96 : 74) : execution.status === "running" ? 40 : 0,
      confidenceImpact: agentFindings.length ? -Math.min(agentFindings.length * 5, 20) : 0,
      probes: `${probeCount} probe${probeCount === 1 ? "" : "s"}`,
      findings: execution.finding_count,
      purpose: meta.purpose,
      checks: meta.checks,
      methods: meta.methods,
      evidence: agentFindings.length
        ? agentFindings.map((f) => `${f.title} — ${f.severity} (${Math.round(f.confidence * 100)}% conf)`)
        : ["No findings recorded — clean result for this agent."],
      frameworks: meta.frameworks,
      remediation: realActions.length ? realActions : meta.remediation,
      timeline: buildTimeline(execution.status, plan, contextAssembly, agentCalls, agentFindings),
      toolCalls,
    };
  });
}

/** Full agent detail card — phase stepper + tabs (Overview/Probes/Evidence/Frameworks/Remediation/Runtime). */
export function AgentDetailCard({
  agent,
  runId,
  activeTab,
  onTabChange,
}: {
  agent: IntelligenceAgent;
  runId: string | null;
  activeTab: AgentTab;
  onTabChange: (tab: AgentTab) => void;
}) {
  return (
    <div className="border-t border-slate-200 dark:border-white/10 bg-slate-50/60 dark:bg-slate-800/40">
      <PhaseStepperBar phases={agent.timeline} />
      <div className="flex gap-1 border-b border-slate-200 dark:border-white/10 px-4 pt-3">
        {AGENT_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            className={clsx(
              "rounded-t border border-b-0 px-3 py-2 text-[12px] font-medium",
              activeTab === tab
                ? "border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-950 dark:text-white"
                : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            )}
          >
            {tab}
          </button>
        ))}
      </div>
      <div className="bg-white dark:bg-slate-900 p-4">
        <ExpandedTab agent={agent} tab={activeTab} runId={runId} />
      </div>
    </div>
  );
}

function ExpandedTab({
  agent,
  tab,
  runId,
}: {
  agent: IntelligenceAgent;
  tab: AgentTab;
  runId: string | null;
}) {
  if (tab === "Runtime") {
    return <RuntimeTab agent={agent} runId={runId} />;
  }

  if (tab === "Overview") {
    return (
      <div className="space-y-5">
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <SectionTitle icon={ClipboardCheck} title="What It Checks" />
            <ChipGrid items={agent.checks} tone="slate" />
          </div>
          <div>
            <SectionTitle icon={BarChart3} title="Confidence Impact" />
            <ImpactBar value={agent.confidenceImpact} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniMetric label="Severity" value={agent.severity} />
          <MiniMetric label="Findings" value={agent.findings} />
          <MiniMetric label="Probe Set" value={agent.probes} />
          <MiniMetric label="Confidence" value={agent.confidence ? `${agent.confidence}%` : "Pending"} />
        </div>
        {agent.toolCalls.length > 0 && (
          <div>
            <SectionTitle icon={Wrench} title="Tools Used" />
            <ToolCallList toolCalls={agent.toolCalls} />
          </div>
        )}
        <div className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-4">
          <Timeline items={agent.timeline} />
        </div>
        <ActionRow />
      </div>
    );
  }

  if (tab === "Probes") {
    return <ProbesTab agent={agent} runId={runId} />;
  }

  if (tab === "Evidence") {
    return (
      <div className="space-y-4">
        <SectionTitle icon={FileText} title="Evidence Package" />
        <ChipGrid items={agent.evidence} tone="amber" />
        <div className="grid gap-3 md:grid-cols-3">
          <MiniMetric label="Findings" value={agent.findings} />
          <MiniMetric label="Tool Calls" value={agent.toolCalls.length || "—"} />
          <MiniMetric label="Confidence Impact" value={`${agent.confidenceImpact}%`} />
        </div>
        <ActionRow />
      </div>
    );
  }

  if (tab === "Frameworks") {
    return (
      <div className="space-y-4">
        <SectionTitle icon={FileText} title="Mapped Frameworks" />
        <div className="flex flex-wrap gap-2">
          {agent.frameworks.map((framework) => (
            <span key={framework} className="rounded border border-slate-200 dark:border-slate-600 bg-transparent px-3 py-1.5 text-[12px] font-medium text-slate-600 dark:text-slate-300">
              {framework}
            </span>
          ))}
        </div>
        <div className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-4 text-[12px] leading-5 text-slate-600 dark:text-slate-400">
          Clause mappings are written to the run evidence package and carried into the Council Deliberation and Compliance Report views.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SectionTitle icon={AlertTriangle} title="Recommended Remediation" />
      <div className="grid gap-2">
        {agent.remediation.map((item, index) => (
          <div key={item} className="flex items-start gap-3 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3">
            <span className="flex h-5 w-5 items-center justify-center rounded bg-slate-900 dark:bg-slate-700 text-[10px] font-semibold text-white">
              {index + 1}
            </span>
            <p className="text-[12px] text-slate-700 dark:text-slate-300">{item}</p>
          </div>
        ))}
      </div>
      <ActionRow />
    </div>
  );
}

// ── Probe Transcript Tab ──────────────────────────────────────────────────

function ProbesTab({ agent, runId }: { agent: IntelligenceAgent; runId: string | null }) {
  const [calls, setCalls] = useState<LlmCall[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    setLoading(true);
    getLlmCalls(runId)
      .then((log) => {
        // Only THIS agent's target-call probes. The backend stamps agent_name on
        // every call, so we scope strictly — an agent that sent no probes shows
        // an empty state rather than the whole run's shared probe set. Legacy
        // rows without agent_name are only shown when nothing is attributed at all.
        const anyAttributed = log.calls.some((c) => c.call_type === "target" && c.agent_name);
        const agentCalls = log.calls.filter(
          (c) =>
            c.call_type === "target" &&
            (c.agent_name
              ? c.agent_name === agent.id
              : !anyAttributed),
        );
        setCalls(agentCalls);
      })
      .catch(() => setCalls([]))
      .finally(() => setLoading(false));
  }, [runId, agent.id]);

  const targetCalls = calls ?? [];

  // Group probes by the governance experiment they belong to, so the transcript
  // reads as a set of designed experiments (matched pairs, single-variable
  // variations, injection attempts) rather than a flat, seemingly-random list.
  const probeGroups = useMemo(() => {
    const order: string[] = [];
    const byId = new Map<string, { experiment: ProbeExperiment; calls: { call: LlmCall; number: number }[] }>();
    targetCalls.forEach((call, i) => {
      const experiment = experimentFor(call.task);
      let group = byId.get(experiment.id);
      if (!group) {
        group = { experiment, calls: [] };
        byId.set(experiment.id, group);
        order.push(experiment.id);
      }
      group.calls.push({ call, number: i + 1 });
    });
    return order.map((id) => byId.get(id)!);
  }, [targetCalls]);

  // On a multi-endpoint system the experiment grouping alone leaves the
  // transcript looking scattered: probes for different audited surfaces sit
  // interleaved with nothing saying which surface each one hit. Endpoint is the
  // outer axis in that case. A single-endpoint system renders exactly as before
  // — one section, no extra chrome for a distinction that doesn't exist.
  const endpointSections = useMemo(() => {
    const order: string[] = [];
    const byEndpoint = new Map<string, { call: LlmCall; number: number }[]>();
    targetCalls.forEach((call, i) => {
      const key = call.endpoint_ref ?? "";
      if (!byEndpoint.has(key)) {
        byEndpoint.set(key, []);
        order.push(key);
      }
      byEndpoint.get(key)!.push({ call, number: i + 1 });
    });
    return order.map((endpoint) => {
      const entries = byEndpoint.get(endpoint)!;
      const groupOrder: string[] = [];
      const groups = new Map<string, { experiment: ProbeExperiment; calls: { call: LlmCall; number: number }[] }>();
      entries.forEach((entry) => {
        const experiment = experimentFor(entry.call.task);
        if (!groups.has(experiment.id)) {
          groups.set(experiment.id, { experiment, calls: [] });
          groupOrder.push(experiment.id);
        }
        groups.get(experiment.id)!.calls.push(entry);
      });
      return {
        endpoint,
        total: entries.length,
        errors: entries.filter((e) => e.call.status !== "success").length,
        groups: groupOrder.map((id) => groups.get(id)!),
      };
    });
  }, [targetCalls]);

  const multiEndpoint = endpointSections.length > 1;

  return (
    <div className="space-y-5">
      {/* Probe methods header */}
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div>
          <SectionTitle icon={SearchCheck} title="Probe Methods" />
          <ChipGrid items={agent.methods} tone="blue" />
        </div>
        <div className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-3 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Execution summary</p>
          <div className="flex justify-between text-[12px]">
            <span className="text-slate-600 dark:text-slate-400">Probes sent</span>
            <span className="font-semibold text-slate-900 dark:text-white">{loading ? "…" : targetCalls.length}</span>
          </div>
          <div className="flex justify-between text-[12px]">
            <span className="text-slate-600 dark:text-slate-400">Errors</span>
            <span className="font-semibold text-red-600 dark:text-red-400">
              {loading ? "…" : targetCalls.filter((c) => c.status !== "success").length}
            </span>
          </div>
          <div className="flex justify-between text-[12px]">
            <span className="text-slate-600 dark:text-slate-400">Avg latency</span>
            <span className="font-semibold text-slate-900 dark:text-white">
              {loading || targetCalls.length === 0
                ? "—"
                : `${Math.round(targetCalls.reduce((s, c) => s + (c.latency_ms ?? 0), 0) / targetCalls.length)} ms`}
            </span>
          </div>
        </div>
      </div>

      {/* Live probe transcript */}
      <div>
        <SectionTitle icon={Terminal} title="Probe Transcript" />
        {loading && (
          <div className="flex items-center gap-2 text-[12px] text-slate-500 dark:text-slate-400 py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading probe transcript…
          </div>
        )}
        {!loading && targetCalls.length === 0 && (
          <div className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-4 py-6 text-center">
            <Terminal className="mx-auto h-6 w-6 text-slate-300 dark:text-slate-600 mb-2" />
            <p className="text-[12px] text-slate-500 dark:text-slate-400">
              {runId
                ? "No target probes recorded for this run yet. Probes are sent only when relevant metrics fail."
                : "No active run selected."}
            </p>
          </div>
        )}
        {!loading && targetCalls.length > 0 && multiEndpoint && (
          <div className="space-y-5">
            {endpointSections.map((section) => (
              <div key={section.endpoint || "unattributed"} className="space-y-2">
                {/* Which audited surface the probes below were sent to. */}
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900">
                  <Server className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
                  {/* Monospaced and lowercase — a URL, not a title. */}
                  <span className="break-all font-mono text-[11.5px] lowercase text-slate-700 dark:text-slate-200">
                    {section.endpoint || "no endpoint recorded"}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] text-slate-400 dark:text-slate-500">
                    {section.total} probe{section.total === 1 ? "" : "s"}
                    {section.errors > 0 && (
                      <span className="text-red-500 dark:text-red-400"> · {section.errors} error{section.errors === 1 ? "" : "s"}</span>
                    )}
                  </span>
                </div>
                <div className="space-y-4 border-l-2 border-slate-200 pl-3 dark:border-slate-700">
                  {section.groups.map((group) => (
                    <ProbeExperimentGroup
                      key={group.experiment.id}
                      group={group}
                      expanded={expanded}
                      onToggle={(id) => setExpanded(expanded === id ? null : id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {!loading && targetCalls.length > 0 && !multiEndpoint && (
          <div className="space-y-5">
            {probeGroups.map((group) => (
              <div key={group.experiment.id} className="space-y-2">
                {/* Experiment header — explains what this cluster of probes tests */}
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <FlaskConical className="h-4 w-4 text-brand-600 dark:text-brand-400" />
                    <p className="text-[12px] font-semibold text-slate-900 dark:text-white">{group.experiment.title}</p>
                    <span className="rounded bg-brand-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                      {group.experiment.method}
                    </span>
                    <span className="ml-auto text-[10px] text-slate-400 dark:text-slate-500">
                      {group.calls.length} probe{group.calls.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400">{group.experiment.description}</p>
                </div>
                <div className="space-y-2">
                  {group.calls.map(({ call, number }) => (
                    <ProbeRow
                      key={call.id}
                      call={call}
                      number={number}
                      open={expanded === call.id}
                      onToggle={() => setExpanded(expanded === call.id ? null : call.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// One probe row: header + "why this probe" caption, expanding to the full
// prompt/response transcript, a disparity strip for ranking probes, and a note
// on what a failure means.

/** One experiment's header plus its probes. Shared by the flat (single-endpoint)
 *  transcript and the endpoint-grouped one, so the two cannot drift apart. */
function ProbeExperimentGroup({
  group,
  expanded,
  onToggle,
}: {
  group: { experiment: ProbeExperiment; calls: { call: LlmCall; number: number }[] };
  expanded: string | null;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <FlaskConical className="h-4 w-4 text-brand-600 dark:text-brand-400" />
          <p className="text-[12px] font-semibold text-slate-900 dark:text-white">{group.experiment.title}</p>
          <span className="rounded bg-brand-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
            {group.experiment.method}
          </span>
          <span className="ml-auto text-[10px] text-slate-400 dark:text-slate-500">
            {group.calls.length} probe{group.calls.length === 1 ? "" : "s"}
          </span>
        </div>
        <p className="mt-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400">{group.experiment.description}</p>
      </div>
      <div className="space-y-2">
        {group.calls.map(({ call, number }) => (
          <ProbeRow
            key={call.id}
            call={call}
            number={number}
            open={expanded === call.id}
            onToggle={() => onToggle(call.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ProbeRow({
  call,
  number,
  open,
  onToggle,
}: {
  call: LlmCall;
  number: number;
  open: boolean;
  onToggle: () => void;
}) {
  const meta = probeMetaFor(call.task);
  const hasText = Boolean(call.prompt_text || call.response_text);
  const responseMedia = mediaFromResponseText(call.response_text);
  const rankingScores = open && !responseMedia ? parseRankingScores(call.response_text) : null;

  return (
    <div
      className={clsx(
        "rounded border overflow-hidden transition-colors",
        call.status === "success" ? "border-slate-200 dark:border-slate-700" : "border-red-200 dark:border-red-800",
      )}
    >
      <button
        onClick={onToggle}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60"
      >
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded bg-slate-800 dark:bg-slate-600 text-[10px] font-bold text-white">
          {number}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] font-semibold text-slate-900 dark:text-white">
              {humanizeProbeTitle(call.task)}
            </span>
            {meta?.role && (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                {meta.role}
              </span>
            )}
            <span
              className={clsx(
                "rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                call.status === "success"
                  ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400"
                  : "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400",
              )}
            >
              {call.status}
            </span>
          </div>
          {meta?.checks && (
            <p className="mt-0.5 text-[11px] italic leading-4 text-slate-500 dark:text-slate-400">{meta.checks}</p>
          )}
          <div className="mt-0.5 flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
            {call.latency_ms != null && (
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{call.latency_ms} ms</span>
            )}
            {call.request_chars != null && <span>{call.request_chars} req chars</span>}
            {call.response_chars != null && <span>{call.response_chars} resp chars</span>}
            {/* Retries are otherwise invisible: a throttled probe can be three
                real requests into the audited system shown as one row. */}
            {call.attempts != null && call.attempts > 1 && (
              <span>{call.attempts} attempts</span>
            )}
          </div>
          {/* Why it failed, in the target's own words. Without this the row was
              a bare red ERROR badge and the reason lived only in a server log —
              a 502 from the audited app, an expired key and a refused
              connection all looked identical. */}
          {call.status !== "success" && (call.error_detail || call.error_type) && (
            <p className="mt-1 break-words text-[11px] leading-4 text-red-600 dark:text-red-400">
              {call.error_type && <span className="font-semibold">{call.error_type}: </span>}
              {call.error_detail}
            </p>
          )}
        </div>
        {hasText
          ? open ? <ChevronDown className="mt-0.5 h-4 w-4 text-slate-400 shrink-0" /> : <ChevronRight className="mt-0.5 h-4 w-4 text-slate-400 shrink-0" />
          : <span className="mt-1 text-[10px] text-slate-300 dark:text-slate-600 shrink-0">metadata only</span>}
      </button>

      {open && (
        <div className="border-t border-slate-100 dark:border-slate-700/50 divide-y divide-slate-100 dark:divide-slate-700/50">
          {rankingScores && (
            <div className="p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-600 dark:text-brand-400">
                Score spread across the cohort
              </p>
              <ScoreSpread scores={rankingScores} />
            </div>
          )}
          {call.prompt_text && (
            <div className="p-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-3.5 w-3.5 text-blue-500 dark:text-blue-400" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-600 dark:text-blue-400">Probe sent to target</p>
              </div>
              <pre className="rounded bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 text-[11px] leading-5 text-slate-800 dark:text-slate-200 whitespace-pre-wrap font-mono overflow-x-auto max-h-48 overflow-y-auto">
                {call.prompt_text}
              </pre>
            </div>
          )}
          {call.response_text && (
            <div className="p-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-600 dark:text-emerald-400">Response from target</p>
                <span className="ml-auto text-[10px] text-amber-600 dark:text-amber-400 font-medium">⚠ sanitized · fenced before governance use</span>
              </div>
              {responseMedia ? (
                <div className="flex items-center justify-center rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3">
                  {responseMedia.kind === "video" ? (
                    <video src={responseMedia.url} controls className="max-h-64 max-w-full rounded" />
                  ) : responseMedia.kind === "audio" ? (
                    <audio src={responseMedia.url} controls className="w-full" />
                  ) : (
                    <img src={responseMedia.url} alt="Generated media response" className="max-h-64 max-w-full rounded" />
                  )}
                </div>
              ) : (
                <pre className="rounded bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 text-[11px] leading-5 text-slate-800 dark:text-slate-200 whitespace-pre-wrap font-mono overflow-x-auto max-h-48 overflow-y-auto">
                  {call.response_text}
                </pre>
              )}
            </div>
          )}
          {!call.prompt_text && !call.response_text && (
            <div className="px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400">
              Probe text not captured for this run (available from next run onwards).
            </div>
          )}
          {call.trace_id && (
            <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="font-semibold">Trace ID:</span>
              <span className="font-mono">{call.trace_id}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Horizontal score bars for a ranking probe's cohort, sorted high→low, with the
// top–bottom spread called out — the disparity signal at a glance.
function ScoreSpread({ scores }: { scores: CandidateScore[] }) {
  const max = Math.max(...scores.map((s) => s.score), 1);
  const spread = scores[0].score - scores[scores.length - 1].score;
  return (
    <div className="space-y-1.5">
      {scores.map((s) => (
        <div key={s.id} className="flex items-center gap-2">
          <span className="w-36 shrink-0 truncate text-[11px] text-slate-600 dark:text-slate-300" title={s.label}>{s.label}</span>
          <div className="h-3 flex-1 rounded bg-slate-100 dark:bg-slate-800">
            <div
              className="h-full rounded bg-brand-500 dark:bg-brand-400"
              style={{ width: `${Math.max(2, (s.score / max) * 100)}%` }}
            />
          </div>
          <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-slate-700 dark:text-slate-200">
            {s.score.toFixed(1)}
          </span>
        </div>
      ))}
      {scores.length > 1 && (
        <p className="pt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
          Spread: <span className="font-semibold text-slate-700 dark:text-slate-200">{spread.toFixed(1)} pts</span> between
          top and bottom of a cohort with comparable core qualifications.
        </p>
      )}
    </div>
  );
}

// Runtime execution breakdown — the real LLM/gateway calls this agent made
// during the run (target probes + governance reasoning), from the run call log.
// No mock phases: every row is an actual recorded call.
function RuntimeTab({ agent, runId }: { agent: IntelligenceAgent; runId: string | null }) {
  const [calls, setCalls] = useState<LlmCall[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!runId) return;
    setLoading(true);
    getLlmCalls(runId)
      .then((log) => {
        const anyAttributed = log.calls.some((c) => c.agent_name);
        setCalls(
          log.calls.filter((c) => (c.agent_name ? c.agent_name === agent.id : !anyAttributed)),
        );
      })
      .catch(() => setCalls([]))
      .finally(() => setLoading(false));
  }, [runId, agent.id]);

  if (!runId) {
    return <p className="text-[12px] text-slate-500 dark:text-slate-400">No active run selected.</p>;
  }
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-[12px] text-slate-500 dark:text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading runtime call log…
      </div>
    );
  }

  const agentCalls = calls ?? [];
  if (agentCalls.length === 0) {
    return (
      <p className="text-[12px] text-slate-500 dark:text-slate-400">
        No runtime calls recorded for this agent in this run.
      </p>
    );
  }

  const targetCalls = agentCalls.filter((c) => c.call_type === "target");
  const governanceCalls = agentCalls.filter((c) => c.call_type !== "target");
  const totalTokens = agentCalls.reduce((s, c) => s + (c.total_tokens ?? 0), 0);
  const totalCost = agentCalls.reduce((s, c) => s + (c.estimated_cost_usd ?? 0), 0);
  const errorCount = agentCalls.filter((c) => c.status !== "success").length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <MiniMetric label="Total Calls" value={agentCalls.length} />
        <MiniMetric label="Target Probes" value={targetCalls.length} />
        <MiniMetric label="Governance" value={governanceCalls.length} />
        <MiniMetric label="Tokens" value={totalTokens || "—"} />
        <MiniMetric label="Errors" value={errorCount} />
      </div>
      {totalCost > 0 && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Estimated LLM cost for this agent: ${totalCost.toFixed(4)}
        </p>
      )}
      <div>
        <SectionTitle icon={Layers} title="Call Sequence" />
        <div className="overflow-x-auto rounded border border-slate-200 dark:border-slate-700">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                <th className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-slate-400">#</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-slate-400">Task</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-slate-400">Type</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-slate-400">Model</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-500 dark:text-slate-400">Latency</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-500 dark:text-slate-400">Tokens</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-slate-400">Status</th>
              </tr>
            </thead>
            <tbody>
              {agentCalls.map((call, idx) => (
                <tr key={call.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2 font-mono text-slate-400 dark:text-slate-500">{idx + 1}</td>
                  <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-200">{humanizeProbeTitle(call.task)}</td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{call.call_type}</td>
                  <td className="px-3 py-2 font-mono text-slate-600 dark:text-slate-400">{call.model ?? call.deployment_name ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-600 dark:text-slate-400">{call.latency_ms != null ? `${call.latency_ms} ms` : "—"}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-600 dark:text-slate-400">{call.total_tokens ?? "—"}</td>
                  <td className="px-3 py-2">
                    <span className={clsx(
                      "rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase",
                      call.status === "success"
                        ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400"
                        : "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400",
                    )}>
                      {call.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function AgentGlyph({ agent }: { agent: IntelligenceAgent }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-900 text-[11px] font-bold text-white">
      {agent.name
        .split(" ")
        .map((part) => part[0])
        .join("")
        .slice(0, 2)}
    </span>
  );
}

const TOOL_LABELS: Record<string, string> = {
  garak: "Garak",
  presidio: "Presidio",
  ragas: "Ragas",
  deepeval: "DeepEval",
};

/** Real evidence-tool invocations this agent made while forming its findings —
 * e.g. DeepEval's BiasMetric scoring a fairness metric, Garak probing for
 * jailbreak resistance. Distinct from LLM probes: these are actual scoring
 * library calls, not prompts sent to the target/governance model. */
function ToolCallList({ toolCalls }: { toolCalls: FindingToolCall[] }) {
  return (
    <div className="space-y-2">
      {toolCalls.map((call) => {
        const skipped = call.status === "skipped";
        return (
          <div
            key={`${call.tool_name}-${call.metric_id}`}
            className={clsx(
              "flex items-center justify-between gap-3 rounded border px-3 py-2.5",
              skipped
                ? "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40"
                : call.passed === false
                ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20"
                : "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20"
            )}
          >
            <div className="flex items-start gap-2.5 min-w-0">
              <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-slate-900 dark:text-white">
                  {metricName(call.metric_id)}
                  <span className="ml-1.5 font-mono text-[11px] font-normal text-slate-400 dark:text-slate-500">
                    {call.metric_id}
                  </span>
                </p>
                <p className="mt-0.5 text-[11.5px] leading-snug text-slate-500 dark:text-slate-400">
                  {metricBlurb(call.metric_id)}
                </p>
                <p className="mt-0.5 text-[10.5px] text-slate-400 dark:text-slate-500">
                  Scored by {TOOL_LABELS[call.tool_name] ?? call.tool_name}
                  {call.formula ? ` · ${call.formula}` : ""}
                </p>
              </div>
            </div>
            <div className="shrink-0 text-right">
              {skipped ? (
                <span className="text-[11px] text-slate-400 dark:text-slate-500">skipped</span>
              ) : (
                <span
                  className={clsx(
                    "text-[12px] font-semibold",
                    call.passed === false
                      ? "text-red-700 dark:text-red-400"
                      : "text-emerald-700 dark:text-emerald-400"
                  )}
                >
                  {call.normalized_score != null ? `${Math.round(call.normalized_score * 100)}%` : "—"}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1.5 text-[13px] font-semibold text-slate-950 dark:text-white">{value}</p>
    </div>
  );
}

function ChipGrid({ items, tone }: { items: string[]; tone: "slate" | "blue" | "amber" }) {
  const colors = {
    slate: "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300",
    blue:  "border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300",
    amber: "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300",
  };

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span key={item} className={clsx("rounded border px-2.5 py-1.5 text-[12px] font-medium", colors[tone])}>
          {item}
        </span>
      ))}
    </div>
  );
}

function ImpactBar({ value }: { value: number }) {
  const magnitude = Math.min(Math.abs(value), 20);

  return (
    <div className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4">
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-semibold text-slate-950 dark:text-white">Confidence impact</p>
        <p className={clsx("text-[12px] font-semibold", value < 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")}>{value}%</p>
      </div>
      <div className="mt-3 h-2 rounded bg-slate-200 dark:bg-slate-700">
        <div className={clsx("h-full rounded", value < 0 ? "bg-red-600" : "bg-emerald-600")} style={{ width: `${(magnitude / 20) * 100}%` }} />
      </div>
      <p className="mt-2 text-[11px] text-slate-500">Applied as a deduction during council confidence scoring.</p>
    </div>
  );
}

function Timeline({ items }: { items: IntelligenceAgent["timeline"] }) {
  const [openPhase, setOpenPhase] = useState<string | null>(null);
  return (
    <div>
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Status Timeline</p>
      <div className="space-y-1">
        {items.map((item) => {
          const isOpen = openPhase === item.label;
          const dotColor =
            item.status === "complete"
              ? "bg-emerald-500"
              : item.status === "running"
              ? "bg-blue-500 animate-pulse"
              : "bg-slate-300 dark:bg-slate-600";
          return (
            <div key={item.label} className="rounded overflow-hidden border border-transparent hover:border-slate-200 dark:hover:border-slate-700 transition-colors">
              <button
                onClick={() => setOpenPhase(isOpen ? null : item.label)}
                className="flex w-full items-start gap-3 px-2 py-2 text-left"
              >
                <div className={clsx("mt-1.5 h-2.5 w-2.5 rounded-full shrink-0", dotColor)} />
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold text-slate-950 dark:text-white">{item.label}</p>
                  {!isOpen && (
                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">{item.detail}</p>
                  )}
                </div>
                {item.detail && (
                  isOpen
                    ? <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" />
                    : <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" />
                )}
              </button>
              {isOpen && item.detail && (
                <div className="px-7 pb-3">
                  <p className="text-[11px] leading-5 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 rounded border border-slate-200 dark:border-slate-700 px-3 py-2.5">
                    {item.detail}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SectionTitle({ icon: Icon, title }: { icon: React.ComponentType<{ className?: string }>; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon className="h-4 w-4 text-slate-500 dark:text-slate-400" />
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{title}</p>
    </div>
  );
}

function PhaseStepperBar({ phases }: { phases: IntelligenceAgent["timeline"] }) {
  return (
    <div className="flex items-center gap-0 px-4 py-3">
      {phases.map((phase, idx) => (
        <div key={phase.label} className="flex flex-1 items-center">
          <div className="flex flex-col items-center gap-1">
            <div
              className={clsx(
                "flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold",
                phase.status === "complete" ? "bg-emerald-500 text-white" :
                phase.status === "running" ? "bg-brand-500 text-white" :
                "bg-slate-200 text-slate-500"
              )}
            >
              {phase.status === "complete" ? "✓" : idx + 1}
            </div>
            <p className={clsx(
              "text-center text-[9px] font-semibold leading-tight",
              phase.status === "complete" ? "text-emerald-700 dark:text-emerald-400" :
              phase.status === "running" ? "text-brand-700 dark:text-brand-400" :
              "text-slate-400 dark:text-slate-500"
            )}>
              {phase.label}
            </p>
          </div>
          {idx < phases.length - 1 && (
            <div className={clsx(
              "mx-1 h-0.5 flex-1",
              phase.status === "complete" ? "bg-emerald-300 dark:bg-emerald-800" :
              phase.status === "running" ? "bg-brand-300 dark:bg-brand-800" :
              "bg-slate-200 dark:bg-slate-700"
            )} />
          )}
        </div>
      ))}
    </div>
  );
}

function ActionRow() {
  const { navigateTo } = useAppStore();
  return (
    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => navigateTo("/council")}
        title="Go to the Council Deliberation view where agent findings are synthesised into a verdict"
        className="inline-flex items-center gap-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-[12px] font-medium text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-slate-700"
      >
        <FileText className="h-4 w-4" />
        View Council Deliberation
      </button>
      <button
        onClick={() => navigateTo("/verdicts")}
        title="Jump to the Verdicts page to see the final governance outcome and risk tier"
        className="inline-flex items-center gap-2 rounded bg-[#111827] dark:bg-brand-700 px-3 py-2 text-[12px] font-semibold text-white hover:bg-slate-800 dark:hover:bg-brand-600"
      >
        <ExternalLink className="h-4 w-4" />
        View Verdict
      </button>
    </div>
  );
}
