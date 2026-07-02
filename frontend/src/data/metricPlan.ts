// Metric Plan mock data — the orchestrator-selected metric plan for a run.
// Mirrors /evaluation-runs/{id}/metric-plan from API_CONTRACTS.md (mock-only).

// The backend exposes a rich, evolving dimension taxonomy (fairness, groundedness,
// privacy, security, robustness, safety, transparency, oversight, retrieval,
// task fulfilment, …) alongside the original five. We keep the well-known values
// as hints but accept any string so a live plan never collapses every metric into
// a single "Compliance" bucket. Use `toneForDimension` to colour an arbitrary one.
export type MetricDimension =
  | "Bias"
  | "Drift"
  | "Misuse"
  | "Compliance"
  | "Explainability"
  | (string & {});
export type MetricStatus = "Planned" | "Running" | "Pass" | "Fail" | "Skipped";
export type RunMode = "mock" | "live";

export type PlannedMetric = {
  id: string;
  name: string;
  dimension: MetricDimension;
  description: string;
  tool: string;
  toolMode: RunMode;
  ownerAgent: string;
  frameworks: string[];
  probeBudget: number;
  threshold: string;
  status: MetricStatus;
};

export type MetricPlan = {
  runId: string;
  systemName: string;
  systemVersion: string;
  riskTier: "High" | "Medium" | "Low";
  runMode: RunMode;
  selectedFrameworks: string[];
  createdAt: string;
  metrics: PlannedMetric[];
};

export const metricPlan: MetricPlan = {
  runId: "run-techvest-chatbot-demo",
  systemName: "TechVest RAG Chatbot",
  systemVersion: "v1",
  riskTier: "Medium",
  runMode: "mock",
  selectedFrameworks: ["NIST AI RMF", "OWASP LLM Top 10", "ISO 42001"],
  createdAt: "2026-05-31T09:14:48Z",
  metrics: [
    {
      id: "BIAS-001",
      name: "Response consistency across user cohorts",
      dimension: "Bias",
      description: "Controlled prompt probing across user cohorts to measure response consistency and tone disparity.",
      tool: "LangFair",
      toolMode: "mock",
      ownerAgent: "Bias Auditor",
      frameworks: ["EU AI Act Art.10(2)(f)", "SR 11-7 §4.1"],
      probeBudget: 26,
      threshold: "disparate impact ≥ 0.80",
      status: "Fail",
    },
    {
      id: "BIAS-002",
      name: "Counterfactual fairness",
      dimension: "Bias",
      description: "Swap protected attributes on identical profiles and measure decision deltas.",
      tool: "LangFair",
      toolMode: "mock",
      ownerAgent: "Bias Auditor",
      frameworks: ["EU AI Act Art.10(2)(f)"],
      probeBudget: 24,
      threshold: "delta ≤ 5%",
      status: "Running",
    },
    {
      id: "DRIFT-001",
      name: "Semantic similarity vs baseline",
      dimension: "Drift",
      description: "Embedding-based similarity of chatbot responses against the approved knowledge baseline.",
      tool: "Evidently",
      toolMode: "mock",
      ownerAgent: "Drift Analyst",
      frameworks: ["NIST AI RMF Measure 2.5", "ISO 42001 §9.1"],
      probeBudget: 20,
      threshold: "mean similarity ≥ 0.80",
      status: "Fail",
    },
    {
      id: "MIS-001",
      name: "Prompt injection resistance",
      dimension: "Misuse",
      description: "OWASP LLM Top 10 and MITRE ATLAS adversarial probes for boundary holding.",
      tool: "Garak",
      toolMode: "mock",
      ownerAgent: "Misuse Detector",
      frameworks: ["OWASP LLM Top 10", "EU AI Act Art.15"],
      probeBudget: 15,
      threshold: "boundary hold rate = 100%",
      status: "Pass",
    },
    {
      id: "CMP-001",
      name: "Governance documentation completeness",
      dimension: "Compliance",
      description: "Clause-level mapping of chatbot documentation against selected governance frameworks.",
      tool: "Promptfoo",
      toolMode: "mock",
      ownerAgent: "Compliance Mapper",
      frameworks: ["EU AI Act Annex IV", "SR 11-7"],
      probeBudget: 12,
      threshold: "completeness ≥ 90%",
      status: "Fail",
    },
    {
      id: "EXP-001",
      name: "Explanation faithfulness",
      dimension: "Explainability",
      description: "Compares model explanations to SHAP baseline attribution for faithfulness.",
      tool: "DeepEval",
      toolMode: "mock",
      ownerAgent: "Explainability Agent",
      frameworks: ["EU AI Act Art.13", "NIST AI RMF"],
      probeBudget: 20,
      threshold: "faithfulness ≥ 0.80",
      status: "Running",
    },
  ],
};

export type DimensionTone = "blue" | "amber" | "red" | "green" | "violet" | "slate";

export const dimensionTone: Record<string, DimensionTone> = {
  Bias: "red",
  Drift: "amber",
  Misuse: "violet",
  Compliance: "blue",
  Explainability: "green",
};

// Map any backend dimension (folder-style "task_fulfilment" or display-style
// "Bias and Fairness") to a stable, semantically meaningful tone. Keyword-based
// so new dimensions colour sensibly without a code change; unknown → slate.
const DIMENSION_TONE_RULES: Array<[RegExp, DimensionTone]> = [
  [/bias|fair/i, "red"],
  [/drift|robust|stabil/i, "amber"],
  [/misuse|secur|safety|attack|inject|adversar/i, "violet"],
  [/privac|complian|govern|transparen|oversight|risk|control/i, "blue"],
  [/explain|ground|retriev|quality|task|fulfil|accura/i, "green"],
];

export function toneForDimension(dimension: string): DimensionTone {
  if (dimensionTone[dimension]) return dimensionTone[dimension];
  for (const [pattern, tone] of DIMENSION_TONE_RULES) {
    if (pattern.test(dimension)) return tone;
  }
  return "slate";
}
