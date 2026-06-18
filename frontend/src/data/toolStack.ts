export type GovernAITool = {
  id: string;
  name: string;
  role: string;
  license: string;
  githubStars: string;
  version: string;
  frameworkEvidence: string[];
  agents: string[];
  docsUrl: string;
  conditional: boolean;
  activationTrigger?: string;
};

export const coreTools: GovernAITool[] = [
  {
    id: "langfuse",
    name: "Langfuse",
    role: "Audit ledger — observability and trace storage for all agent runs",
    license: "MIT",
    githubStars: "7.2k",
    version: "v2.x",
    frameworkEvidence: ["EU AI Act Art.12 Record-keeping", "NIST AI RMF Govern 1.2", "ISO 42001 A.6.2.6"],
    agents: ["Cross-cutting — threads through all 5 specialists"],
    docsUrl: "https://langfuse.com/docs",
    conditional: false,
  },
  {
    id: "promptfoo",
    name: "Promptfoo",
    role: "CI gates — automated prompt evaluation and regression testing",
    license: "MIT",
    githubStars: "5.1k",
    version: "v0.95+",
    frameworkEvidence: ["EU AI Act Art.9 Risk Management", "NIST AI RMF Measure 2.5", "SR 11-7 Ongoing Monitoring"],
    agents: ["Misuse Detector", "Compliance Mapper"],
    docsUrl: "https://promptfoo.dev/docs",
    conditional: false,
  },
  {
    id: "deepeval",
    name: "DeepEval",
    role: "LLM judge — evaluates explanation quality and reasoning fidelity",
    license: "Apache-2.0",
    githubStars: "4.8k",
    version: "v1.x",
    frameworkEvidence: ["EU AI Act Art.13 Transparency", "NIST AI RMF Measure 2.7", "ISO 42001 A.8.4"],
    agents: ["Explainability Agent"],
    docsUrl: "https://docs.confident-ai.com",
    conditional: false,
  },
  {
    id: "garak",
    name: "Garak",
    role: "Security red-team — adversarial probing for jailbreak and misuse vectors",
    license: "Apache-2.0",
    githubStars: "2.9k",
    version: "v0.15",
    frameworkEvidence: ["OWASP LLM Top 10", "NIST AI RMF Manage 2.4", "EU AI Act Art.15 Robustness"],
    agents: ["Misuse Detector"],
    docsUrl: "https://docs.garak.ai",
    conditional: false,
  },
  {
    id: "presidio",
    name: "Presidio",
    role: "PII detection and redaction for evidence sanitization",
    license: "MIT",
    githubStars: "3.4k",
    version: "v2.x",
    frameworkEvidence: ["EU AI Act Art.10 Data Governance", "NIST AI RMF Govern 1.7", "PIPEDA s.7"],
    agents: ["Compliance Mapper"],
    docsUrl: "https://microsoft.github.io/presidio",
    conditional: false,
  },
  {
    id: "clip",
    name: "CLIP / OpenCLIP",
    role: "Vision — embedding-based image and video content analysis",
    license: "MIT / Apache-2.0",
    githubStars: "5.6k",
    version: "ViT-B/32",
    frameworkEvidence: ["EU AI Act Art.10(2)(f)", "NIST AI RMF Measure 2.6"],
    agents: ["Bias Auditor", "Drift Analyst"],
    docsUrl: "https://github.com/mlfoundations/open_clip",
    conditional: false,
  },
  {
    id: "whisper",
    name: "Whisper",
    role: "Audio — speech-to-text for voice-based AI system auditing",
    license: "MIT",
    githubStars: "72k",
    version: "large-v3",
    frameworkEvidence: ["EU AI Act Art.52 Transparency", "NIST AI RMF Measure 2.11"],
    agents: ["Explainability Agent"],
    docsUrl: "https://github.com/openai/whisper",
    conditional: false,
  },
];

export const conditionalTools: GovernAITool[] = [
  {
    id: "langfair",
    name: "LangFair",
    role: "Fairness metrics for LLM outputs — counterfactual and demographic parity",
    license: "Apache-2.0",
    githubStars: "0.4k",
    version: "v0.4",
    frameworkEvidence: ["EU AI Act Art.10(2)(f)", "NIST AI RMF Measure 2.11", "SR 11-7 Bias"],
    agents: ["Bias Auditor (primary)"],
    docsUrl: "https://github.com/cvs-health/langfair",
    conditional: true,
    activationTrigger: "Always active for Bias Auditor on high-risk systems",
  },
  {
    id: "ragas",
    name: "RAGAS",
    role: "RAG evaluation — faithfulness, context relevancy, answer relevancy",
    license: "Apache-2.0",
    githubStars: "7.8k",
    version: "v0.2+",
    frameworkEvidence: ["NIST AI RMF Measure 2.7", "ISO 42001 A.8.4"],
    agents: ["Explainability Agent"],
    docsUrl: "https://docs.ragas.io",
    conditional: true,
    activationTrigger: "Activated when system_type includes RAG retrieval",
  },
  {
    id: "fairlearn",
    name: "Fairlearn",
    role: "Statistical fairness — demographic parity, equalized odds for tabular ML",
    license: "MIT",
    githubStars: "1.9k",
    version: "v0.10+",
    frameworkEvidence: ["EU AI Act Art.10(2)(f)", "SR 11-7 Model Validation"],
    agents: ["Bias Auditor"],
    docsUrl: "https://fairlearn.org",
    conditional: true,
    activationTrigger: "Activated when system_type is tabular ML or hybrid",
  },
  {
    id: "c2pa",
    name: "C2PA",
    role: "Content provenance — cryptographic content authenticity verification",
    license: "Apache-2.0 / MIT",
    githubStars: "0.6k",
    version: "v0.x",
    frameworkEvidence: ["EU AI Act Art.52 Synthetic Content", "NIST AI RMF Govern 1.6"],
    agents: ["Cross-cutting"],
    docsUrl: "https://c2pa.org",
    conditional: true,
    activationTrigger: "Activated when system generates synthetic images or media",
  },
];

export type ToolAgentMapping = {
  tool: string;
  agent: string;
  frameworkArticle: string;
};

export const toolAgentMappings: ToolAgentMapping[] = [
  { tool: "LangFair", agent: "Bias Auditor", frameworkArticle: "EU AI Act Art.10(2)(f) — Data Governance" },
  { tool: "CLIP / OpenCLIP", agent: "Bias Auditor", frameworkArticle: "EU AI Act Art.10(2)(f) — Image/Video Bias" },
  { tool: "Garak", agent: "Misuse Detector", frameworkArticle: "OWASP LLM Top 10 — Adversarial Probing" },
  { tool: "Promptfoo", agent: "Misuse Detector", frameworkArticle: "SR 11-7 — Two-Level ALGS Test" },
  { tool: "Promptfoo", agent: "Compliance Mapper", frameworkArticle: "EU AI Act Art.9 — Behavioral Probing" },
  { tool: "Presidio", agent: "Compliance Mapper", frameworkArticle: "EU AI Act Art.10 — PII Documentary Check" },
  { tool: "DeepEval", agent: "Explainability Agent", frameworkArticle: "EU AI Act Art.13 — Explanation Fidelity" },
  { tool: "Whisper", agent: "Explainability Agent", frameworkArticle: "EU AI Act Art.52 — Audio Transparency" },
  { tool: "CLIP / OpenCLIP", agent: "Drift Analyst", frameworkArticle: "NIST AI RMF Measure 2.5 — Embedding Drift" },
  { tool: "Langfuse", agent: "All 5 Specialists", frameworkArticle: "EU AI Act Art.12 — Cross-cutting Audit Ledger" },
  { tool: "RAGAS", agent: "Explainability Agent", frameworkArticle: "NIST AI RMF Measure 2.7 — RAG Faithfulness" },
  { tool: "Fairlearn", agent: "Bias Auditor", frameworkArticle: "SR 11-7 — Statistical Fairness (Tabular)" },
];
