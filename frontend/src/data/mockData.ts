import {
  Activity,
  AlertTriangle,
  BookOpen,
  Boxes,
  Bug,
  ClipboardList,
  Database,
  FileSearch,
  FileText,
  Gauge,
  GitBranch,
  Layers,
  LayoutDashboard,
  ListChecks,
  Network,
  Scale,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Split,
  Terminal,
} from "lucide-react";
import type { AgentStatus, AiSystem, AuditEvent, Finding, GovernanceRun, NavigationItem } from "@/types";

export const navigation: NavigationItem[] = [
  // ── Govern ────────────────────────────────────────────────────────────
  { id: "dashboard", label: "Dashboard", section: "Govern", path: "/dashboard", icon: LayoutDashboard, personas: ["auditor", "developer"] },
  { id: "systems", label: "AI Systems", section: "Govern", path: "/systems", icon: ShieldCheck, personas: ["auditor", "developer"] },
  { id: "runs", label: "Live Run", section: "Govern", path: "/runs", icon: Activity, personas: ["auditor", "developer"] },
  { id: "eval-runs", label: "Run History", section: "Govern", path: "/eval-runs", icon: ListChecks, personas: ["auditor", "developer"] },
  // Developer-only engine explainer. Not in the main sidebar (hidden); the only
  // entry point is the "How the engine works" footer button, which is likewise
  // shown only to developers so it never dead-redirects an auditor.
  { id: "engine", label: "How It Works", section: "Govern", path: "/engine", icon: Layers, personas: ["developer"], hidden: true },
  { id: "metric-plan", label: "Metric Plan", section: "Govern", path: "/metric-plan", icon: ClipboardList, personas: ["developer"] },
  { id: "council", label: "Council Deliberation", section: "Govern", path: "/council", icon: Scale, personas: ["developer"], hidden: true },
  // ── Assurance ─────────────────────────────────────────────────────────
  { id: "findings", label: "Findings", section: "Assurance", path: "/findings", icon: AlertTriangle, personas: ["auditor", "developer"] },
  { id: "metric-results", label: "Metric Results", section: "Assurance", path: "/metric-results", icon: Gauge, personas: ["auditor", "developer"] },
  { id: "verdicts", label: "Verdicts", section: "Assurance", path: "/verdicts", icon: GitBranch, personas: ["auditor", "developer"] },
  { id: "reports", label: "Compliance Reports", section: "Assurance", path: "/reports", icon: FileText, personas: ["auditor", "developer"] },
  { id: "evidence", label: "Evidence", section: "Assurance", path: "/evidence", icon: FileSearch, personas: ["auditor", "developer"] },
  { id: "ledger", label: "Audit Ledger", section: "Assurance", path: "/ledger", icon: BookOpen, personas: ["auditor", "developer"] },
  // ── Configure (developer only) ────────────────────────────────────────
  { id: "system-setup", label: "AI System Setup", section: "Configure", path: "/system-setup", icon: Settings, personas: ["developer"] },
  { id: "context-profiles", label: "Context Profiles", section: "Configure", path: "/context-profiles", icon: Layers, personas: ["developer"] },
  { id: "capabilities", label: "Capabilities", section: "Configure", path: "/capabilities", icon: Boxes, personas: ["developer"] },
  { id: "metrics-config", label: "Metrics Configuration", section: "Configure", path: "/metrics-config", icon: SlidersHorizontal, personas: ["developer"] },
  { id: "framework-mapping", label: "Framework Mapping", section: "Configure", path: "/framework-mapping", icon: Network, personas: ["developer"] },
  { id: "llm-boundary", label: "LLM Client Boundary", section: "Configure", path: "/llm-boundary", icon: Split, personas: ["developer"] },
  { id: "security-tools", label: "Security Tools", section: "Configure", path: "/security-tools", icon: Bug, personas: ["developer"] },
  // ── Operate (developer only) ──────────────────────────────────────────
  { id: "governance-state", label: "Governance State", section: "Operate", path: "/governance-state", icon: Database, personas: ["developer"] },
  { id: "api-debug", label: "API Debug", section: "Operate", path: "/api-debug", icon: Terminal, personas: ["developer"] },
];

export type AcpSection = {
  letter: string;
  title: string;
  owner: string;
  fields: [string, string][];
};

export type ApplicationContextProfile = {
  systemId: string;
  version: string;
  frameworks: { name: string; desc: string; active: boolean }[];
  sections: AcpSection[];
};

export const applicationContextProfiles: ApplicationContextProfile[] = [
  {
    systemId: "sys-techvest-chatbot",
    version: "v1.0",
    frameworks: [
      { name: "NIST AI RMF", desc: "Govern, Map, Measure, Manage", active: true },
      { name: "OWASP LLM Top 10", desc: "LLM security risks", active: true },
      { name: "ISO 42001", desc: "AI management system", active: true },
      { name: "EU AI Act", desc: "Art.10, Art.52, Annex IV", active: false },
      { name: "SR 11-7", desc: "Model risk management", active: false },
    ],
    sections: [
      {
        letter: "A",
        title: "Application Identity & Purpose",
        owner: "→ Orchestrator, Compliance Mapper",
        fields: [
          ["Application", "TechVest RAG Chatbot v1"],
          ["Business domain", "Customer Operations"],
          ["Primary use case", "AI-assisted customer service Q&A"],
          ["Decision impact", "Advisory — human agent reviews before acting"],
          ["End users", "Internal customer service agents"],
          ["Deployment scale", "Internal pilot — ~40 daily users, Staging"],
        ],
      },
      {
        letter: "B",
        title: "Pre-Model Business Rules",
        owner: "→ Bias Auditor, Misuse Detector, Drift Analyst",
        fields: [
          ["Input validation", "Strip PII from user query before model call"],
          ["PII handling", "Name + account numbers tokenised"],
          ["Prompt construction", "System prompt + Azure AI Search context chunks"],
          ["Context injection", "RAG: top-5 retrieved passages from knowledge base"],
          ["Routing", "Low-confidence answers → human escalation queue"],
          ["Guardrails", "Content safety filter (Azure AI) pre-model"],
        ],
      },
      {
        letter: "C",
        title: "Model Configuration",
        owner: "→ All probing agents",
        fields: [
          ["Provider", "Azure AI Foundry (OpenAI)"],
          ["Model", "gpt-4.1-mini"],
          ["Temperature", "0.3 (slight variability for natural responses)"],
          ["System prompt", "Customer service assistant — TechVest Financial"],
          ["Max tokens", "512"],
          ["Endpoint", "http://localhost:8000/api/chat"],
        ],
      },
      {
        letter: "D",
        title: "Post-Model Business Rules",
        owner: "→ Bias Auditor, Misuse Detector, Explainability Agent",
        fields: [
          ["Output filters", "Toxicity · PII · brand-safety (Azure Content Safety)"],
          ["Confidence threshold", "< 0.5 → append disclaimer + escalate"],
          ["Response transform", "None — raw model output passed to agent"],
          ["HITL triggers", "Flagged topics → mandatory human review"],
          ["Caching", "None — every query hits the model"],
          ["Audit logging", "All inputs + outputs logged to Azure Monitor"],
        ],
      },
      {
        letter: "E",
        title: "Integration Context",
        owner: "→ Risk Scorer",
        fields: [
          ["Upstream", "Azure AI Search (knowledge base) · Customer CRM"],
          ["Downstream", "Agent chat interface (internal portal)"],
          ["Audit systems", "Azure Monitor + GovernAI ledger"],
          ["Rollback", "Feature-flag disable — instant, no migration needed"],
          ["Blast radius", "Low — advisory only, no automated actions"],
          ["Data residency", "EU region (Azure West Europe)"],
        ],
      },
    ],
  },
];

export const systems: AiSystem[] = [
  {
    id: "sys-techvest-chatbot",
    name: "TechVest RAG Chatbot",
    version: "v1",
    users: "Internal pilot",
    applicationType: "RAG Chatbot",
    domain: "Customer Operations",
    environment: "Staging",
    riskTier: "Medium",
    owner: "TechVest Global",
    lastRun: "No run yet",
    verdict: "Medium",
    confidence: 0,
    nextReview: "Not scheduled",
    status: "Active",
  },
];

export const liveRuns: GovernanceRun[] = [
  {
    id: "run-techvest-chatbot-demo",
    system: "TechVest RAG Chatbot",
    framework: "NIST AI RMF + OWASP LLM Top 10 + ISO 42001",
    status: "Waiting",
    progress: 0,
    startedAt: "Awaiting first backend run",
    probes: 0,
    findings: 0,
  },
];

export const agents: AgentStatus[] = [
  { name: "Bias Auditor", role: "Protected attribute parity", status: "Running", progress: 48, probes: 24, findings: 1, confidence: 84 },
  { name: "Drift Analyst", role: "Baseline divergence", status: "Running", progress: 85, probes: 17, findings: 1, confidence: 78 },
  { name: "Misuse Detector", role: "Jailbreak and boundary tests", status: "Complete", progress: 100, probes: 15, findings: 0, confidence: 92 },
  { name: "Compliance Mapper", role: "Clause-level mapping", status: "Running", progress: 71, probes: 12, findings: 1, confidence: 73 },
  { name: "Explainability Agent", role: "Reasoning fidelity", status: "Running", progress: 35, probes: 7, findings: 0, confidence: 64 },
];

export const councilMembers: AgentStatus[] = [
  { name: "Risk Scorer", role: "Composite adjudication", status: "Waiting", progress: 0, probes: 0, findings: 0, confidence: 0 },
  { name: "Synthesis Agent", role: "Cross-agent pattern synthesis", status: "Waiting", progress: 0, probes: 0, findings: 0, confidence: 0 },
  { name: "Devil's Advocate", role: "Challenge weak evidence", status: "Waiting", progress: 0, probes: 0, findings: 0, confidence: 0 },
  { name: "Verdict Agent", role: "Confidence scoring & tier routing", status: "Waiting", progress: 0, probes: 0, findings: 0, confidence: 0 },
];

export const findings: Finding[] = [
  {
    id: "f-demo-001",
    agent: "Misuse Detector",
    title: "Prompt-injection boundary checks pending",
    severity: "Medium",
    framework: "OWASP LLM Top 10 / NIST AI RMF",
    evidence: "The TechVest chatbot target is registered, but adversarial prompt tests have not been executed yet.",
    confidence: 0,
  },
  {
    id: "f-demo-002",
    agent: "Compliance Mapper",
    title: "Application context profile needs completion",
    severity: "Low",
    framework: "ISO 42001 / NIST AI RMF Govern",
    evidence: "Owner, model provider, endpoint, and first capability can be registered from the portal before the first governance run.",
    confidence: 0,
  },
];

export const auditEvents: AuditEvent[] = [
  {
    id: "evt-001",
    timestamp: "04:31",
    actor: "Bias Auditor",
    type: "agent-finding",
    description: "Probe pair #24 compared 65+ vs 25-34 cohorts and flagged a 34% disparity.",
    hash: "c1d8e3f6a9b2",
    parentHash: "b7e4f9a2c5d1",
  },
  {
    id: "evt-002",
    timestamp: "04:28",
    actor: "Compliance Mapper",
    type: "framework-check",
    description: "EU AI Act Annex IV section 3.2 failed due to missing technical documentation.",
    hash: "e9f3a6b8d2c1",
    parentHash: "c1d8e3f6a9b2",
  },
  {
    id: "evt-003",
    timestamp: "04:25",
    actor: "Drift Analyst",
    type: "drift-check",
    description: "Semantic similarity against baseline reached 0.61, below the 0.80 threshold.",
    hash: "f2c7d4e1a8b5",
    parentHash: "e9f3a6b8d2c1",
  },
  {
    id: "evt-004",
    timestamp: "04:14",
    actor: "Orchestrator",
    type: "plan-update",
    description: "Reallocated 10% additional probe budget to Bias Auditor after coverage gap analysis.",
    hash: "a8b1c5d9e3f7",
    parentHash: "f2c7d4e1a8b5",
  },
];

export const complianceRows = [
  { clause: "Art.52 Transparency", status: "Pass", evidence: "Disclosure present in 15/15 sampled responses." },
  { clause: "Annex III Risk Classification", status: "Pass", evidence: "Correctly classified as high risk." },
  { clause: "Art.10(2)(f) Data Governance", status: "Fail", evidence: "Age cohort 65+ underrepresented; disparity detected." },
  { clause: "Annex IV 3.2 Technical Docs", status: "Fail", evidence: "Training data description missing." },
  { clause: "Art.26 Deployer Obligations", status: "Partial", evidence: "Monitoring exists but cadence is insufficient." },
];

export const oecdRows = [
  {
    clause: "P1.1 Stakeholder benefit assessment",
    status: "Aligned",
    evidence: "Stakeholder benefit analysis exists for chatbot users, chatbot operations, and affected customer groups.",
    principle: "Inclusive growth, sustainable development, and well-being",
  },
  {
    clause: "P1.2 Worker impact consideration",
    status: "Partially aligned",
    evidence: "Operational staffing impacts are documented, but skill transition planning is not complete.",
    principle: "Inclusive growth, sustainable development, and well-being",
  },
  {
    clause: "P1.3 Environmental sustainability",
    status: "Partially aligned",
    evidence: "Inference energy estimates are tracked. Carbon impact and mitigation measures are not yet reviewed.",
    principle: "Inclusive growth, sustainable development, and well-being",
  },
  {
    clause: "P2.2 Non-discrimination and fairness",
    status: "Not aligned",
    evidence: "Controlled probe pairs show materially more negative recommendations for applicants aged 65+.",
    principle: "Human-centred values and fairness",
  },
  {
    clause: "P2.3 Human oversight mechanisms",
    status: "Partially aligned",
    evidence: "Override route exists for supervised decisions, but escalation procedure testing is incomplete.",
    principle: "Human-centred values and fairness",
  },
  {
    clause: "P2.4 Redress and recourse",
    status: "Partially aligned",
    evidence: "Complaint workflow exists. Customer appeal evidence is not consistently linked to model decisions.",
    principle: "Human-centred values and fairness",
  },
  {
    clause: "P3.1 AI system disclosure",
    status: "Aligned",
    evidence: "User-facing disclosure appears in sampled decision communications and agent responses.",
    principle: "Transparency and explainability",
  },
  {
    clause: "P3.2 Explainability of decisions",
    status: "Partially aligned",
    evidence: "Explanations are available, but debt-ratio factors are underexplained in early probes.",
    principle: "Transparency and explainability",
  },
  {
    clause: "P3.4 Auditability",
    status: "Aligned",
    evidence: "Hash-linked audit trail captures probes, findings, review actions, and parent hashes.",
    principle: "Transparency and explainability",
  },
  {
    clause: "P4.5 Ongoing monitoring and maintenance",
    status: "Partially aligned",
    evidence: "Governance runs and drift checks are active. Monitoring cadence is below the required threshold.",
    principle: "Robustness, security, and safety",
  },
  {
    clause: "P4.6 Adversarial robustness",
    status: "Aligned",
    evidence: "Prompt injection and boundary probes held across the current misuse detector run.",
    principle: "Robustness, security, and safety",
  },
  {
    clause: "P5.1 Governance mechanisms",
    status: "Aligned",
    evidence: "Named owner, risk tier, committee path, and governance run history are present.",
    principle: "Accountability",
  },
  {
    clause: "P5.2 Decision accountability mapping",
    status: "Partially aligned",
    evidence: "Accountable team is assigned. Consequential decision authority matrix needs role-level sign-off.",
    principle: "Accountability",
  },
  {
    clause: "P5.6 Supply chain accountability",
    status: "Partially aligned",
    evidence: "Provider and model version are registered. Vendor accountability evidence is incomplete.",
    principle: "Accountability",
  },
];

export const riskSeries = [
  { name: "Bias", score: 68 },
  { name: "Compliance", score: 54 },
  { name: "Drift", score: 72 },
  { name: "Explainability", score: 21 },
  { name: "Misuse", score: 8 },
];
