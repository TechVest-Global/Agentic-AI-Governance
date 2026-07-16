/**
 * Auditor-facing reference copy — plain-language descriptions of what each
 * governance DIMENSION and METRIC actually verifies. These are factual,
 * definitional descriptions of the real control set (derived from each check's
 * name + formula + dimension), the same reference pattern as the framework and
 * tool descriptions. They are NOT run data and make no claim about a specific
 * application's result — they explain what the check looks at, so a non-technical
 * auditor understands the row in front of them. Used where the engine's own
 * `description` is a placeholder (which is the case for the CM-* catalog today).
 */

export type DimensionInfo = { title: string; blurb: string };

// Keyed by canonical dimension token; resolved from the humanized label via keywords.
const DIMENSIONS: Record<string, DimensionInfo> = {
  task_fulfilment: {
    title: "Task fulfilment",
    blurb: "Does the assistant actually do what users ask — completing tasks correctly, following instructions, and returning usable answers?",
  },
  groundedness: {
    title: "Groundedness",
    blurb: "Are the assistant's answers backed by real, approved sources rather than made up? This is where hallucination is caught.",
  },
  retrieval: {
    title: "Retrieval quality",
    blurb: "For a system that looks information up, does it fetch the right supporting material and use it faithfully in the answer?",
  },
  safety: {
    title: "Safety",
    blurb: "Does the assistant refuse harmful requests and avoid producing unsafe, toxic, or policy-violating content?",
  },
  fairness: {
    title: "Fairness & bias",
    blurb: "Does the assistant treat different groups of people equitably, without discriminatory, stereotyped, or unequal outcomes?",
  },
  privacy: {
    title: "Privacy",
    blurb: "Does the assistant protect personal and sensitive information and avoid leaking it in its responses?",
  },
  security: {
    title: "Security",
    blurb: "Does the assistant resist attacks — jailbreaks, prompt injection, data exfiltration, and misuse of its tools?",
  },
  robustness: {
    title: "Robustness",
    blurb: "Does the assistant behave consistently and reliably when inputs are varied, rephrased, repeated, or perturbed?",
  },
  transparency: {
    title: "Transparency",
    blurb: "Is the assistant clear about its sources, its confidence, and how it reached an answer — so results can be trusted and traced?",
  },
  oversight: {
    title: "Human oversight",
    blurb: "Can people supervise the assistant — does it escalate, defer, flag uncertainty, and avoid wrongly refusing legitimate requests?",
  },
};

const DIM_KEYWORDS: Array<[RegExp, string]> = [
  [/task/i, "task_fulfilment"],
  [/ground/i, "groundedness"],
  [/retriev/i, "retrieval"],
  [/fair|bias/i, "fairness"],
  [/privacy/i, "privacy"],
  [/security/i, "security"],
  [/robust/i, "robustness"],
  [/transparen/i, "transparency"],
  [/oversight|human/i, "oversight"],
  [/safety/i, "safety"],
];

/** Resolve a dimension's auditor info from any label form (raw or humanized). */
export function dimensionInfo(label: string | null | undefined): DimensionInfo | null {
  if (!label) return null;
  const key = label.toLowerCase().trim().replace(/[\s-]+/g, "_");
  if (DIMENSIONS[key]) return DIMENSIONS[key];
  const kw = DIM_KEYWORDS.find(([re]) => re.test(label));
  return kw ? DIMENSIONS[kw[1]] : null;
}

// One factual sentence per CM control — what the check looks at.
const METRICS: Record<string, string> = {
  // Task fulfilment
  "CM-001": "How often the assistant fully and correctly completes what the user asked for.",
  "CM-002": "How reliably the assistant follows explicit instructions and constraints — format, length, ordering, and limits.",
  "CM-003": "Whether responses match the exact structure requested (e.g. valid JSON with only the required fields).",
  "CM-004": "Whether multi-step actions are carried through to completion, leaving nothing important out.",
  // Groundedness
  "CM-005": "How often the assistant states things its sources don't support — i.e. makes facts up (hallucinates).",
  "CM-006": "How faithfully the answer sticks to the supporting source material, without adding unsupported claims.",
  "CM-007": "How much of the answer's factual content is actually backed by a cited source.",
  "CM-008": "How often the assistant makes claims that no source backs up.",
  // Retrieval
  "CM-009": "Whether the system retrieves the relevant supporting documents it needs to answer.",
  "CM-010": "Whether the documents the system retrieves are actually relevant, not noise.",
  "CM-011": "Whether the final answer actually addresses what the user asked.",
  "CM-012": "Whether retrieved content is represented accurately in the answer, not distorted.",
  // Safety
  "CM-013": "How often responses break the organisation's content or conduct policies.",
  "CM-014": "How often responses contain toxic, abusive, or harmful language.",
  "CM-015": "Whether the assistant refuses genuinely unsafe requests while still helping with legitimate ones.",
  "CM-016": "How often the assistant complies with a request it should have refused.",
  // Fairness
  "CM-017": "Whether the assistant fails more often for one group of people than another in equivalent situations.",
  "CM-018": "Whether the assistant's language is more toxic toward some groups than others.",
  "CM-019": "Whether the assistant's tone or sentiment differs unfairly across groups.",
  "CM-020": "How often outputs demean, stereotype, or misrepresent a group of people.",
  "CM-021": "How often the assistant relies on stereotypes about people.",
  // Privacy
  "CM-022": "How often the assistant exposes personal data — names, emails, IDs, financial details — in its responses.",
  "CM-023": "How often the assistant reveals credentials, keys, or other secrets.",
  "CM-024": "Whether memorised training or customer data can be extracted from the model.",
  "CM-025": "How often sensitive information that should be redacted slips through.",
  // Security
  "CM-026": "How often an attacker can bypass the assistant's safety rules with jailbreak prompts.",
  "CM-027": "How often hidden or malicious instructions can hijack the assistant's behaviour.",
  "CM-028": "How often the assistant can be tricked into leaking data it shouldn't.",
  "CM-029": "How often the assistant performs an unauthorised or unsafe action or tool call.",
  // Robustness
  "CM-030": "Whether small changes to the input cause the answer to break or degrade.",
  "CM-031": "Whether the assistant gives consistent answers to the same question asked more than once.",
  "CM-032": "Whether the assistant keeps a consistent persona and style without drifting off-character.",
  "CM-033": "Whether the assistant stays consistent and accurate over time.",
  "CM-034": "How resilient the assistant is to adversarial or noisy inputs.",
  // Transparency
  "CM-035": "Whether the sources the assistant cites are correct and genuinely support the claim.",
  "CM-036": "Whether the assistant's stated confidence matches how likely it is to be right — no false certainty.",
  "CM-037": "Whether the assistant makes the origin or source of its information clear.",
  "CM-038": "Whether the assistant's explanations are clear and genuinely useful to a non-expert.",
  "CM-039": "Whether there is a complete, auditable record of how the assistant reached its answer.",
  // Oversight
  "CM-040": "Whether the assistant escalates to a human at the right times — not too often, not too rarely.",
  "CM-041": "How often a human has to step in and override the assistant.",
  "CM-042": "How often the assistant wrongly refuses a legitimate, in-scope request.",
  "CM-043": "Whether the assistant appropriately signals when it is unsure instead of guessing confidently.",
  "CM-044": "How often responses are routed to human review.",
};

/** Factual description of what a metric checks, or null if we have no copy for it. */
export function metricDescription(metricId: string | null | undefined): string | null {
  if (!metricId) return null;
  return METRICS[metricId.toUpperCase()] ?? null;
}
