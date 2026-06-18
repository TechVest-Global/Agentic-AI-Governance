// Metric Plan mock data — the orchestrator-selected metric plan for a run.
// Mirrors /evaluation-runs/{id}/metric-plan from API_CONTRACTS.md (mock-only).

export type MetricDimension = "Bias" | "Drift" | "Misuse" | "Compliance" | "Explainability";
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
  runId: "run-2026-0531-credit",
  systemName: "credit-scoring-v4.2",
  systemVersion: "v4.2",
  riskTier: "High",
  runMode: "mock",
  selectedFrameworks: ["EU AI Act", "SR 11-7", "NIST AI RMF", "OECD AI Principles"],
  createdAt: "2026-05-31T09:14:48Z",
  metrics: [
    {
      id: "BIAS-001",
      name: "Demographic parity (age cohorts)",
      dimension: "Bias",
      description: "Controlled-pair probing across age cohorts to measure approval-language disparity.",
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
      description: "Embedding-based similarity of v4.2 responses against the validated v4.0 baseline.",
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
      name: "Annex IV technical file completeness",
      dimension: "Compliance",
      description: "Clause-level mapping of the technical documentation against EU AI Act Annex IV.",
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

export const dimensionTone: Record<MetricDimension, "blue" | "amber" | "red" | "green" | "violet"> = {
  Bias: "red",
  Drift: "amber",
  Misuse: "violet",
  Compliance: "blue",
  Explainability: "green",
};
