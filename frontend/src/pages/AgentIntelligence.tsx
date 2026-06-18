import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Cpu,
  ExternalLink,
  FileText,
  Gauge,
  GitCompare,
  Layers,
  Loader2,
  SearchCheck,
  ShieldAlert,
} from "lucide-react";
import clsx from "clsx";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { useAppStore } from "@/store/useAppStore";
import {
  agentRuntimeDetails,
  complianceMapperDetail,
  driftAnalystDetail,
  type AgentRuntimeDetail,
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

const agents: IntelligenceAgent[] = [
  {
    id: "bias-auditor",
    name: "Bias Auditor",
    status: "Running",
    severity: "Critical",
    confidence: 87,
    confidenceImpact: -12,
    probes: "50 controlled pairs",
    findings: 1,
    purpose: "Detects demographic and protected-attribute disparities.",
    checks: [
      "age-based disparity",
      "gender-based disparity",
      "ethnicity-based disparity",
      "protected attribute bias",
      "proxy discrimination",
      "disparate impact",
      "approval/rejection language differences",
      "recommendation consistency across cohorts",
    ],
    methods: [
      "controlled paired testing",
      "cohort comparison",
      "proxy variable testing",
      "same applicant profile with only protected attribute changed",
      "statistical disparity measurement",
    ],
    evidence: [
      "50 controlled probe pairs",
      "BA-P24 to BA-P50",
      "34% more negative approval language for applicants aged 65+",
      "reproducibility 92%",
      "confidence impact -12%",
    ],
    frameworks: ["EU AI Act Art.10(2)(f)", "SR 11-7 §4.1", "NIST AI RMF", "ISO 42001"],
    remediation: [
      "expand representative testing data",
      "run additional cohort probes",
      "review training data distribution",
      "evaluate prompt/business-rule contribution",
      "require human approval before production promotion",
    ],
    timeline: [
      { label: "Initialization", status: "complete", detail: "Loaded system profile and 50-probe budget" },
      { label: "Probe Design", status: "complete", detail: "Age, gender, ethnicity, and proxy-pair probes generated" },
      { label: "Probe Execution", status: "running", detail: "48/50 probes — persistent disparity signal" },
      { label: "Analysis", status: "running", detail: "Computing disparate impact ratio and framework mapping" },
      { label: "Evidence Emission", status: "waiting", detail: "F-001 emitted — awaiting council confidence" },
    ],
  },
  {
    id: "drift-analyst",
    name: "Drift Analyst",
    status: "Running",
    severity: "High",
    confidence: 78,
    confidenceImpact: -8,
    probes: "17 baseline replays",
    findings: 1,
    purpose: "Detects behavioral and semantic divergence from validated model baselines.",
    checks: ["semantic drift", "reasoning drift", "tone shift", "baseline divergence", "decision-boundary changes"],
    methods: ["benchmark replay", "embedding similarity", "golden response comparison", "threshold scoring"],
    evidence: ["mean semantic similarity 0.61", "threshold 0.80", "17 replay prompts", "drift concentrated in boundary cases"],
    frameworks: ["NIST AI RMF Measure 2.5", "ISO 42001 §9.1", "EU AI Act Art.15"],
    remediation: ["review prompt template changes", "revalidate baseline", "increase replay coverage", "flag model owner"],
    timeline: [
      { label: "Initialization", status: "complete", detail: "Loaded baseline v4.0 responses and benchmarks" },
      { label: "Probe Design", status: "complete", detail: "Selected 20 golden prompts for replay" },
      { label: "Probe Execution", status: "running", detail: "17/20 benchmark replays complete" },
      { label: "Analysis", status: "running", detail: "Computing semantic similarity and KL-divergence" },
      { label: "Evidence Emission", status: "waiting", detail: "F-002 — drift below threshold confirmed" },
    ],
  },
  {
    id: "misuse-detector",
    name: "Misuse Detector",
    status: "Complete",
    severity: "Low",
    confidence: 92,
    confidenceImpact: 0,
    probes: "15 attack vectors",
    findings: 0,
    purpose: "Tests jailbreak, prompt injection, role confusion, and policy-boundary abuse.",
    checks: ["prompt injection", "role confusion", "tool misuse", "data leakage", "scope violation"],
    methods: ["adversarial prompt set", "multi-turn jailbreak attempts", "boundary-condition probing"],
    evidence: ["15/15 attack vectors held boundary", "no tool escalation", "no sensitive data leakage"],
    frameworks: ["OWASP LLM Top 10", "MITRE ATLAS", "NIST AI RMF"],
    remediation: ["continue scheduled red-team probes", "retain existing prompt firewall", "review after model update"],
    timeline: [
      { label: "Initialization", status: "complete", detail: "OWASP and MITRE attack libraries loaded" },
      { label: "Probe Design", status: "complete", detail: "15 attack vectors selected" },
      { label: "Probe Execution", status: "complete", detail: "15/15 — all boundaries held" },
      { label: "Analysis", status: "complete", detail: "Boundary hold rate 100%, clean result" },
      { label: "Evidence Emission", status: "complete", detail: "Clean bundle delivered to aggregator" },
    ],
  },
  {
    id: "compliance-mapper",
    name: "Compliance Mapper",
    status: "Running",
    severity: "Medium",
    confidence: 81,
    confidenceImpact: -6,
    probes: "12 clause checks",
    findings: 1,
    purpose: "Maps system evidence and behavior to selected governance frameworks.",
    checks: ["technical documentation", "transparency notices", "deployer obligations", "risk classification"],
    methods: ["clause mapping", "document completeness review", "sampled behavioral compliance checks"],
    evidence: ["Annex IV 3.2 missing", "Annex IV 4.1 missing", "2 of 5 paths lack complete disclosure"],
    frameworks: ["EU AI Act Annex IV", "EU AI Act Art.52", "SR 11-7"],
    remediation: ["complete technical file", "add disclosure coverage", "require compliance sign-off"],
    timeline: [
      { label: "Initialization", status: "complete", detail: "Loaded 4-framework requirements matrix" },
      { label: "Probe Design", status: "complete", detail: "12 clause-level compliance checks designed" },
      { label: "Probe Execution", status: "running", detail: "10/12 probes — Annex IV gaps confirmed" },
      { label: "Analysis", status: "running", detail: "Computing completeness scores" },
      { label: "Evidence Emission", status: "waiting", detail: "F-003 emitted — awaiting final probes" },
    ],
  },
  {
    id: "explainability-agent",
    name: "Explainability Agent",
    status: "Running",
    severity: "Medium",
    confidence: 64,
    confidenceImpact: -5,
    probes: "7 explanation probes",
    findings: 0,
    purpose: "Evaluates whether model explanations match observed decision behavior.",
    checks: ["feature attribution", "reasoning consistency", "citation fidelity", "explanation faithfulness"],
    methods: ["counterfactual explanations", "factor perturbation", "decision rationale comparison"],
    evidence: ["7 of 20 probes complete", "early signal: debt ratio underexplained", "manual review queued"],
    frameworks: ["NIST AI RMF", "ISO 42001", "EU AI Act Art.13"],
    remediation: ["expand explanation probes", "compare to SHAP baseline", "review rationale template"],
    timeline: [
      { label: "Initialization", status: "complete", detail: "Loaded explanation outputs and SHAP baseline" },
      { label: "Probe Design", status: "complete", detail: "20 explanation probes designed" },
      { label: "Probe Execution", status: "running", detail: "7/20 probes — debt ratio signal" },
      { label: "Analysis", status: "running", detail: "Computing faithfulness and attribution" },
      { label: "Evidence Emission", status: "waiting", detail: "Early signal pending confirmation" },
    ],
  },
];

export function AgentIntelligence() {
  const { navigateTo } = useAppStore();
  const [expandedAgent, setExpandedAgent] = useState("bias-auditor");
  const [activeTabs, setActiveTabs] = useState<Record<string, AgentTab>>({
    "bias-auditor": "Overview",
  });

  const setTab = (agentId: string, tab: AgentTab) => {
    setActiveTabs((current) => ({ ...current, [agentId]: tab }));
  };

  const activeAgents = agents.filter((agent) => agent.status === "Running").length;
  const completeAgents = agents.filter((agent) => agent.status === "Complete").length;
  const totalFindings = agents.reduce((sum, agent) => sum + agent.findings, 0);
  const scoredAgents = agents.filter((agent) => agent.confidence > 0);
  const avgConfidence = Math.round(scoredAgents.reduce((sum, agent) => sum + agent.confidence, 0) / scoredAgents.length);

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <div className="grid gap-0 xl:grid-cols-[1fr_340px]">
          <div className="border-b border-slate-200 p-5 xl:border-b-0 xl:border-r">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-[#111827] text-white">
                <Cpu className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-700">Specialist Agent Swarm</p>
                <h2 className="mt-1 text-[20px] font-semibold tracking-tight text-slate-950">Parallel governance intelligence for credit-scoring-v4.2</h2>
                <p className="mt-2 max-w-3xl text-[13px] leading-5 text-slate-600">
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
          <div className="bg-slate-50 p-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Next actions</p>
            <p className="mt-2 text-[12px] leading-5 text-slate-600">
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
                className="inline-flex items-center justify-center gap-2 rounded border border-slate-300 bg-white px-3 py-2 text-[12px] font-medium text-slate-900 hover:bg-slate-50"
              >
                <FileText className="h-4 w-4" />
                Go to Council
              </button>
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Agent Network</p>
            <p className="mt-1 text-[13px] font-semibold text-slate-950">Live handoff from orchestrator to 5 specialist agents</p>
          </div>
          <button
            onClick={() => navigateTo("/engine")}
            className="hidden rounded border border-slate-300 bg-white px-3 py-2 text-[12px] font-medium text-slate-900 hover:bg-slate-50 md:block"
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
                "animate-rise rounded-lg border p-3 text-left transition-all hover:border-brand-300 hover:bg-brand-50/40 hover:shadow-sm",
                expandedAgent === agent.id ? "border-brand-300 bg-brand-50/50" : "border-slate-200 bg-white"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <AgentGlyph agent={agent} />
                <StatusDot status={agent.status} />
              </div>
              <p className="mt-3 truncate text-[12px] font-semibold text-slate-950">{agent.name}</p>
              <p className="mt-1 text-[11px] text-slate-500">{agent.probes}</p>
              <div className="mt-3 flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded-full bg-slate-100">
                  <div
                    className={clsx("h-1.5 rounded-full", agent.status === "Complete" ? "bg-emerald-500" : agent.status === "Running" ? "bg-brand-500" : "bg-slate-300")}
                    style={{ width: `${agent.confidence || 18}%` }}
                  />
                </div>
                <span className="text-[11px] font-semibold tabular-nums text-slate-500">{agent.confidence || 18}%</span>
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
                className="grid w-full grid-cols-[minmax(0,1fr)_120px_120px_120px_32px] items-center gap-4 px-4 py-4 text-left hover:bg-slate-50"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <AgentGlyph agent={agent} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[14px] font-semibold text-slate-950">{agent.name}</p>
                      <SeverityBadge severity={agent.severity} />
                    </div>
                    <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-slate-600">{agent.purpose}</p>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Status</p>
                  <StatusBadge status={agent.status} />
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Probes</p>
                  <p className="mt-1 text-[12px] font-semibold text-slate-950">{agent.probes}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Confidence</p>
                  <p className="mt-1 text-[12px] font-semibold text-slate-950">{agent.confidence ? `${agent.confidence}%` : "Pending"}</p>
                </div>
                {expanded ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
              </button>

              {expanded && (
                <div className="border-t border-slate-200 bg-slate-50/60">
                  <PhaseStepperBar phases={agent.timeline} />
                  <div className="flex gap-1 border-b border-slate-200 px-4 pt-3">
                    {tabs.map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setTab(agent.id, tab)}
                        className={clsx(
                          "rounded-t border border-b-0 px-3 py-2 text-[12px] font-medium",
                          activeTab === tab
                            ? "border-slate-300 bg-white text-slate-950"
                            : "border-transparent text-slate-500 hover:text-slate-900"
                        )}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                  <div className="bg-white p-4">
                    <ExpandedTab agent={agent} tab={activeTab} />
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function ExpandedTab({ agent, tab }: { agent: IntelligenceAgent; tab: AgentTab }) {
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
        <div className="rounded border border-slate-200 bg-slate-50 p-4">
          <Timeline items={agent.timeline} />
        </div>
        <ActionRow />
      </div>
    );
  }

  if (tab === "Probes") {
    return (
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div>
          <SectionTitle icon={SearchCheck} title="Probe Methods" />
          <ChipGrid items={agent.methods} tone="blue" />
          <div className="mt-5 rounded border border-slate-200 bg-slate-50 p-4">
            <p className="text-[12px] font-semibold text-slate-950">Probe execution model</p>
            <p className="mt-2 text-[12px] leading-5 text-slate-600">
              The agent isolates governance variables, executes structured probes against the target model, and records evidence without exposing raw target output to the governance LLM.
            </p>
          </div>
        </div>
        <Timeline items={agent.timeline} />
      </div>
    );
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
            <span key={framework} className="rounded border border-slate-200 bg-transparent px-3 py-1.5 text-[12px] font-medium text-slate-600">
              {framework}
            </span>
          ))}
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 p-4 text-[12px] leading-5 text-slate-600">
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
          <div key={item} className="flex items-start gap-3 rounded border border-slate-200 bg-slate-50 p-3">
            <span className="flex h-5 w-5 items-center justify-center rounded bg-slate-900 text-[10px] font-semibold text-white">
              {index + 1}
            </span>
            <p className="text-[12px] text-slate-700">{item}</p>
          </div>
        ))}
      </div>
      <ActionRow />
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
              phase.status === "complete" ? "border-emerald-200 bg-emerald-50/50" :
              phase.status === "running" ? "border-blue-200 bg-blue-50/50" :
              "border-slate-200 bg-slate-50/50"
            )}>
              <div className="flex items-center gap-2 shrink-0">
                <span className="flex h-5 w-5 items-center justify-center rounded bg-slate-800 text-[10px] font-bold text-white">
                  {idx + 1}
                </span>
                {phase.status === "complete" && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
                {phase.status === "running" && <Loader2 className="h-3.5 w-3.5 text-blue-600 animate-spin" />}
                {phase.status === "waiting" && <div className="h-3.5 w-3.5 rounded-full border-2 border-slate-300" />}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-[12px] font-semibold text-slate-900">{phase.phase}</p>
                  {phase.duration && (
                    <span className="text-[10px] font-mono text-slate-400">{phase.duration}</span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-slate-600">{phase.detail}</p>
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
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 mb-2">Data Used</p>
          <div className="space-y-1.5">
            {detail.dataUsed.map((item) => (
              <div key={item} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-blue-400 shrink-0" />
                <span className="text-[11px] text-slate-700">{item}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 mb-2">Probes Run</p>
          <div className="space-y-1.5">
            {detail.probesRun.map((item) => (
              <div key={item} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                <span className="text-[11px] text-slate-700">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 mb-2">Metrics Calculated</p>
          <div className="space-y-1.5">
            {detail.metricsCalculated.map((item) => (
              <div key={item} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                <span className="text-[11px] font-mono text-slate-700">{item}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 mb-2">Evidence Produced</p>
          <div className="space-y-1.5">
            {detail.evidenceProduced.map((item) => (
              <div key={item} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-purple-400 shrink-0" />
                <span className="text-[11px] text-slate-700">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Confidence + Artifact */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded border border-slate-200 bg-slate-50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Confidence Impact</p>
          <p className="mt-1 text-[14px] font-semibold text-red-700">{detail.confidenceImpact}</p>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Artifact Emitted</p>
          <p className="mt-1 text-[12px] font-mono text-slate-800">{detail.artifactEmitted}</p>
        </div>
      </div>
    </div>
  );
}

function RuntimeDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-1.5 text-[12px] leading-5 text-slate-800">{value}</p>
    </div>
  );
}

// Compliance Mapper specific detail for credit-scoring system
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
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Credit-Scoring Compliance Detail</p>

      {sections.map(({ key, data }) => (
        <div key={key} className="rounded border border-slate-200 overflow-hidden">
          <button
            onClick={() => setExpandedSection(expandedSection === key ? null : key)}
            className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-slate-50"
          >
            <p className="text-[12px] font-semibold text-slate-900">{data.title}</p>
            {expandedSection === key ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
          </button>
          {expandedSection === key && (
            <div className="border-t border-slate-100 px-3 py-2.5">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="pb-2 text-left font-semibold text-slate-500">Clause</th>
                    <th className="pb-2 text-left font-semibold text-slate-500">Status</th>
                    <th className="pb-2 text-left font-semibold text-slate-500">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {data.checks.map((check) => (
                    <tr key={check.clause} className="border-b border-slate-50">
                      <td className="py-2 pr-3 font-medium text-slate-800">{check.clause}</td>
                      <td className="py-2 pr-3">
                        <span className={clsx(
                          "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                          check.status === "Pass" ? "bg-emerald-100 text-emerald-700" :
                          check.status === "Fail" ? "bg-red-100 text-red-700" :
                          "bg-amber-100 text-amber-700"
                        )}>
                          {check.status}
                        </span>
                      </td>
                      <td className="py-2 text-slate-600">{check.detail}</td>
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
        <div className="rounded border border-slate-200 bg-slate-50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Evidence-to-Control Correlation</p>
          <p className="mt-1.5 text-[18px] font-semibold text-slate-900">{d.evidenceToControlCorrelation}</p>
          <div className="mt-2 h-2 rounded bg-slate-200">
            <div className="h-full rounded bg-amber-500" style={{ width: `${d.evidenceToControlCorrelation * 100}%` }} />
          </div>
        </div>
        <div className="rounded border border-red-200 bg-red-50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-red-600">Missing Items</p>
          <div className="mt-1.5 space-y-1">
            {d.missingItems.map((item) => (
              <p key={item} className="text-[11px] text-red-800">• {item}</p>
            ))}
          </div>
        </div>
      </div>

      {/* Remediation requirements */}
      <div className="rounded border border-slate-200 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 mb-2">Remediation Requirements</p>
        {d.remediationRequirements.map((item, idx) => (
          <div key={item} className="flex items-start gap-2 py-1">
            <span className="flex h-4 w-4 items-center justify-center rounded bg-slate-800 text-[9px] font-bold text-white shrink-0">{idx + 1}</span>
            <p className="text-[11px] text-slate-700">{item}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// Drift Analyst specific detail for credit-scoring-v4.2
function DriftAnalystDetail() {
  const d = driftAnalystDetail;

  return (
    <div className="mt-4 space-y-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Drift Analysis — credit-scoring-v4.2 vs baseline</p>

      {/* Version comparison */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded border border-slate-200 bg-slate-50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Baseline Version</p>
          <p className="mt-1 text-[13px] font-mono font-semibold text-slate-900">{d.baselineVersion}</p>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Current Version</p>
          <p className="mt-1 text-[13px] font-mono font-semibold text-slate-900">{d.currentVersion}</p>
        </div>
        <div className={clsx(
          "rounded border p-3",
          d.thresholdComparison.score < d.thresholdComparison.threshold
            ? "border-red-200 bg-red-50"
            : "border-emerald-200 bg-emerald-50"
        )}>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Threshold Status</p>
          <p className={clsx("mt-1 text-[13px] font-semibold",
            d.thresholdComparison.score < d.thresholdComparison.threshold ? "text-red-700" : "text-emerald-700"
          )}>
            {d.thresholdComparison.score} / {d.thresholdComparison.threshold} — {d.thresholdComparison.status}
          </p>
        </div>
      </div>

      {/* Benchmark replay results */}
      <div className="rounded border border-slate-200 p-3">
        <div className="flex items-center gap-2 mb-3">
          <GitCompare className="h-4 w-4 text-slate-500" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Benchmark Replay Results ({d.benchmarkReplay.completed}/{d.benchmarkReplay.totalPrompts} complete)</p>
        </div>
        <div className="space-y-1.5">
          {d.benchmarkReplay.distribution.map((item) => (
            <div key={item.prompt} className="flex items-center gap-3">
              <p className="flex-1 text-[11px] text-slate-700 truncate">{item.prompt}</p>
              <div className="w-32 h-2 rounded bg-slate-200">
                <div
                  className={clsx("h-full rounded", item.similarity >= 0.80 ? "bg-emerald-500" : item.similarity >= 0.60 ? "bg-amber-500" : "bg-red-500")}
                  style={{ width: `${item.similarity * 100}%` }}
                />
              </div>
              <span className={clsx(
                "text-[11px] font-mono w-10 text-right",
                item.similarity >= 0.80 ? "text-emerald-700" : item.similarity >= 0.60 ? "text-amber-700" : "text-red-700"
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
      <div className="rounded border border-amber-200 bg-amber-50 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700">Explanation Drift (Consistency: {d.explanationDrift.consistencyScore})</p>
        <div className="mt-2 space-y-1">
          {d.explanationDrift.majorChanges.map((change) => (
            <p key={change} className="text-[11px] text-amber-800">• {change}</p>
          ))}
        </div>
      </div>

      {/* Production telemetry */}
      <div className="rounded border border-slate-200 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 mb-2">Production Telemetry ({d.productionTelemetry.period})</p>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-[10px] text-slate-500">Avg Latency</p>
            <p className="text-[11px] font-mono text-slate-800">{d.productionTelemetry.avgLatency.v40} → {d.productionTelemetry.avgLatency.v42}</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-500">Error Rate</p>
            <p className="text-[11px] font-mono text-slate-800">{d.productionTelemetry.errorRate.v40} → {d.productionTelemetry.errorRate.v42}</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-500">Override Rate</p>
            <p className="text-[11px] font-mono text-slate-800">{d.productionTelemetry.overrideRate.v40} → {d.productionTelemetry.overrideRate.v42}</p>
          </div>
        </div>
      </div>

      {/* Finding F-002 */}
      <div className="rounded border-l-4 border-l-orange-400 border border-orange-200 bg-orange-50 p-3">
        <p className="text-[11px] font-semibold text-orange-800">Finding F-002: {d.findingF002.title}</p>
        <p className="mt-1 text-[11px] leading-4.5 text-orange-700">{d.findingF002.detail}</p>
      </div>
    </div>
  );
}

function DriftMetric({ label, v40, v42, delta }: { label: string; v40: string; v42: string; delta: string }) {
  const isNegative = delta.startsWith("-");
  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="text-[11px] font-mono text-slate-500">{v40}</span>
        <span className="text-[10px] text-slate-400">→</span>
        <span className="text-[11px] font-mono text-slate-900">{v42}</span>
        <span className={clsx("text-[10px] font-semibold", isNegative ? "text-red-600" : "text-amber-600")}>({delta})</span>
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
    slate: "text-slate-300",
    red: "text-red-400",
    blue: "text-slate-300",
    green: "text-emerald-400",
  }[tone];

  return (
    <Card className="px-4 py-3 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">{label}</p>
        <Icon className={clsx("h-4 w-4 shrink-0", iconColor)} />
      </div>
      <p className="mt-1.5 text-3xl font-bold tracking-tight text-slate-900 tabular-nums">{value}</p>
    </Card>
  );
}

function MiniMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-1.5 text-[13px] font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function ChipGrid({ items, tone }: { items: string[]; tone: "slate" | "blue" | "amber" }) {
  const colors = {
    slate: "border-slate-200 bg-slate-50 text-slate-700",
    blue: "border-blue-200 bg-blue-50 text-blue-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
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
    <div className="rounded border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-semibold text-slate-950">Confidence impact</p>
        <p className={clsx("text-[12px] font-semibold", value < 0 ? "text-red-700" : "text-emerald-700")}>{value}%</p>
      </div>
      <div className="mt-3 h-2 rounded bg-slate-200">
        <div className={clsx("h-full rounded", value < 0 ? "bg-red-600" : "bg-emerald-600")} style={{ width: `${(magnitude / 20) * 100}%` }} />
      </div>
      <p className="mt-2 text-[11px] text-slate-500">Applied as a deduction during council confidence scoring.</p>
    </div>
  );
}

function Timeline({ items }: { items: IntelligenceAgent["timeline"] }) {
  return (
    <div>
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Status Timeline</p>
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.label} className="flex gap-3">
            <div className={clsx("mt-1 h-2.5 w-2.5 rounded-full", item.status === "complete" ? "bg-emerald-600" : item.status === "running" ? "bg-blue-700" : "bg-slate-300")} />
            <div>
              <p className="text-[12px] font-semibold text-slate-950">{item.label}</p>
              <p className="mt-0.5 text-[11px] text-slate-600">{item.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionTitle({ icon: Icon, title }: { icon: React.ComponentType<{ className?: string }>; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon className="h-4 w-4 text-slate-500" />
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{title}</p>
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
              phase.status === "complete" ? "text-emerald-700" :
              phase.status === "running" ? "text-brand-700" :
              "text-slate-400"
            )}>
              {phase.label}
            </p>
          </div>
          {idx < phases.length - 1 && (
            <div className={clsx(
              "mx-1 h-0.5 flex-1",
              phase.status === "complete" ? "bg-emerald-300" :
              phase.status === "running" ? "bg-brand-300" :
              "bg-slate-200"
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
        className="inline-flex items-center gap-2 rounded border border-slate-300 bg-white px-3 py-2 text-[12px] font-medium text-slate-900 hover:bg-slate-50"
      >
        <FileText className="h-4 w-4" />
        View Council Deliberation
      </button>
      <button
        onClick={() => navigateTo("/verdicts")}
        title="Jump to the Verdicts page to see the final governance outcome and risk tier"
        className="inline-flex items-center gap-2 rounded bg-[#111827] px-3 py-2 text-[12px] font-semibold text-white hover:bg-slate-800"
      >
        <ExternalLink className="h-4 w-4" />
        View Verdict
      </button>
    </div>
  );
}
