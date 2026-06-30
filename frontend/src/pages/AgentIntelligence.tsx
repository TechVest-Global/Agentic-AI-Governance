import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Cpu,
  ExternalLink,
  FileText,
  Gauge,
  GitCompare,
  Layers,
  Loader2,
  MessageSquare,
  SearchCheck,
  ShieldAlert,
  Terminal,
} from "lucide-react";
import clsx from "clsx";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { useAppStore } from "@/store/useAppStore";
import { useGovernanceBackend } from "@/hooks/useGovernanceBackend";
import { getLlmCalls, type AgentExecution, type BackendFinding, type LlmCall } from "@/api/governanceApi";
import {
  agentRuntimeDetails,
  complianceMapperDetail,
  driftAnalystDetail,
} from "@/data/executionLayerData";

type AgentTab = "Overview" | "Probes" | "Evidence" | "Frameworks" | "Remediation" | "Runtime";

type IntelligenceAgent = {
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
};

const tabs: AgentTab[] = ["Overview", "Probes", "Evidence", "Frameworks", "Remediation", "Runtime"];

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

const PHASE_DETAILS: Record<string, string> = {
  "Context Load": "Reads run metadata, AI system profile, capabilities, prior metric results, and any evidence already recorded. Builds the AgentContext object passed to all downstream logic.",
  "Probe Design": "Selects probe prompts from the agent's curated test set. Filters to metrics that failed or are pending — if no relevant metrics exist, the agent exits early without sending any probes.",
  "Probe Execution": "Sends each structured prompt to the target model via GatewayTargetModelClient. Records latency, token counts, and sanitized output for each call. Raw output is fenced and never directly trusted.",
  "Analysis": "Passes the fenced probe evidence and metric summary to the governance model. Governance model reasons about the evidence and returns structured finding JSON. Falls back to deterministic logic if the response is not valid JSON.",
  "Evidence Emission": "Persists findings, LLM call logs (with probe transcripts), and agent execution record to the database. Confidence impacts are carried into the Council Deliberation.",
};

function buildTimeline(status: string): IntelligenceAgent["timeline"] {
  const steps = ["Context Load", "Probe Design", "Probe Execution", "Analysis", "Evidence Emission"];
  const completed = status === "completed" || status === "failed" ? 5 : status === "running" ? 2 : 0;
  return steps.map((label, i) => ({
    label,
    status: i < completed ? "complete" : status === "running" && i === completed ? "running" : "waiting",
    detail: PHASE_DETAILS[label] ?? "",
  }));
}

function mapStatus(status: string): IntelligenceAgent["status"] {
  if (status === "completed") return "Complete";
  if (status === "running") return "Running";
  return "Waiting";
}

function buildAgentsFromBackend(
  executions: AgentExecution[],
  findings: BackendFinding[],
): IntelligenceAgent[] {
  return executions.map((execution) => {
    const canon = canonicalAgent(execution.agent_name);
    const meta = AGENT_META[canon] ?? fallbackMeta(execution.agent_name);
    const agentFindings = findings.filter((f) => canonicalAgent(f.agent_name ?? "") === canon);
    const realActions = agentFindings.map((f) => f.recommended_action).filter((a): a is string => Boolean(a));
    const completed = execution.status === "completed";
    return {
      id: execution.agent_name,
      name: meta.name,
      status: mapStatus(execution.status),
      severity: highestSeverity(agentFindings),
      confidence: completed ? (execution.finding_count === 0 ? 96 : 74) : execution.status === "running" ? 40 : 0,
      confidenceImpact: agentFindings.length ? -Math.min(agentFindings.length * 5, 20) : 0,
      probes: `${execution.finding_count} finding${execution.finding_count === 1 ? "" : "s"}`,
      findings: execution.finding_count,
      purpose: meta.purpose,
      checks: meta.checks,
      methods: meta.methods,
      evidence: agentFindings.length
        ? agentFindings.map((f) => `${f.title} — ${f.severity} (${Math.round(f.confidence * 100)}% conf)`)
        : ["No findings recorded — clean result for this agent."],
      frameworks: meta.frameworks,
      remediation: realActions.length ? realActions : meta.remediation,
      timeline: buildTimeline(execution.status),
    };
  });
}

export function AgentIntelligence() {
  const backend = useGovernanceBackend();
  const { navigateTo } = useAppStore();
  const [expandedAgent, setExpandedAgent] = useState("");
  const [activeTabs, setActiveTabs] = useState<Record<string, AgentTab>>({});

  const setTab = (agentId: string, tab: AgentTab) => {
    setActiveTabs((current) => ({ ...current, [agentId]: tab }));
  };

  // Build the agent list from the latest run's real executions + findings.
  const agents = useMemo(
    () => buildAgentsFromBackend(backend.agentExecutions, backend.findings),
    [backend.agentExecutions, backend.findings],
  );

  const activeAgents = agents.filter((agent) => agent.status === "Running").length;
  const completeAgents = agents.filter((agent) => agent.status === "Complete").length;
  const totalFindings = agents.reduce((sum, agent) => sum + agent.findings, 0);
  const scoredAgents = agents.filter((agent) => agent.confidence > 0);
  const avgConfidence = scoredAgents.length
    ? Math.round(scoredAgents.reduce((sum, agent) => sum + agent.confidence, 0) / scoredAgents.length)
    : 0;
  const backendCompleted = backend.agentExecutions.filter((agent) => agent.status === "completed").length;
  const backendFailed = backend.agentExecutions.filter((agent) => agent.status === "failed").length;
  const backendFindings = backend.agentExecutions.reduce((sum, agent) => sum + agent.finding_count, 0);
  const targetSystemName = backend.report?.ai_system?.name ?? "your registered systems";

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <div className="grid gap-0 xl:grid-cols-[1fr_340px]">
          <div className="border-b border-slate-200 dark:border-white/10 p-5 xl:border-b-0 xl:border-r">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-[#111827] dark:bg-brand-700 text-white">
                <Cpu className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-700 dark:text-brand-400">Specialist Agent Swarm</p>
                <h2 className="mt-1 text-[20px] font-semibold tracking-tight text-slate-950 dark:text-white">Parallel governance intelligence for {targetSystemName}</h2>
                <p className="mt-2 max-w-3xl text-[13px] leading-5 text-slate-600 dark:text-slate-400">
                  Specialist agents probe the same target from different risk perspectives, write evidence into shared run state, and carry confidence impacts into council scoring.
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-4">
              <SummaryMetric label="Running" value={`${activeAgents}`} icon={Activity} tone="blue" />
              <SummaryMetric label="Complete" value={`${completeAgents}`} icon={CheckCircle2} tone="green" />
              <SummaryMetric label="Findings" value={`${totalFindings}`} icon={ShieldAlert} tone="red" />
              <SummaryMetric label="Avg Confidence" value={`${avgConfidence}%`} icon={Gauge} />
            </div>
          </div>
          <div className="bg-slate-50 dark:bg-slate-800/60 p-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Next actions</p>
            <p className="mt-2 text-[12px] leading-5 text-slate-600 dark:text-slate-400">
              Use this page for the agent-level operating picture. Open the engine when you need the lead-provided drawers, event trace, and ledger proof.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                onClick={() => navigateTo("/engine")}
                title="Open the full governance engine with lead-provided agent drill-downs, event details, and ledger evidence"
                className="inline-flex items-center justify-center gap-2 rounded bg-[#111827] px-3 py-2 text-[12px] font-semibold text-white hover:bg-slate-800"
              >
                <ExternalLink className="h-4 w-4" />
                Open Full Engine Trace
              </button>
              <button
                onClick={() => navigateTo("/council")}
                title="Jump to the Council Deliberation where all agent findings are synthesised"
                className="inline-flex items-center justify-center gap-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-[12px] font-medium text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                <FileText className="h-4 w-4" />
                Go to Council
              </button>
            </div>
          </div>
        </div>
      </Card>


      {agents.length === 0 ? (
        <Card className="p-10 text-center">
          <Cpu className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" />
          <p className="mt-3 text-[14px] font-semibold text-slate-900 dark:text-white">
            {backend.loading ? "Loading agents…" : "No agent activity yet"}
          </p>
          <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
            Register a system and run an evaluation to see specialist agents execute here.
          </p>
        </Card>
      ) : (
        <>
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Agent Network</p>
            <p className="mt-1 text-[13px] font-semibold text-slate-950 dark:text-white">Live handoff from orchestrator to {agents.length} specialist agent{agents.length === 1 ? "" : "s"}</p>
          </div>
          <button
            onClick={() => navigateTo("/engine")}
            className="hidden rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-[12px] font-medium text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-slate-700 md:block"
          >
            Inspect in Engine
          </button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-5">
          {agents.map((agent, i) => (
            <button
              key={agent.id}
              style={{ animationDelay: `${i * 70}ms` }}
              onClick={() => {
                setExpandedAgent(agent.id);
                setTab(agent.id, "Overview");
              }}
              className={clsx(
                "animate-rise rounded-lg border p-3 text-left transition-all hover:border-brand-300 hover:bg-brand-50/40 dark:hover:bg-brand-900/20 hover:shadow-sm",
                expandedAgent === agent.id ? "border-brand-300 bg-brand-50/50 dark:bg-brand-900/20" : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <AgentGlyph agent={agent} />
                <StatusDot status={agent.status} />
              </div>
              <p className="mt-3 truncate text-[12px] font-semibold text-slate-950 dark:text-white">{agent.name}</p>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{agent.probes}</p>
              <div className="mt-3 flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded-full bg-slate-100 dark:bg-slate-700">
                  <div
                    className={clsx("h-1.5 rounded-full", agent.status === "Complete" ? "bg-emerald-500" : agent.status === "Running" ? "bg-brand-500" : "bg-slate-300 dark:bg-slate-600")}
                    style={{ width: `${agent.confidence || 18}%` }}
                  />
                </div>
                <span className="text-[11px] font-semibold tabular-nums text-slate-500 dark:text-slate-400">{agent.confidence || 18}%</span>
              </div>
            </button>
          ))}
        </div>
      </Card>

      <div className="hidden">
        <div className="max-w-2xl space-y-1">
          <p className="text-[13px] leading-5 text-slate-600">
            Specialist governance agents run concurrently to probe, test, and map evidence about the target AI system. Each agent contributes confidence deductions and finding packages to the Council Deliberation.
          </p>
          <p className="text-[11px] text-slate-400">Click an agent row to expand · Use tabs to navigate Overview / Probes / Evidence / Frameworks / Remediation / Runtime · Navigate to Council or Verdict from within each agent</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => navigateTo("/engine")}
            title="Open the full governance engine with lead-provided agent drill-downs, event details, and ledger evidence"
            className="rounded border border-slate-300 bg-white px-3 py-2 text-[12px] font-medium text-slate-900 hover:bg-slate-50"
          >
            Open Engine Drill-down
          </button>
          <button
            onClick={() => navigateTo("/council")}
            title="Jump to the Council Deliberation where all agent findings are synthesised"
            className="rounded bg-[#111827] px-3 py-2 text-[12px] font-semibold text-white hover:bg-slate-800"
          >
            Go to Council →
          </button>
        </div>
      </div>

      <div className="hidden">
        <SummaryMetric label="Active Agents" value="4 / 5" icon={Activity} />
        <SummaryMetric label="Critical Findings" value="1" icon={ShieldAlert} tone="red" />
        <SummaryMetric label="Probe Coverage" value="111" icon={SearchCheck} tone="blue" />
        <SummaryMetric label="Avg Confidence" value="78%" icon={Gauge} tone="green" />
      </div>

      <div className="space-y-3">
        {agents.map((agent) => {
          const expanded = expandedAgent === agent.id;
          const activeTab = activeTabs[agent.id] ?? "Overview";

          return (
            <Card key={agent.id} className={clsx("overflow-hidden transition-shadow", expanded && "shadow-md", agent.severity === "Critical" && "border-l-2 border-l-red-500")}>
              <button
                onClick={() => setExpandedAgent(expanded ? "" : agent.id)}
                className="grid w-full grid-cols-[minmax(0,1fr)_120px_120px_120px_32px] items-center gap-4 px-4 py-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <AgentGlyph agent={agent} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[14px] font-semibold text-slate-950 dark:text-white">{agent.name}</p>
                      <SeverityBadge severity={agent.severity} />
                    </div>
                    <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-slate-600 dark:text-slate-400">{agent.purpose}</p>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Status</p>
                  <StatusBadge status={agent.status} />
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Probes</p>
                  <p className="mt-1 text-[12px] font-semibold text-slate-950 dark:text-white">{agent.probes}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Confidence</p>
                  <p className="mt-1 text-[12px] font-semibold text-slate-950 dark:text-white">{agent.confidence ? `${agent.confidence}%` : "Pending"}</p>
                </div>
                {expanded ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
              </button>

              {expanded && (
                <div className="border-t border-slate-200 dark:border-white/10 bg-slate-50/60 dark:bg-slate-800/40">
                  <PhaseStepperBar phases={agent.timeline} />
                  <div className="flex gap-1 border-b border-slate-200 dark:border-white/10 px-4 pt-3">
                    {tabs.map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setTab(agent.id, tab)}
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
                    <ExpandedTab agent={agent} tab={activeTab} runId={backend.latestRun?.id ?? null} />
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
        </>
      )}
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
    return <RuntimeTab agentId={agent.id} />;
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
          <MiniMetric label="Reproducibility" value={agent.id === "bias-auditor" ? "92%" : "In review"} />
          <MiniMetric label="Confidence Impact" value={`${agent.confidenceImpact}%`} />
        </div>
        {/* Agent-specific evidence detail */}
        {agent.id === "compliance-mapper" && <ComplianceMapperDetail />}
        {agent.id === "drift-analyst" && <DriftAnalystDetail />}
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
        {/* Compliance Mapper framework detail */}
        {agent.id === "compliance-mapper" && <ComplianceMapperDetail />}
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
        // Only target-call probes for this agent
        const agentCalls = log.calls.filter(
          (c) => c.call_type === "target" && (!c.agent_name || c.agent_name === agent.id),
        );
        setCalls(agentCalls.length > 0 ? agentCalls : log.calls.filter((c) => c.call_type === "target"));
      })
      .catch(() => setCalls([]))
      .finally(() => setLoading(false));
  }, [runId, agent.id]);

  const targetCalls = calls ?? [];

  return (
    <div className="space-y-5">
      {/* Probe methods header */}
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div>
          <SectionTitle icon={SearchCheck} title="Probe Methods" />
          <ChipGrid items={agent.methods} tone="blue" />
          <p className="mt-3 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
            Each probe is sent as a standalone message to the target model. Output is sanitized and fenced
            before being passed to the governance reasoning layer — raw target content never enters
            governance prompts unfenced.
          </p>
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
        {!loading && targetCalls.length > 0 && (
          <div className="space-y-2">
            {targetCalls.map((call, idx) => {
              const isOpen = expanded === call.id;
              const hasText = call.prompt_text || call.response_text;
              return (
                <div
                  key={call.id}
                  className={clsx(
                    "rounded border overflow-hidden transition-colors",
                    call.status === "success"
                      ? "border-slate-200 dark:border-slate-700"
                      : "border-red-200 dark:border-red-800",
                  )}
                >
                  {/* Probe row header */}
                  <button
                    onClick={() => setExpanded(isOpen ? null : call.id)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-slate-800 dark:bg-slate-600 text-[10px] font-bold text-white">
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[12px] font-semibold text-slate-900 dark:text-white font-mono">
                          {call.task ?? "probe"}
                        </span>
                        <span className={clsx(
                          "rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                          call.status === "success"
                            ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400"
                            : "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400",
                        )}>
                          {call.status}
                        </span>
                        <span className="rounded bg-blue-100 dark:bg-blue-900/30 px-1.5 py-0.5 text-[9px] font-semibold text-blue-700 dark:text-blue-400 uppercase">
                          target
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
                        {call.latency_ms != null && (
                          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{call.latency_ms} ms</span>
                        )}
                        {call.request_chars != null && (
                          <span>{call.request_chars} req chars</span>
                        )}
                        {call.response_chars != null && (
                          <span>{call.response_chars} resp chars</span>
                        )}
                        {call.total_tokens != null && (
                          <span>{call.total_tokens} tokens</span>
                        )}
                      </div>
                    </div>
                    {hasText
                      ? isOpen ? <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" /> : <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
                      : <span className="text-[10px] text-slate-300 dark:text-slate-600 shrink-0">metadata only</span>
                    }
                  </button>

                  {/* Expanded transcript */}
                  {isOpen && (
                    <div className="border-t border-slate-100 dark:border-slate-700/50 divide-y divide-slate-100 dark:divide-slate-700/50">
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
                          <pre className="rounded bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 text-[11px] leading-5 text-slate-800 dark:text-slate-200 whitespace-pre-wrap font-mono overflow-x-auto max-h-48 overflow-y-auto">
                            {call.response_text}
                          </pre>
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
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// Runtime execution breakdown tab
function RuntimeTab({ agentId }: { agentId: string }) {
  const detail = agentRuntimeDetails.find((d) => d.agentId === agentId);
  if (!detail) return <p className="text-[12px] text-slate-500">No runtime detail available.</p>;

  return (
    <div className="space-y-5">
      {/* Agent Runtime Phases */}
      <div>
        <SectionTitle icon={Layers} title="Agent Runtime Phases" />
        <div className="space-y-2">
          {detail.phases.map((phase, idx) => (
            <div key={phase.phase} className={clsx(
              "flex items-start gap-3 rounded border p-3",
              phase.status === "complete" ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20" :
              phase.status === "running" ? "border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20" :
              "border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30"
            )}>
              <div className="flex items-center gap-2 shrink-0">
                <span className="flex h-5 w-5 items-center justify-center rounded bg-slate-800 dark:bg-slate-600 text-[10px] font-bold text-white">
                  {idx + 1}
                </span>
                {phase.status === "complete" && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
                {phase.status === "running" && <Loader2 className="h-3.5 w-3.5 text-blue-600 animate-spin" />}
                {phase.status === "waiting" && <div className="h-3.5 w-3.5 rounded-full border-2 border-slate-300" />}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-[12px] font-semibold text-slate-900 dark:text-white">{phase.phase}</p>
                  {phase.duration && (
                    <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">{phase.duration}</span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-400">{phase.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Runtime Detail Grid */}
      <div className="grid gap-4 md:grid-cols-2">
        <RuntimeDetail label="Evaluates" value={detail.evaluates} />
        <RuntimeDetail label="Why Activated" value={detail.activationReason} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 mb-2">Data Used</p>
          <div className="space-y-1.5">
            {detail.dataUsed.map((item) => (
              <div key={item} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-blue-400 shrink-0" />
                <span className="text-[11px] text-slate-700 dark:text-slate-300">{item}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 mb-2">Probes Run</p>
          <div className="space-y-1.5">
            {detail.probesRun.map((item) => (
              <div key={item} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                <span className="text-[11px] text-slate-700 dark:text-slate-300">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 mb-2">Metrics Calculated</p>
          <div className="space-y-1.5">
            {detail.metricsCalculated.map((item) => (
              <div key={item} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                <span className="text-[11px] font-mono text-slate-700 dark:text-slate-300">{item}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 mb-2">Evidence Produced</p>
          <div className="space-y-1.5">
            {detail.evidenceProduced.map((item) => (
              <div key={item} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-purple-400 shrink-0" />
                <span className="text-[11px] text-slate-700 dark:text-slate-300">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Confidence + Artifact */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Confidence Impact</p>
          <p className="mt-1 text-[14px] font-semibold text-red-700 dark:text-red-400">{detail.confidenceImpact}</p>
        </div>
        <div className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Artifact Emitted</p>
          <p className="mt-1 text-[12px] font-mono text-slate-800 dark:text-slate-200">{detail.artifactEmitted}</p>
        </div>
      </div>
    </div>
  );
}

function RuntimeDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1.5 text-[12px] leading-5 text-slate-800 dark:text-slate-200">{value}</p>
    </div>
  );
}

// Compliance Mapper specific detail for the registered target system
function ComplianceMapperDetail() {
  const [expandedSection, setExpandedSection] = useState<string | null>("euAiActAnnexIV");
  const d = complianceMapperDetail;

  const sections = [
    { key: "euAiActAnnexIV", data: d.euAiActAnnexIV },
    { key: "sr117", data: d.sr117 },
    { key: "nistAiRmf", data: d.nistAiRmf },
    { key: "iso42001", data: d.iso42001 },
  ];

  return (
    <div className="mt-4 space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Chatbot Compliance Detail</p>

      {sections.map(({ key, data }) => (
        <div key={key} className="rounded border border-slate-200 dark:border-slate-700 overflow-hidden">
          <button
            onClick={() => setExpandedSection(expandedSection === key ? null : key)}
            className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60"
          >
            <p className="text-[12px] font-semibold text-slate-900 dark:text-white">{data.title}</p>
            {expandedSection === key ? <ChevronDown className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />}
          </button>
          {expandedSection === key && (
            <div className="border-t border-slate-100 dark:border-slate-700/50 px-3 py-2.5">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-700">
                    <th className="pb-2 text-left font-semibold text-slate-500 dark:text-slate-400">Clause</th>
                    <th className="pb-2 text-left font-semibold text-slate-500 dark:text-slate-400">Status</th>
                    <th className="pb-2 text-left font-semibold text-slate-500 dark:text-slate-400">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {data.checks.map((check) => (
                    <tr key={check.clause} className="border-b border-slate-50 dark:border-slate-800">
                      <td className="py-2 pr-3 font-medium text-slate-800 dark:text-slate-200">{check.clause}</td>
                      <td className="py-2 pr-3">
                        <span className={clsx(
                          "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                          check.status === "Pass" ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400" :
                          check.status === "Fail" ? "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400" :
                          "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400"
                        )}>
                          {check.status}
                        </span>
                      </td>
                      <td className="py-2 text-slate-600 dark:text-slate-400">{check.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}

      {/* Evidence correlation and missing items */}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Evidence-to-Control Correlation</p>
          <p className="mt-1.5 text-[18px] font-semibold text-slate-900 dark:text-white">{d.evidenceToControlCorrelation}</p>
          <div className="mt-2 h-2 rounded bg-slate-200 dark:bg-slate-700">
            <div className="h-full rounded bg-amber-500" style={{ width: `${d.evidenceToControlCorrelation * 100}%` }} />
          </div>
        </div>
        <div className="rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-red-600 dark:text-red-400">Missing Items</p>
          <div className="mt-1.5 space-y-1">
            {d.missingItems.map((item) => (
              <p key={item} className="text-[11px] text-red-800 dark:text-red-300">• {item}</p>
            ))}
          </div>
        </div>
      </div>

      {/* Remediation requirements */}
      <div className="rounded border border-slate-200 dark:border-slate-700 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 mb-2">Remediation Requirements</p>
        {d.remediationRequirements.map((item, idx) => (
          <div key={item} className="flex items-start gap-2 py-1">
            <span className="flex h-4 w-4 items-center justify-center rounded bg-slate-800 dark:bg-slate-600 text-[9px] font-bold text-white shrink-0">{idx + 1}</span>
            <p className="text-[11px] text-slate-700 dark:text-slate-300">{item}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// Drift Analyst specific detail for TechVest RAG Chatbot
function DriftAnalystDetail() {
  const d = driftAnalystDetail;

  return (
    <div className="mt-4 space-y-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Drift Analysis — TechVest RAG Chatbot vs baseline</p>

      {/* Version comparison */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Baseline Version</p>
          <p className="mt-1 text-[13px] font-mono font-semibold text-slate-900 dark:text-white">{d.baselineVersion}</p>
        </div>
        <div className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Current Version</p>
          <p className="mt-1 text-[13px] font-mono font-semibold text-slate-900 dark:text-white">{d.currentVersion}</p>
        </div>
        <div className={clsx(
          "rounded border p-3",
          d.thresholdComparison.score < d.thresholdComparison.threshold
            ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30"
            : "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20"
        )}>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Threshold Status</p>
          <p className={clsx("mt-1 text-[13px] font-semibold",
            d.thresholdComparison.score < d.thresholdComparison.threshold ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"
          )}>
            {d.thresholdComparison.score} / {d.thresholdComparison.threshold} — {d.thresholdComparison.status}
          </p>
        </div>
      </div>

      {/* Benchmark replay results */}
      <div className="rounded border border-slate-200 dark:border-slate-700 p-3">
        <div className="flex items-center gap-2 mb-3">
          <GitCompare className="h-4 w-4 text-slate-500 dark:text-slate-400" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Benchmark Replay Results ({d.benchmarkReplay.completed}/{d.benchmarkReplay.totalPrompts} complete)</p>
        </div>
        <div className="space-y-1.5">
          {d.benchmarkReplay.distribution.map((item) => (
            <div key={item.prompt} className="flex items-center gap-3">
              <p className="flex-1 text-[11px] text-slate-700 dark:text-slate-300 truncate">{item.prompt}</p>
              <div className="w-32 h-2 rounded bg-slate-200 dark:bg-slate-700">
                <div
                  className={clsx("h-full rounded", item.similarity >= 0.80 ? "bg-emerald-500" : item.similarity >= 0.60 ? "bg-amber-500" : "bg-red-500")}
                  style={{ width: `${item.similarity * 100}%` }}
                />
              </div>
              <span className={clsx(
                "text-[11px] font-mono w-10 text-right",
                item.similarity >= 0.80 ? "text-emerald-700 dark:text-emerald-400" : item.similarity >= 0.60 ? "text-amber-700 dark:text-amber-400" : "text-red-700 dark:text-red-400"
              )}>
                {item.similarity.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Output distribution drift */}
      <div className="grid gap-3 md:grid-cols-3">
        <DriftMetric label="Approval Rate" v40={d.outputDistributionDrift.approvalRate.v40} v42={d.outputDistributionDrift.approvalRate.v42} delta={d.outputDistributionDrift.approvalRate.delta} />
        <DriftMetric label="Avg Confidence" v40={d.outputDistributionDrift.avgConfidence.v40} v42={d.outputDistributionDrift.avgConfidence.v42} delta={d.outputDistributionDrift.avgConfidence.delta} />
        <DriftMetric label="Boundary Decisions" v40={d.outputDistributionDrift.boundaryDecisions.v40} v42={d.outputDistributionDrift.boundaryDecisions.v42} delta={d.outputDistributionDrift.boundaryDecisions.delta} />
      </div>

      {/* Explanation drift */}
      <div className="rounded border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-400">Explanation Drift (Consistency: {d.explanationDrift.consistencyScore})</p>
        <div className="mt-2 space-y-1">
          {d.explanationDrift.majorChanges.map((change) => (
            <p key={change} className="text-[11px] text-amber-800 dark:text-amber-300">• {change}</p>
          ))}
        </div>
      </div>

      {/* Production telemetry */}
      <div className="rounded border border-slate-200 dark:border-slate-700 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 mb-2">Production Telemetry ({d.productionTelemetry.period})</p>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400">Avg Latency</p>
            <p className="text-[11px] font-mono text-slate-800 dark:text-slate-200">{d.productionTelemetry.avgLatency.v40} → {d.productionTelemetry.avgLatency.v42}</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400">Error Rate</p>
            <p className="text-[11px] font-mono text-slate-800 dark:text-slate-200">{d.productionTelemetry.errorRate.v40} → {d.productionTelemetry.errorRate.v42}</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400">Override Rate</p>
            <p className="text-[11px] font-mono text-slate-800 dark:text-slate-200">{d.productionTelemetry.overrideRate.v40} → {d.productionTelemetry.overrideRate.v42}</p>
          </div>
        </div>
      </div>

      {/* Finding F-002 */}
      <div className="rounded border-l-4 border-l-orange-400 border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/20 p-3">
        <p className="text-[11px] font-semibold text-orange-800 dark:text-orange-300">Finding F-002: {d.findingF002.title}</p>
        <p className="mt-1 text-[11px] leading-4.5 text-orange-700 dark:text-orange-400">{d.findingF002.detail}</p>
      </div>
    </div>
  );
}

function DriftMetric({ label, v40, v42, delta }: { label: string; v40: string; v42: string; delta: string }) {
  const isNegative = delta.startsWith("-");
  return (
    <div className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{label}</p>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">{v40}</span>
        <span className="text-[10px] text-slate-400 dark:text-slate-500">→</span>
        <span className="text-[11px] font-mono text-slate-900 dark:text-white">{v42}</span>
        <span className={clsx("text-[10px] font-semibold", isNegative ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400")}>({delta})</span>
      </div>
    </div>
  );
}

function AgentGlyph({ agent }: { agent: IntelligenceAgent }) {
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

function StatusDot({ status }: { status: IntelligenceAgent["status"] }) {
  const color = status === "Complete" ? "bg-emerald-500" : status === "Running" ? "bg-brand-500" : "bg-slate-300";
  return (
    <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
      <span className={clsx("h-2 w-2 rounded-full", color, status === "Running" && "animate-pulse")} />
      {status}
    </span>
  );
}

function SummaryMetric({
  label,
  value,
  icon: Icon,
  tone = "slate",
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "slate" | "red" | "blue" | "green";
}) {
  const iconColor = {
    slate: "text-slate-300 dark:text-slate-600",
    red: "text-red-400",
    blue: "text-slate-300 dark:text-slate-600",
    green: "text-emerald-400",
  }[tone];

  return (
    <Card className="px-4 py-3 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">{label}</p>
        <Icon className={clsx("h-4 w-4 shrink-0", iconColor)} />
      </div>
      <p className="mt-1.5 text-3xl font-bold tracking-tight text-slate-900 dark:text-white tabular-nums">{value}</p>
    </Card>
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

function SeverityBadge({ severity }: { severity: IntelligenceAgent["severity"] }) {
  const colors = {
    Critical: "red",
    High: "red",
    Medium: "amber",
    Low: "green",
  } as const;

  return <Badge tone={colors[severity]}>{severity}</Badge>;
}

function StatusBadge({ status }: { status: IntelligenceAgent["status"] }) {
  const colors = {
    Running: "amber",
    Complete: "green",
    Waiting: "slate",
  } as const;

  return <Badge tone={colors[status]}>{status}</Badge>;
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
