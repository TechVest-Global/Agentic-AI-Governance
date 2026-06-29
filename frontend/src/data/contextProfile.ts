// Application Context Profile — guided profile (sections A–E).
// Mirrors PUT /ai-systems/{id}/context-profile from API_CONTRACTS.md (mock-only).

export type ContextSectionId =
  | "identity_purpose"
  | "pre_model_controls"
  | "model_configuration"
  | "post_model_controls"
  | "integration_context";

export type ContextSectionMeta = {
  id: ContextSectionId;
  letter: string;
  title: string;
  blurb: string;
};

export const contextSections: ContextSectionMeta[] = [
  {
    id: "identity_purpose",
    letter: "A",
    title: "Identity & Purpose",
    blurb: "Business domain, use case, decision impact, scale, and jurisdictions.",
  },
  {
    id: "pre_model_controls",
    letter: "B",
    title: "Pre-model Controls",
    blurb: "Input validation, PII handling, prompt construction, and routing before the model call.",
  },
  {
    id: "model_configuration",
    letter: "C",
    title: "Model Configuration",
    blurb: "Provider, model/version, generation parameters, tools, and response format.",
  },
  {
    id: "post_model_controls",
    letter: "D",
    title: "Post-model Controls",
    blurb: "Output filtering, moderation, human-review triggers, fallback, and logging.",
  },
  {
    id: "integration_context",
    letter: "E",
    title: "Integration Context",
    blurb: "Upstream sources, downstream actions, audit sinks, and rollback capability.",
  },
];

// ── Option vocabularies ──────────────────────────────────────────────────────

export const decisionImpactOptions = [
  { value: "advisory", label: "Advisory — informs a human decision" },
  { value: "supervised", label: "Supervised — acts with human in the loop" },
  { value: "autonomous", label: "Autonomous — acts without human review" },
];

export const jurisdictionOptions = ["EU", "United States", "United Kingdom", "Canada", "APAC", "Global"];

export const piiHandlingOptions = [
  { value: "redacted", label: "Redacted before model call" },
  { value: "tokenized", label: "Tokenized / pseudonymized" },
  { value: "hashed", label: "Hashed" },
  { value: "none", label: "No PII reaches the model" },
  { value: "raw", label: "Raw PII passed (flagged risk)" },
];

export const inputValidationOptions = [
  "Schema validation",
  "Length limits",
  "Allow-list filtering",
  "Injection screening",
  "Profanity / toxicity pre-screen",
  "Rate limiting",
];

export const providerOptions = [
  "Azure AI Foundry",
  "OpenAI",
  "Anthropic",
  "Google Vertex AI",
  "AWS Bedrock",
  "Self-hosted / open weights",
];

export const responseFormatOptions = [
  { value: "json", label: "Structured JSON" },
  { value: "text", label: "Free text" },
  { value: "tool_calls", label: "Tool / function calls" },
];

export const toolOptions = ["Retrieval (RAG)", "Web search", "Code execution", "Database query", "External API calls", "None"];

export const outputFilterOptions = [
  "Toxicity filter",
  "PII leakage scan",
  "Citation / grounding check",
  "Schema conformance",
  "Confidence threshold gate",
  "Hallucination detector",
];

export const moderationOptions = [
  { value: "automated", label: "Automated moderation service" },
  { value: "rules", label: "Rule-based filters" },
  { value: "human", label: "Human moderation queue" },
  { value: "none", label: "No moderation" },
];

export const humanReviewTriggerOptions = [
  "Low confidence score",
  "High-impact decision",
  "Protected-attribute involvement",
  "Monetary threshold exceeded",
  "Policy-flagged content",
  "Customer appeal",
];

export const loggingOptions = [
  { value: "full", label: "Full request/response logging" },
  { value: "metadata", label: "Metadata only" },
  { value: "redacted", label: "Redacted logging" },
  { value: "none", label: "No logging" },
];

export const downstreamActionOptions = [
  "Write to database",
  "Trigger workflow / ticket",
  "Send customer communication",
  "Financial transaction",
  "Update CRM record",
  "No side effects (read-only)",
];

export const rollbackOptions = [
  { value: "automatic", label: "Automatic rollback" },
  { value: "manual", label: "Manual rollback" },
  { value: "none", label: "No rollback capability" },
];

// ── Form state shape ─────────────────────────────────────────────────────────

export type ContextProfileForm = {
  // A — identity_purpose
  business_domain: string;
  primary_use_case: string;
  decision_impact: string;
  affected_users: string;
  scale: string;
  jurisdictions: string[];
  // B — pre_model_controls
  input_validation: string[];
  pii_handling: string;
  prompt_construction: string;
  retrieved_context: string;
  routing: string;
  // C — model_configuration
  provider: string;
  model: string;
  model_version: string;
  temperature: string;
  max_tokens: string;
  response_format: string;
  tools: string[];
  // D — post_model_controls
  output_filters: string[];
  moderation: string;
  human_review_triggers: string[];
  fallback_behavior: string;
  logging: string;
  // E — integration_context
  upstream_sources: string;
  downstream_actions: string[];
  audit_sinks: string;
  notifications: string;
  rollback_capability: string;
};

export const emptyContextProfile: ContextProfileForm = {
  business_domain: "",
  primary_use_case: "",
  decision_impact: "",
  affected_users: "",
  scale: "",
  jurisdictions: [],
  input_validation: [],
  pii_handling: "",
  prompt_construction: "",
  retrieved_context: "",
  routing: "",
  provider: "",
  model: "",
  model_version: "",
  temperature: "",
  max_tokens: "",
  response_format: "",
  tools: [],
  output_filters: [],
  moderation: "",
  human_review_triggers: [],
  fallback_behavior: "",
  logging: "",
  upstream_sources: "",
  downstream_actions: [],
  audit_sinks: "",
  notifications: "",
  rollback_capability: "",
};

// Required field keys per section, used to compute completion + validation.
export const requiredBySection: Record<ContextSectionId, (keyof ContextProfileForm)[]> = {
  identity_purpose: ["business_domain", "primary_use_case", "decision_impact"],
  pre_model_controls: ["pii_handling"],
  model_configuration: ["provider", "model", "response_format"],
  post_model_controls: ["moderation", "logging"],
  integration_context: ["rollback_capability"],
};
