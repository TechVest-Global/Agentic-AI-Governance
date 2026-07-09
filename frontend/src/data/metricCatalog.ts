/**
 * Human-readable descriptions for governance metrics (CM-001 … CM-044).
 *
 * The backend stores a good `name` per metric but its `description` field is a
 * generic placeholder ("Governance metric loaded from a validated YAML …"), so
 * the UI can't surface anything meaningful from it. This curated catalog gives
 * each metric a one-line explanation of what it measures, keyed by metric_id.
 *
 * Anything not in the map falls back to a humanized name (see `metricBlurb`), so
 * newly added metrics still render sensibly without a code change.
 */

export const METRIC_DESCRIPTIONS: Record<string, string> = {
  // Task fulfilment
  "CM-001": "Share of requests the system completes successfully end-to-end.",
  "CM-002": "How reliably the system obeys explicit instructions in the prompt.",
  "CM-003": "Whether structured outputs match the required schema/format.",
  "CM-004": "For action-taking agents, the fraction of tasks carried through to completion.",
  // Groundedness
  "CM-005": "Rate at which the system states facts unsupported by its sources (hallucination).",
  "CM-006": "How faithfully answers stay grounded in the retrieved/source material.",
  "CM-007": "Share of claims that carry a supporting citation.",
  "CM-008": "Rate of claims made with no supporting evidence at all.",
  // Retrieval
  "CM-009": "Whether the relevant documents are actually retrieved (recall@k).",
  "CM-010": "How much of what's retrieved is actually relevant (precision).",
  "CM-011": "How relevant the final answer is to the user's question.",
  "CM-012": "Fidelity of retrieved assets to the underlying source of truth.",
  // Safety
  "CM-013": "Rate of outputs that violate content/usage policy.",
  "CM-014": "Presence of toxic, harmful, or abusive language in outputs.",
  "CM-015": "Balance of correctly refusing unsafe requests vs. over-refusing safe ones (F1).",
  "CM-016": "Share of unsafe requests the system completes instead of refusing.",
  // Fairness
  "CM-017": "Whether failure/error rates differ across demographic groups.",
  "CM-018": "Whether output toxicity differs by the demographic referenced.",
  "CM-019": "Whether output sentiment skews by demographic group.",
  "CM-020": "Rate of outputs that misrepresent or demean a group.",
  "CM-021": "Rate at which outputs rely on group stereotypes.",
  // Privacy
  "CM-022": "Rate at which personal data (PII) leaks into outputs.",
  "CM-023": "Rate at which secrets/credentials leak into outputs.",
  "CM-024": "Whether the model regurgitates memorized training data on demand.",
  "CM-025": "Rate at which redaction fails to remove sensitive content.",
  // Security
  "CM-026": "Success rate of jailbreak attempts that bypass safety guardrails.",
  "CM-027": "Success rate of prompt-injection attacks against the system.",
  "CM-028": "Success rate of attempts to exfiltrate data through the model.",
  "CM-029": "Rate of unsafe or unauthorized tool/function calls.",
  // Robustness
  "CM-030": "Performance drop when inputs are perturbed or paraphrased.",
  "CM-031": "Whether the system gives consistent answers to equivalent inputs.",
  "CM-032": "Drift in persona/identity or style across a conversation.",
  "CM-033": "Consistency of answers to the same question over time.",
  "CM-034": "Robustness of speech recognition to noise/accents (ASR).",
  // Transparency
  "CM-035": "Whether cited sources actually support the stated claim.",
  "CM-036": "How well stated confidence matches actual correctness (calibration).",
  "CM-037": "Rate at which the origin/provenance of content is detectable.",
  "CM-038": "How useful and faithful the system's explanations are.",
  "CM-039": "Completeness of the decision/audit trace the system emits.",
  // Oversight
  "CM-040": "Balance of correctly escalating cases that need a human (F1).",
  "CM-041": "How often humans override the system's decisions.",
  "CM-042": "Rate of refusing requests that were actually safe (false refusal).",
  "CM-043": "How well expressed uncertainty tracks real risk (calibration).",
  "CM-044": "Share of cases correctly routed into the human review queue.",
};

/** Display names per metric_id (matches the backend metric catalog). */
export const METRIC_NAMES: Record<string, string> = {
  "CM-001": "Task Success Rate",
  "CM-002": "Instruction Following Pass Rate",
  "CM-003": "Schema Format Adherence Rate",
  "CM-004": "Action Completion Rate",
  "CM-005": "Hallucination Rate",
  "CM-006": "Faithfulness Score",
  "CM-007": "Citation Coverage Rate",
  "CM-008": "Unsupported Claim Rate",
  "CM-009": "Context Recall@K",
  "CM-010": "Context Precision",
  "CM-011": "Answer Relevancy",
  "CM-012": "Retrieved Asset Fidelity",
  "CM-013": "Policy Violation Rate",
  "CM-014": "Toxicity Score",
  "CM-015": "Refusal F1 Score",
  "CM-016": "Unsafe Completion Rate",
  "CM-017": "Disparate Failure Rate",
  "CM-018": "Toxicity Disparity",
  "CM-019": "Sentiment Disparity",
  "CM-020": "Representational Harm Rate",
  "CM-021": "Stereotyping Rate",
  "CM-022": "PII Leakage Rate",
  "CM-023": "Secret Leakage Rate",
  "CM-024": "Memorization Extraction Rate",
  "CM-025": "Redaction Failure Rate",
  "CM-026": "Jailbreak Success Rate",
  "CM-027": "Prompt Injection Success Rate",
  "CM-028": "Data Exfiltration Success Rate",
  "CM-029": "Unsafe Tool Call Rate",
  "CM-030": "Regression Rate Under Perturbation",
  "CM-031": "Consistency Score",
  "CM-032": "Identity/Style Drift",
  "CM-033": "Temporal Consistency",
  "CM-034": "ASR Robustness",
  "CM-035": "Citation Correctness",
  "CM-036": "Confidence Calibration",
  "CM-037": "Provenance Detection Rate",
  "CM-038": "Explanation Usefulness",
  "CM-039": "Trace Completeness",
  "CM-040": "Escalation F1 Score",
  "CM-041": "Human Override Rate",
  "CM-042": "False Refusal Rate",
  "CM-043": "Uncertainty Calibration",
  "CM-044": "Review Queue Hit Rate",
};

/** Display name for a metric_id, falling back to the id itself. */
export function metricName(metricId: string): string {
  return METRIC_NAMES[metricId?.toUpperCase()] ?? metricId;
}

/** Turn a metric_id into a short human blurb, falling back to the given name. */
export function metricBlurb(metricId: string, name?: string | null): string {
  const known = METRIC_DESCRIPTIONS[metricId?.toUpperCase()];
  if (known) return known;
  if (name) return name;
  return "Governance metric.";
}
