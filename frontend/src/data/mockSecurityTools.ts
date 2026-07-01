// Security tool adapters — mock data. No backend endpoint exists yet; these
// are surfaced as adapter interfaces so the UI is ready to wire to real
// execution (Azure Container Apps / optional requirements-security.txt) later.

export type AdapterExecutionMode = "mock" | "real";

export type SecurityToolResult = {
  ranAt: string;
  mode: AdapterExecutionMode;
  status: "passed" | "failed" | "warnings" | "error";
  summary: string;
  findingsCreated: number;
  warningCount?: number;
};

export type SecurityToolAdapter = {
  id: string;
  toolName: string;
  purpose: string;
  installed: boolean;
  dependencyGroup: string;
  localMode: boolean;
  executionMode: AdapterExecutionMode;
  azureReady: boolean;
  relatedMetrics: string[];
  relatedFindingTypes: string[];
  lastResult: SecurityToolResult | null;
};

export const securityToolAdapters: SecurityToolAdapter[] = [
  {
    id: "custom_boundary",
    toolName: "Custom Boundary Test Adapter",
    purpose: "Validates the Target/Governance client boundary — sanitization, fencing, and permission enforcement on untrusted target output.",
    installed: true,
    dependencyGroup: "core",
    localMode: true,
    executionMode: "mock",
    azureReady: true,
    relatedMetrics: ["CM-035", "CM-036"],
    relatedFindingTypes: ["prompt_injection", "boundary_violation"],
    lastResult: {
      ranAt: "2026-06-30T02:08:00Z",
      mode: "mock",
      status: "passed",
      summary: "All 12 boundary probes fenced correctly; 0 sanitization escapes.",
      findingsCreated: 0,
      warningCount: 0,
    },
  },
  {
    id: "garak",
    toolName: "garak",
    purpose: "Broad LLM vulnerability scanning — probes for jailbreaks, prompt injection, toxicity, and data leakage across many attack families.",
    installed: false,
    dependencyGroup: "requirements-security.txt",
    localMode: false,
    executionMode: "mock",
    azureReady: true,
    relatedMetrics: ["CM-022", "CM-023"],
    relatedFindingTypes: ["jailbreak", "data_leakage"],
    lastResult: null,
  },
  {
    id: "pyrit",
    toolName: "PyRIT",
    purpose: "Custom adversarial red-team campaigns — orchestrated multi-turn attacks against the target system.",
    installed: false,
    dependencyGroup: "requirements-security.txt",
    localMode: false,
    executionMode: "mock",
    azureReady: true,
    relatedMetrics: ["CM-024"],
    relatedFindingTypes: ["adversarial_failure"],
    lastResult: null,
  },
  {
    id: "inspect_ai",
    toolName: "Inspect AI",
    purpose: "Multi-step autonomous agent / tool-use evaluation — tests planning, tool selection, and side-effect safety.",
    installed: false,
    dependencyGroup: "requirements-security.txt",
    localMode: false,
    executionMode: "mock",
    azureReady: true,
    relatedMetrics: ["CM-013", "CM-014"],
    relatedFindingTypes: ["unsafe_action"],
    lastResult: null,
  },
  {
    id: "cyberseceval",
    toolName: "CyberSecEval",
    purpose: "Optional/domain-specific — evaluates coding/cybersecurity AI systems for insecure code generation and exploit assistance.",
    installed: false,
    dependencyGroup: "requirements-security.txt (optional)",
    localMode: false,
    executionMode: "mock",
    azureReady: false,
    relatedMetrics: [],
    relatedFindingTypes: ["insecure_code"],
    lastResult: null,
  },
  {
    id: "prompt_injection_scanner",
    toolName: "Prompt Injection Scanner",
    purpose: "Validates the client boundary and permission model against direct and indirect prompt-injection payloads.",
    installed: true,
    dependencyGroup: "core",
    localMode: true,
    executionMode: "mock",
    azureReady: true,
    relatedMetrics: ["CM-035"],
    relatedFindingTypes: ["prompt_injection"],
    lastResult: {
      ranAt: "2026-06-30T02:07:00Z",
      mode: "mock",
      status: "warnings",
      summary: "1 indirect-injection payload reached the model before fencing; flagged for review.",
      findingsCreated: 1,
      warningCount: 1,
    },
  },
  {
    id: "tracing",
    toolName: "Tracing (Langfuse / custom)",
    purpose: "Records model calls, tool calls, trace IDs, evidence IDs, latency, and the full execution path for every run.",
    installed: true,
    dependencyGroup: "core",
    localMode: true,
    executionMode: "real",
    azureReady: true,
    relatedMetrics: [],
    relatedFindingTypes: [],
    lastResult: {
      ranAt: "2026-06-30T02:09:11Z",
      mode: "real",
      status: "passed",
      summary: "12 governance LLM calls traced; all linked to evidence IDs.",
      findingsCreated: 0,
    },
  },
  {
    id: "policy_tests",
    toolName: "Policy Tests",
    purpose: "Deterministic policy/permission tests — assert capabilities respect side-effect levels and human-review requirements.",
    installed: true,
    dependencyGroup: "core",
    localMode: true,
    executionMode: "mock",
    azureReady: true,
    relatedMetrics: ["CM-009", "CM-010"],
    relatedFindingTypes: ["policy_violation"],
    lastResult: {
      ranAt: "2026-06-30T02:06:00Z",
      mode: "mock",
      status: "passed",
      summary: "All capability permission assertions held.",
      findingsCreated: 0,
    },
  },
];
