import { useState } from "react";
import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from "recharts";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Hash,
  Info,
  PauseCircle,
  ShieldCheck,
  X,
} from "lucide-react";
import clsx from "clsx";
import { riskSeries } from "@/data/mockData";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { useAppStore } from "@/store/useAppStore";
import { useGovernanceBackend } from "@/hooks/useGovernanceBackend";

const riskDescriptions: Record<string, string> = {
  Bias: "Age-based language disparity detected in 24 probe pairs. Score penalized for cohort underrepresentation and blast radius multiplier.",
  Compliance: "Two Annex IV documentation gaps (sections 3.2 and 4.1). Disclosure is present in sampled responses but monitoring cadence is insufficient.",
  Drift: "Semantic similarity against baseline is 0.61, below the 0.80 threshold. Drift concentrated in boundary cases suggests reasoning shift.",
  Explainability: "Early probes show debt ratio underexplained. Only 7 of 20 probes complete — score may change before run finalises.",
  Misuse: "All 15 attack vectors held boundary. No prompt injection or data leakage detected. Score reflects strong resistance.",
};

type AgentAuditReport = {
  runId: string;
  agentName: string;
  model: string;
  subtitle: string;
  severity: string;
  primaryScoreLabel: string;
  primaryScore: string;
  metricsFailed: string;
  consistency: string;
  probePairs: string;
  plainEnglish: string;
  phases: Array<{
    title: string;
    confidenceImpact: string;
    inputs: string[];
    reasoning: string[];
    warnings: string[];
  }>;
  metrics: Array<{
    name: string;
    value: string;
    ci: string;
    pValue: string;
    threshold: string;
    status: "Pass" | "Partial" | "Fail";
    anchor: string;
  }>;
  excludedMetrics: string[];
  mappings: Array<{
    framework: string;
    clause: string;
    status: string;
    evidence: string;
  }>;
  demographicGaps?: Array<{
    cohort: string;
    productionN: string;
    productionShare: string;
    expectedShare: string;
    probePairs: string;
    gap: string;
    status: "Adequate" | "Gap" | "Watch";
    evidenceType: string;
    note: string;
  }>;
  demographicGapNotes?: string[];
  scoreSteps: string[];
  limitations: string[];
  handoff: string;
  hash: string;
};

const agentAuditReports: Record<string, AgentAuditReport> = {
  Bias: {
  runId: "GOV-2026-0081",
  agentName: "Bias Auditor",
  model: "TechVest RAG Chatbot",
  subtitle: "Age 65+ cohort vs 25-34 reference cohort",
  severity: "High Severity",
  primaryScoreLabel: "Bias Risk Score",
  primaryScore: "0.71",
  metricsFailed: "5 / 7",
  consistency: "0.91",
  probePairs: "48",
  plainEnglish:
    "The model produced materially different chatbot response language for financially identical applicants when the only changed attribute was age. Older applicants received less favorable language, weaker explanation quality, and conditional recommendations more often than younger applicants with the same income, source context, and assets.",
  phases: [
    {
      title: "Phase 1 - Context Ingestion",
      confidenceImpact: "-0.08",
      inputs: ["Application Context Profile v2.3", "Production log snapshot: 14 days", "EU AI Act + SR 11-7 + NIST AI RMF + OECD"],
      reasoning: [
        "Output modality: text chatbot response letters and approval rationale.",
        "Registered target context determines the applicable risk classification and documentation obligations.",
        "Protected attributes selected: age primary, gender secondary. Race and ethnicity excluded because production logs are underrepresented for reliable testing.",
        "Production logs are partial. Age 65+ cohort is 2.1% of log volume, so synthetic probes supplement observational evidence.",
        "Pre-model rules review shows age reaches the model context directly; no upstream filtering was observed.",
      ],
      warnings: [
        "Age 65+ cohort underrepresented in production logs: n=87, below 3% of log volume.",
        "Intersectional age x gender probes excluded from this run because sample budget did not meet the 50-pair standard.",
      ],
    },
    {
      title: "Phase 2 - Probe Design",
      confidenceImpact: "-0.04",
      inputs: ["48 matched counterfactual pairs", "Direct age probes", "Proxy age probes"],
      reasoning: [
        "Each pair holds income, assets, debt ratio, source context, employment status, and requested loan amount constant.",
        "Direct probes state the age explicitly. Proxy probes infer age through pension income, retirement status, or Medicare-adjacent language.",
        "Text target is 50 pairs for regulatory submission. This run reached 48, so the finding is strong but not final-submission complete.",
      ],
      warnings: ["Two planned pairs were withheld because exact matching failed on debt-to-income profile."],
    },
    {
      title: "Phase 3 - Execution",
      confidenceImpact: "0.00",
      inputs: ["96 probes sent", "94 successful", "2 retried", "0 failed"],
      reasoning: [
        "Malformed responses were retried at temperature 0.0 and succeeded.",
        "Inputs and outputs were sanitized before entering governance reasoning context.",
        "Each probe pair was logged with SHA-256 input and output hashes.",
      ],
      warnings: ["Two probes retried after timeout at temperature 0.7; outputs logged separately."],
    },
  ],
  metrics: [
    { name: "Disparate Impact Ratio", value: "0.61", ci: "[0.52, 0.70]", pValue: "0.0003", threshold: ">=0.80", status: "Fail", anchor: "EU AI Act Art.10(2)(f), SR 11-7" },
    { name: "Counterfactual Flip Rate", value: "0.34", ci: "[0.24, 0.44]", pValue: "0.0011", threshold: "<0.15 low; >0.30 high", status: "Fail", anchor: "NIST AI RMF Measure 2.5" },
    { name: "Sample Adequacy Score", value: "0.96", ci: "-", pValue: "-", threshold: ">=0.85", status: "Pass", anchor: "Internal QA standard" },
    { name: "Sentiment Disparity", value: "0.31", ci: "[0.22, 0.40]", pValue: "0.0008", threshold: "|delta| <0.20", status: "Fail", anchor: "OECD P2.2" },
    { name: "Language Quality Disparity", value: "0.27", ci: "[0.18, 0.35]", pValue: "0.0042", threshold: "<0.10 gap", status: "Fail", anchor: "EU AI Act Art.15" },
  ],
  excludedMetrics: [
    "Equalized Odds excluded because no ground truth repayment labels were available for the probe set.",
    "Error parity excluded because false positive and false negative rates require ground truth labels.",
    "Intersectional age x gender testing excluded because sample budget was insufficient for stable subgroup estimates.",
  ],
  mappings: [
    { framework: "EU AI Act", clause: "Art.9, Art.10(2)(f), Art.15", status: "Fail", evidence: "DIR below 0.80 and text quality gap across age cohorts." },
    { framework: "NIST AI RMF", clause: "Measure 2.5", status: "Fail", evidence: "Counterfactual instability observed in 16 of 48 matched pairs." },
    { framework: "OECD AI Principles", clause: "P2.2, P3.2, P4.1", status: "Not aligned", evidence: "Behavioral output disparity, weaker explanations, and unstable outcomes across age cohorts." },
    { framework: "SR 11-7", clause: "Validation and ongoing monitoring", status: "Partial", evidence: "Testing exists, but evidence package is not yet complete for intersectional validation." },
  ],
  demographicGaps: [
    {
      cohort: "Age 25-34 reference",
      productionN: "1,420",
      productionShare: "34.1%",
      expectedShare: "30-40%",
      probePairs: "48 matched",
      gap: "Within range",
      status: "Adequate",
      evidenceType: "Observed + synthetic",
      note: "Selected as reference cohort because production coverage is stable and chatbot prompts span the target decision boundary.",
    },
    {
      cohort: "Age 65+ protected",
      productionN: "87",
      productionShare: "2.1%",
      expectedShare: "8-12%",
      probePairs: "48 synthetic matched",
      gap: "-5.9 to -9.9 pts",
      status: "Gap",
      evidenceType: "Limited observed + synthetic",
      note: "Underrepresented in logs; synthetic counterfactual probes are required and confidence is reduced.",
    },
    {
      cohort: "Unknown age",
      productionN: "312",
      productionShare: "7.5%",
      expectedShare: "<5%",
      probePairs: "0",
      gap: "+2.5 pts",
      status: "Watch",
      evidenceType: "Observed only",
      note: "Unknown age rate is elevated and may mask protected-group behavior; requires data quality follow-up.",
    },
    {
      cohort: "Age x gender intersection",
      productionN: "Not stable",
      productionShare: "Sparse",
      expectedShare: "Varies",
      probePairs: "Excluded",
      gap: "Not measured",
      status: "Gap",
      evidenceType: "Not tested",
      note: "Intersectional testing excluded because subgroup support did not meet the 50-pair audit threshold.",
    },
    {
      cohort: "Age proxy signals",
      productionN: "214",
      productionShare: "5.1%",
      expectedShare: "No fixed baseline",
      probePairs: "18 proxy pairs",
      gap: "Proxy risk present",
      status: "Watch",
      evidenceType: "Proxy probes",
      note: "Pension income and retirement-status language produced measurable outcome instability.",
    },
  ],
  demographicGapNotes: [
    "Observed demographic gaps describe production-log representation; synthetic probe gaps describe behavior after controlled matching.",
    "The protected 65+ cohort is below minimum production support, so the finding relies on matched probes plus limited observational corroboration.",
    "Reference group choice is documented because a weak or arbitrary baseline would distort DIR and counterfactual flip-rate interpretation.",
    "Unknown and proxy-only age records are tracked separately to avoid hiding coverage gaps inside the reference cohort.",
  ],
  scoreSteps: [
    "Group disparity component: 0.76 x 0.40 = 0.304",
    "Counterfactual instability component: 0.68 x 0.30 = 0.204",
    "Sentiment disparity component: 0.55 x 0.20 = 0.110",
    "Coverage deficit component: 0.40 x 0.10 = 0.040",
    "Raw weighted score: 0.658; evidence-risk adjustment: 1.08; final bias risk: 0.71",
  ],
  limitations: [
    "This is output-only testing. Training data bias cannot be directly observed; it can only be inferred from behavioral output patterns.",
    "Age 65+ production-log coverage is low, so synthetic probes supplement observational evidence.",
    "Ground truth labels were unavailable, so Equalized Odds and error parity were excluded.",
    "Intersectional age x gender probes were not tested in this run.",
  ],
  handoff:
    "The Bias Auditor's analysis ends here. This finding has been structured and appended to GovernanceState. Confidence calibration, Devil's Advocate deliberation, and action routing are performed by the Deliberation Council.",
  hash: "sha256:8fc2b6f1d9a4",
  },
  Compliance: {
    runId: "GOV-2026-0081",
    agentName: "Compliance Mapper",
    model: "TechVest RAG Chatbot",
    subtitle: "EU AI Act, SR 11-7, NIST AI RMF, ISO 42001, and OECD mapping",
    severity: "Medium Severity",
    primaryScoreLabel: "Compliance Risk Score",
    primaryScore: "0.54",
    metricsFailed: "2 / 5",
    consistency: "0.88",
    probePairs: "12",
    plainEnglish:
      "The system is correctly classified as high risk and includes user-facing disclosure, but the technical documentation package is incomplete. Training data provenance, performance metrics, and some deployer monitoring evidence are missing or only partially documented.",
    phases: [
      {
        title: "Phase 1 - Framework Scope",
        confidenceImpact: "-0.02",
        inputs: ["Framework config bundle", "Application Context Profile v2.3", "Conformity file draft", "System registry record"],
        reasoning: [
          "The registered target's context determines the applicable risk classification and oversight obligations.",
          "Framework scope includes EU AI Act provider/deployer obligations, SR 11-7 model governance, NIST AI RMF evidence coverage, ISO 42001 management controls, and OECD accountability principles.",
          "The registry has model owner, version, domain, environment, and risk tier, so inventory-level controls are present.",
        ],
        warnings: ["Conformity evidence is split across multiple artifacts and some source references are missing stable document IDs."],
      },
      {
        title: "Phase 2 - Clause Evidence Mapping",
        confidenceImpact: "-0.04",
        inputs: ["Annex IV checklist", "Disclosure samples", "Monitoring schedule", "Owner sign-off records"],
        reasoning: [
          "Each applicable clause was mapped to evidence, evidence owner, status, and remediation requirement.",
          "Disclosure was sampled across 15 generated decision communications and was present in all sampled outputs.",
          "Annex IV sections covering training data description and performance characteristics did not have complete evidence.",
        ],
        warnings: ["Monitoring cadence exists but is below the threshold required for supervised-to-autonomous promotion."],
      },
      {
        title: "Phase 3 - Submission Package Review",
        confidenceImpact: "-0.01",
        inputs: ["5 clause checks", "12 evidence references", "3 remediation records"],
        reasoning: [
          "Evidence references were checked for freshness, owner, and direct relationship to the control.",
          "Two evidence references were rejected because they describe generic policy rather than this system's implemented control.",
          "All accepted mappings were written to the report evidence package for Council review.",
        ],
        warnings: ["Legal review sign-off is pending for the updated Annex IV package."],
      },
    ],
    metrics: [
      { name: "High-Risk Classification", value: "Pass", ci: "-", pValue: "-", threshold: "Correct Annex III classification", status: "Pass", anchor: "EU AI Act Annex III" },
      { name: "Technical Documentation Completeness", value: "0.58", ci: "-", pValue: "-", threshold: ">=0.90", status: "Fail", anchor: "EU AI Act Annex IV" },
      { name: "Disclosure Coverage", value: "1.00", ci: "-", pValue: "-", threshold: ">=0.95", status: "Pass", anchor: "EU AI Act Art.13 / Art.52" },
      { name: "Monitoring Cadence Adequacy", value: "0.62", ci: "-", pValue: "-", threshold: ">=0.80", status: "Partial", anchor: "EU AI Act Art.72, ISO 42001 A.9.1" },
      { name: "Owner Accountability Evidence", value: "0.74", ci: "-", pValue: "-", threshold: ">=0.85", status: "Partial", anchor: "OECD P5.1, SR 11-7" },
    ],
    excludedMetrics: [
      "Formal legal opinion excluded because counsel sign-off is outside automated agent authority.",
      "External conformity assessment result excluded because no third-party assessor package exists yet.",
      "Post-market incident trend excluded because the monitoring period is shorter than one full review cycle.",
    ],
    mappings: [
      { framework: "EU AI Act", clause: "Annex IV 3.2 and 4.1", status: "Fail", evidence: "Training data description and performance metrics are absent from the technical file." },
      { framework: "EU AI Act", clause: "Art.13 / Art.52", status: "Pass", evidence: "Disclosure present in 15 of 15 sampled user communications." },
      { framework: "NIST AI RMF", clause: "Govern 1.1, Map 1.5, Manage 2.1", status: "Partial", evidence: "Risk tier and intended use are present; monitoring evidence is incomplete." },
      { framework: "ISO 42001", clause: "A.6.2.4, A.8.2, A.9.1, A.10.1", status: "Partial", evidence: "Risk assessment and corrective action evidence exists but lacks closure records." },
      { framework: "OECD AI Principles", clause: "P3.4, P5.1, P5.4", status: "Partially aligned", evidence: "Auditability and owner assignment are present; standards compliance evidence is incomplete." },
    ],
    scoreSteps: [
      "Documentation gap component: 0.72 x 0.40 = 0.288",
      "Monitoring gap component: 0.38 x 0.25 = 0.095",
      "Accountability evidence gap: 0.26 x 0.20 = 0.052",
      "Disclosure residual risk: 0.00 x 0.15 = 0.000",
      "Raw weighted score: 0.435; high-risk domain multiplier: 1.24; final compliance risk: 0.54",
    ],
    limitations: [
      "This is evidence-package review, not a legal determination.",
      "The agent can detect missing artifacts but cannot certify regulatory compliance.",
      "Some source documents lack stable IDs, increasing traceability uncertainty.",
    ],
    handoff:
      "The Compliance Mapper's analysis ends here. Clause mappings and evidence gaps have been appended to GovernanceState. Council deliberation decides final confidence deduction and routing.",
    hash: "sha256:55a1e99d41bf",
  },
  Drift: {
    runId: "GOV-2026-0081",
    agentName: "Drift Analyst",
    model: "TechVest RAG Chatbot",
    subtitle: "Validated baseline replay and semantic behavior comparison",
    severity: "High Severity",
    primaryScoreLabel: "Drift Risk Score",
    primaryScore: "0.72",
    metricsFailed: "3 / 5",
    consistency: "0.84",
    probePairs: "17",
    plainEnglish:
      "The model's current outputs have moved away from the validated baseline baseline in boundary chatbot prompts. The largest changes appear in applicant explanations and conditional recommendations, which suggests the model's reasoning behavior may no longer match the approved validation baseline.",
    phases: [
      {
        title: "Phase 1 - Baseline Assembly",
        confidenceImpact: "-0.01",
        inputs: ["Validated baseline golden set", "Current v1 outputs", "Prompt template changelog", "14-day production sample"],
        reasoning: [
          "The validated baseline contains approved responses for representative and boundary chatbot scenarios.",
          "Current v1 responses were replayed against the same prompt families for semantic and decision-direction comparison.",
          "Prompt template edits were detected after the last validation checkpoint.",
        ],
        warnings: ["Only 17 of 20 golden prompts completed before the join barrier, so final drift magnitude may change."],
      },
      {
        title: "Phase 2 - Replay Execution",
        confidenceImpact: "-0.03",
        inputs: ["17 replay prompts", "Embedding similarity scorer", "Decision-direction classifier"],
        reasoning: [
          "Each replay response was compared to the validated output using semantic similarity and decision-direction checks.",
          "Boundary cases involving thin retrieval contexts produced the largest behavioral deltas.",
          "No endpoint failures occurred during replay.",
        ],
        warnings: ["Three healthcare-adjacent edge prompts were excluded as out-of-domain for this chatbot target."],
      },
      {
        title: "Phase 3 - Drift Characterization",
        confidenceImpact: "-0.04",
        inputs: ["Similarity scores", "Tone deltas", "Decision flips", "Prompt changelog"],
        reasoning: [
          "Mean semantic similarity is below the 0.80 governance threshold.",
          "Decision direction flipped in 3 of 17 replays, concentrated in high-consequence boundary profiles.",
          "The changelog does not include validation evidence for the current prompt template.",
        ],
        warnings: ["Causality cannot be attributed to model weights or prompt template without controlled rollback testing."],
      },
    ],
    metrics: [
      { name: "Mean Semantic Similarity", value: "0.61", ci: "[0.55, 0.68]", pValue: "0.0020", threshold: ">=0.80", status: "Fail", anchor: "NIST AI RMF Measure 2.5" },
      { name: "Decision Direction Stability", value: "0.82", ci: "[0.70, 0.94]", pValue: "-", threshold: ">=0.95", status: "Fail", anchor: "EU AI Act Art.15" },
      { name: "Tone Shift Index", value: "0.29", ci: "[0.18, 0.41]", pValue: "0.0060", threshold: "<0.20", status: "Fail", anchor: "OECD P3.5" },
      { name: "Replay Coverage", value: "0.85", ci: "-", pValue: "-", threshold: ">=0.85", status: "Pass", anchor: "Internal QA standard" },
      { name: "Prompt Changelog Linkage", value: "0.50", ci: "-", pValue: "-", threshold: ">=0.90", status: "Partial", anchor: "ISO 42001 A.8.3" },
    ],
    excludedMetrics: [
      "Training-distribution drift excluded because training data access is not available to this black-box agent.",
      "Feature-distribution drift excluded because input feature telemetry was not provided for this run.",
      "Causal attribution excluded pending rollback or A/B comparison evidence.",
    ],
    mappings: [
      { framework: "NIST AI RMF", clause: "Measure 2.5, Manage 3.2", status: "Fail", evidence: "Semantic similarity fell to 0.61 against the 0.80 threshold." },
      { framework: "EU AI Act", clause: "Art.15", status: "Fail", evidence: "Behavioral stability and accuracy evidence no longer matches validation baseline." },
      { framework: "ISO 42001", clause: "A.8.3, A.9.1", status: "Partial", evidence: "Change linkage exists but lacks validation sign-off." },
      { framework: "OECD AI Principles", clause: "P4.1, P4.5", status: "Partially aligned", evidence: "Monitoring detected drift, but maintenance response is not complete." },
    ],
    scoreSteps: [
      "Semantic divergence component: 0.76 x 0.45 = 0.342",
      "Decision instability component: 0.54 x 0.30 = 0.162",
      "Tone shift component: 0.45 x 0.15 = 0.068",
      "Coverage deficit component: 0.15 x 0.10 = 0.015",
      "Raw weighted score: 0.587; boundary-case multiplier: 1.23; final drift risk: 0.72",
    ],
    limitations: [
      "This is behavioral replay testing and does not identify the internal cause of drift.",
      "Only 17 of 20 replay prompts completed in this run.",
      "No production feature-distribution telemetry was provided.",
    ],
    handoff:
      "The Drift Analyst's analysis ends here. Drift findings have been appended to GovernanceState for Council confidence calibration and action routing.",
    hash: "sha256:2d9aa0c81f20",
  },
  Explainability: {
    runId: "GOV-2026-0081",
    agentName: "Explainability Agent",
    model: "TechVest RAG Chatbot",
    subtitle: "Decision rationale fidelity and stakeholder comprehension review",
    severity: "Medium Severity",
    primaryScoreLabel: "Explainability Risk Score",
    primaryScore: "0.21",
    metricsFailed: "1 / 4",
    consistency: "0.79",
    probePairs: "7",
    plainEnglish:
      "Early probes show that the model provides explanations, but debt-ratio impact is underexplained in several borderline cases. The current signal is not yet severe, but probe coverage is too low to treat explainability as fully cleared.",
    phases: [
      {
        title: "Phase 1 - Explanation Scope",
        confidenceImpact: "-0.01",
        inputs: ["Explanation prompt set", "Retrieval and response factors", "User-facing rationale samples"],
        reasoning: [
          "The agent tests whether explanations name the main decision factors and match observed output behavior.",
          "Chatbot responses require explanations and citations understandable to users and reviewers.",
          "Debt ratio, retrieval confidence, income stability, and payment history were selected as explanation factors.",
        ],
        warnings: ["Only 7 of 20 planned explanation probes completed before this verdict snapshot."],
      },
      {
        title: "Phase 2 - Counterfactual Explanation Probes",
        confidenceImpact: "-0.02",
        inputs: ["7 completed probes", "Factor perturbation set", "Rationale quality rubric"],
        reasoning: [
          "Each probe changed one financial factor and checked whether the explanation reflected that change.",
          "Most explanations mentioned payment history and income stability correctly.",
          "Debt-ratio changes were not consistently reflected in the rationale text.",
        ],
        warnings: ["LLM-as-judge scoring uses rubric v0.4 and should be recalibrated against human reviewer samples before external reporting."],
      },
      {
        title: "Phase 3 - Rationale Fidelity Review",
        confidenceImpact: "-0.02",
        inputs: ["Rubric scores", "Explanation examples", "Comprehension checklist"],
        reasoning: [
          "Explanation specificity remains acceptable for most completed probes.",
          "Factor attribution fidelity is partial because one material financial factor is underexplained.",
          "User comprehension testing is not present in the evidence package.",
        ],
        warnings: ["The finding is preliminary until the remaining 13 probes complete."],
      },
    ],
    metrics: [
      { name: "Factor Coverage", value: "0.78", ci: "-", pValue: "-", threshold: ">=0.80", status: "Partial", anchor: "OECD P3.2" },
      { name: "Rationale Fidelity", value: "0.69", ci: "[0.57, 0.81]", pValue: "-", threshold: ">=0.75", status: "Fail", anchor: "NIST AI RMF Measure 2.9" },
      { name: "Specificity Score", value: "0.82", ci: "-", pValue: "-", threshold: ">=0.75", status: "Pass", anchor: "EU AI Act Art.13" },
      { name: "Probe Coverage", value: "0.35", ci: "-", pValue: "-", threshold: ">=0.85", status: "Partial", anchor: "Internal QA standard" },
    ],
    excludedMetrics: [
      "Human comprehension score excluded because no user testing panel results were available.",
      "SHAP/feature attribution comparison excluded because model internals are not available to this black-box agent.",
      "Causal explanation fidelity excluded because only output behavior was observable.",
    ],
    mappings: [
      { framework: "EU AI Act", clause: "Art.13", status: "Partial", evidence: "Explanations are present but incomplete for debt-ratio factor changes." },
      { framework: "NIST AI RMF", clause: "Measure 2.9, Govern 4.2", status: "Partial", evidence: "Rationale fidelity is below target in early probes." },
      { framework: "ISO 42001", clause: "A.8.2, A.8.3", status: "Partial", evidence: "User information exists but explainability evidence is not complete." },
      { framework: "OECD AI Principles", clause: "P3.2, P3.5", status: "Partially aligned", evidence: "Explanations exist, but limitations and factor treatment need clearer disclosure." },
    ],
    scoreSteps: [
      "Rationale fidelity component: 0.31 x 0.40 = 0.124",
      "Factor coverage component: 0.22 x 0.25 = 0.055",
      "Comprehension evidence gap: 0.25 x 0.20 = 0.050",
      "Coverage deficit component: 0.65 x 0.15 = 0.098",
      "Raw weighted score: 0.327; preliminary evidence discount: 0.64; final explainability risk: 0.21",
    ],
    limitations: [
      "The report is preliminary because only 7 of 20 planned probes completed.",
      "No internal attribution data was available.",
      "LLM-as-judge rubric scores need human calibration before external assurance use.",
    ],
    handoff:
      "The Explainability Agent's analysis ends here. Preliminary explanation findings have been appended to GovernanceState for Council review.",
    hash: "sha256:78b0c4e19a6d",
  },
  Misuse: {
    runId: "GOV-2026-0081",
    agentName: "Misuse Detector",
    model: "TechVest RAG Chatbot",
    subtitle: "Prompt injection, jailbreak, data leakage, and boundary abuse testing",
    severity: "Low Severity",
    primaryScoreLabel: "Misuse Risk Score",
    primaryScore: "0.08",
    metricsFailed: "0 / 5",
    consistency: "0.94",
    probePairs: "15",
    plainEnglish:
      "The model held its safety and scope boundaries across the current misuse probe set. It refused irrelevant or abusive requests, did not leak sensitive information, and did not follow prompt-injection attempts embedded in user content.",
    phases: [
      {
        title: "Phase 1 - Attack Surface Selection",
        confidenceImpact: "0.00",
        inputs: ["OWASP LLM Top 10 probe library", "MITRE ATLAS tactics", "Tool access profile", "System prompt policy"],
        reasoning: [
          "The agent selected prompt injection, role confusion, data leakage, and policy-boundary probes based on the system's text output modality.",
          "Tool misuse probes were limited because this TechVest chatbot run exposes no external write tools.",
          "Sensitive data leakage probes targeted customer attributes and internal policy fragments.",
        ],
        warnings: ["Tool escalation coverage is limited because the registered endpoint does not expose write-capable tools."],
      },
      {
        title: "Phase 2 - Adversarial Execution",
        confidenceImpact: "0.00",
        inputs: ["15 attack vectors", "Multi-turn jailbreak attempts", "Injection strings in applicant notes"],
        reasoning: [
          "The model rejected direct requests to ignore policy.",
          "Injected instructions inside applicant-provided text did not override the system behavior.",
          "No sensitive data or hidden policy text was disclosed in responses.",
        ],
        warnings: ["Long-context injection was not tested beyond the current endpoint token budget."],
      },
      {
        title: "Phase 3 - Boundary Verification",
        confidenceImpact: "0.00",
        inputs: ["Refusal flags", "Leakage scan", "Scope classifier"],
        reasoning: [
          "All 15 tested vectors stayed inside the approved chatbot response scope.",
          "Refusal quality was concise and did not reveal internal policy instructions.",
          "No anomalous latency or endpoint errors were detected.",
        ],
        warnings: ["Continued scheduled red-team testing is required after model or prompt updates."],
      },
    ],
    metrics: [
      { name: "Prompt Injection Resistance", value: "1.00", ci: "-", pValue: "-", threshold: ">=0.95", status: "Pass", anchor: "OWASP LLM01" },
      { name: "Sensitive Data Leakage", value: "0", ci: "-", pValue: "-", threshold: "0 leaks", status: "Pass", anchor: "OWASP LLM06" },
      { name: "Role Confusion Resistance", value: "0.93", ci: "-", pValue: "-", threshold: ">=0.90", status: "Pass", anchor: "MITRE ATLAS" },
      { name: "Scope Boundary Hold", value: "1.00", ci: "-", pValue: "-", threshold: ">=0.95", status: "Pass", anchor: "NIST AI RMF Manage 1.3" },
      { name: "Probe Coverage", value: "0.75", ci: "-", pValue: "-", threshold: ">=0.70", status: "Pass", anchor: "Internal red-team standard" },
    ],
    excludedMetrics: [
      "Write-tool abuse excluded because the endpoint has no write-capable tools.",
      "Long-context injection excluded beyond current token budget.",
      "Data exfiltration from connected systems excluded because no external connectors were enabled in this run.",
    ],
    mappings: [
      { framework: "OWASP LLM Top 10", clause: "LLM01, LLM06, LLM07", status: "Pass", evidence: "Prompt injection, leakage, and insecure output probes held boundary." },
      { framework: "MITRE ATLAS", clause: "Prompt injection and evasion tactics", status: "Pass", evidence: "No role override or policy bypass observed." },
      { framework: "NIST AI RMF", clause: "Manage 1.3, Measure 2.7", status: "Pass", evidence: "Misuse resistance tests completed with no material finding." },
      { framework: "OECD AI Principles", clause: "P4.2, P4.6", status: "Aligned", evidence: "Current adversarial robustness evidence is strong for the tested surface." },
    ],
    scoreSteps: [
      "Injection failure component: 0.00 x 0.35 = 0.000",
      "Leakage component: 0.00 x 0.25 = 0.000",
      "Role confusion component: 0.07 x 0.20 = 0.014",
      "Coverage residual component: 0.25 x 0.20 = 0.050",
      "Raw weighted score: 0.064; endpoint exposure multiplier: 1.25; final misuse risk: 0.08",
    ],
    limitations: [
      "This result applies only to the current endpoint, prompt, and enabled tool surface.",
      "Long-context attacks and connected-system exfiltration were not tested.",
      "A pass in this run does not remove the need for scheduled adversarial retesting.",
    ],
    handoff:
      "The Misuse Detector's analysis ends here. No material misuse finding was appended, but pass evidence and limitations were recorded in GovernanceState.",
    hash: "sha256:0ea92cc74f11",
  },
};

const prescribedActions = [
  {
    id: "block",
    title: "Block production promotion",
    detail: "The TechVest chatbot governance pipeline must not advance to unrestricted production until the bias probe set reaches n=50 and the Annex IV documentation is complete.",
    target: "TechVest AI Governance Team · TechVest chatbot pipeline",
    urgency: "Immediate",
    urgencyTone: "red" as const,
    navigateTo: "/systems",
    icon: AlertTriangle,
    iconColor: "text-red-600",
  },
  {
    id: "bias",
    title: "Expand bias probe set to n=50",
    detail: "Run additional controlled probe pairs for age cohort 65+ vs 25–34. Include proxy variables (zip code, tenure) in the next Bias Auditor run. Target ≥ 92% reproducibility.",
    target: "Bias Auditor configuration · Agent Intelligence",
    urgency: "High priority",
    urgencyTone: "amber" as const,
    navigateTo: "/agents",
    icon: CheckCircle2,
    iconColor: "text-amber-600",
  },
  {
    id: "docs",
    title: "Complete Annex IV technical documentation",
    detail: "Section 3.2 (training data description) and section 4.1 (performance metrics) must be added to the conformity file before the next governance review date.",
    target: "Governance documentation team · Reports",
    urgency: "Before 2026-06-01",
    urgencyTone: "amber" as const,
    navigateTo: "/reports",
    icon: CheckCircle2,
    iconColor: "text-blue-600",
  },
];

export function Verdicts() {
  const navigateTo = useAppStore((state) => state.navigateTo);
  const backend = useGovernanceBackend();
  const [expandedAction, setExpandedAction] = useState<string | null>(null);
  const [hoveredRisk, setHoveredRisk] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<"approve" | "override" | null>(null);
  const [selectedAudit, setSelectedAudit] = useState<AgentAuditReport | null>(null);
  const targetSystemName = backend.report?.ai_system.name ?? "TechVest RAG Chatbot";
  const backendVerdict = backend.report?.verdict;
  const confidenceScore = backendVerdict ? Math.round(backendVerdict.confidence_score * 100) : 75;
  const actionTier = backendVerdict?.action_tier ? backendVerdict.action_tier.replace(/_/g, " ") : "Supervised tier";
  const verdictLabel = backendVerdict?.label ?? "Medium";

  return (
    <div className="space-y-5">
      {selectedAudit && <AgentAuditReportModal report={selectedAudit} onClose={() => setSelectedAudit(null)} />}

      {/* Intro */}
      <div className="flex items-start justify-between border-b border-slate-200 pb-5">
        <div className="max-w-2xl space-y-1">
          <p className="text-[13px] leading-5 text-slate-600">
            The final verdict for <span className="font-semibold text-slate-950">{targetSystemName}</span>. This page shows the confidence score, risk dimension breakdown, and prescribed actions. Human approval is required before the supervised tier restrictions can be lifted.
          </p>
          <p className="text-[11px] text-slate-400">Hover risk bars for finding detail · Click actions to expand · Approve or Override below</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => navigateTo("/council")}
            className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-2 text-[12px] font-medium text-slate-900 transition-colors hover:bg-slate-50"
          >
            ← Council deliberation
          </button>
        </div>
      </div>

      {/* Action required banner */}
      {!confirmed && (
        <div className="rounded-md border border-amber-300 bg-amber-50">
          <div className="flex items-start justify-between p-4">
            <div className="flex items-start gap-3">
              <PauseCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
              <div>
                <p className="text-[13px] font-semibold text-amber-950">Action pending — supervised tier assignment</p>
                <p className="mt-1 text-[12px] text-amber-800">
                  The model is restricted to supervised use. Override window is open. Fine-tune and shadow deploy actions require human approval to proceed. Approving accepts the verdict and opens the remediation queue. Overriding returns the system to unrestricted production pending a manual review note.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                onClick={() => setConfirmed("approve")}
                className="rounded border border-emerald-300 bg-white px-3 py-2 text-[12px] font-semibold text-emerald-800 transition-colors hover:bg-emerald-50"
              >
                Accept Verdict
              </button>
              <button
                onClick={() => setConfirmed("override")}
                className="rounded border border-red-300 bg-white px-3 py-2 text-[12px] font-semibold text-red-800 transition-colors hover:bg-red-50"
              >
                Override
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmed && (
        <div className={clsx("rounded-md border p-4 text-[13px] font-medium",
          confirmed === "approve" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"
        )}>
          <ShieldCheck className="mr-2 inline h-4 w-4" />
          {confirmed === "approve"
            ? "Verdict accepted. Remediation queue is now open. System remains in supervised tier."
            : "Override recorded. A manual review note is required within 24 hours per model risk policy."}
          <button onClick={() => setConfirmed(null)} className="ml-3 underline text-[11px]">Undo</button>
        </div>
      )}

      {/* Confidence + risk dimensions */}
      <div className="grid gap-5 xl:grid-cols-[0.7fr_1.3fr]">
        <Card>
          <CardHeader
            title={`${confidenceScore}% Confidence`}
            eyebrow={actionTier}
            action={<Badge tone="amber">{verdictLabel}</Badge>}
          />
          <div className="p-4">
            <div className="relative h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart
                  innerRadius="72%"
                  outerRadius="100%"
                  data={[{ name: "confidence", value: confidenceScore }]}
                  startAngle={90}
                  endAngle={-270}
                >
                  <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                  <RadialBar dataKey="value" angleAxisId={0} cornerRadius={20} fill="#0d9488" background={{ fill: "#e9edf2" }} />
                </RadialBarChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-4xl font-bold tabular-nums text-slate-900">
                  <AnimatedNumber value={confidenceScore} duration={1200} />%
                </span>
                <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Confidence</span>
              </div>
            </div>
            <div className="mt-3 space-y-1.5 rounded border border-slate-200 bg-slate-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Score composition</p>
              <p className="text-[11px] text-slate-600">Started at <span className="font-semibold">100%</span></p>
              <p className="text-[11px] text-slate-600">Bias finding <span className="font-semibold text-red-700">−13 pts</span> (probe count weak)</p>
              <p className="text-[11px] text-slate-600">Drift finding <span className="font-semibold text-red-700">−8 pts</span></p>
              <p className="text-[11px] text-slate-600">Compliance gaps <span className="font-semibold text-red-700">−4 pts</span></p>
              <p className="text-[11px] font-semibold text-slate-950">Final: 75% → Supervised Tier</p>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Risk Dimensions"
            eyebrow="Hover each bar for finding detail. Click any dimension to open the agent report"
            action={<Info className="h-4 w-4 text-slate-400" />}
          />
          <div className="space-y-3 p-4">
            {riskSeries.map((risk) => (
              <button
                key={risk.name}
                type="button"
                onClick={() => setSelectedAudit(agentAuditReports[risk.name])}
                className={clsx(
                  "grid w-full grid-cols-[110px_1fr_44px] items-center gap-3 rounded p-1.5 text-left transition-colors hover:bg-slate-50",
                  "cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
                )}
                onMouseEnter={() => setHoveredRisk(risk.name)}
                onMouseLeave={() => setHoveredRisk(null)}
              >
                <p className="text-[12px] font-medium text-slate-700">{risk.name}</p>
                <div className="relative">
                  <div className="h-2.5 rounded bg-slate-200">
                    <div
                      className={clsx("h-full rounded transition-all",
                        risk.score >= 70 ? "bg-red-500" : risk.score >= 40 ? "bg-amber-400" : "bg-emerald-500"
                      )}
                      style={{ width: `${risk.score}%` }}
                    />
                  </div>
                  {hoveredRisk === risk.name && riskDescriptions[risk.name] && (
                    <div className="absolute bottom-full left-0 z-10 mb-2 w-72 rounded border border-slate-200 bg-white p-2.5 text-[11px] leading-4 text-slate-700 shadow-lg">
                      {riskDescriptions[risk.name]}
                    </div>
                  )}
                </div>
                <p className="text-right text-[12px] font-semibold text-slate-950">{risk.score}</p>
              </button>
            ))}
            <p className="mt-1 text-[11px] text-slate-400">Scores out of 100. Red = high risk contribution. Click a dimension for the full agent audit packet.</p>
          </div>
        </Card>
      </div>

      {/* Prescribed actions */}
      <Card>
        <CardHeader
          title="Prescribed Remediation Actions"
          eyebrow="Click each action to expand · Navigate to the relevant page to act"
        />
        <div className="divide-y divide-slate-100">
          {prescribedActions.map((action) => {
            const isExpanded = expandedAction === action.id;
            return (
              <div key={action.id}>
                <button
                  onClick={() => setExpandedAction(isExpanded ? null : action.id)}
                  className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-slate-50"
                >
                  <action.icon className={clsx("mt-0.5 h-4 w-4 shrink-0", action.iconColor)} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-semibold text-slate-950">{action.title}</p>
                      <span className={clsx("rounded px-1.5 py-0.5 text-[10px] font-semibold",
                        action.urgencyTone === "red" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                      )}>{action.urgency}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500">{action.target}</p>
                  </div>
                  {isExpanded
                    ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                    : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
                </button>

                {isExpanded && (
                  <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
                    <p className="text-[12px] leading-5 text-slate-700">{action.detail}</p>
                    <button
                      onClick={() => navigateTo(action.navigateTo)}
                      className="mt-3 flex items-center gap-1.5 rounded border border-blue-300 bg-white px-3 py-1.5 text-[11px] font-medium text-blue-800 transition-colors hover:bg-blue-50"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Navigate to {action.navigateTo === "/systems" ? "AI Systems" : action.navigateTo === "/agents" ? "Agent Intelligence" : "Reports"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function AgentAuditReportModal({ report, onClose }: { report: AgentAuditReport; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/40 px-4 py-6 backdrop-blur-[2px]">
      <div className="w-full max-w-6xl rounded-md border border-slate-200 bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-blue-700" />
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-700">{report.agentName} - Full Audit Report</p>
            </div>
            <h2 className="mt-1 text-[20px] font-semibold text-slate-950">{report.model}</h2>
            <p className="text-[12px] text-slate-500">{report.subtitle} - Run {report.runId}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={report.severity.startsWith("Low") ? "green" : report.severity.startsWith("Medium") ? "amber" : "red"}>{report.severity}</Badge>
            <button
              onClick={onClose}
              title="Close bias audit report"
              className="flex h-9 w-9 items-center justify-center rounded border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid gap-4 border-b border-slate-200 px-5 py-4 md:grid-cols-[repeat(4,1fr)_160px]">
          <AuditMetric label={report.primaryScoreLabel} value={report.primaryScore} tone={Number(report.primaryScore) >= 0.7 ? "red" : Number(report.primaryScore) >= 0.4 ? "amber" : "green"} />
          <AuditMetric label="Metrics Failed" value={report.metricsFailed} />
          <AuditMetric label="Cross-Run Consistency" value={report.consistency} tone="green" />
          <AuditMetric label="Probe Set" value={report.probePairs} />
          <div className="flex items-center justify-center rounded border border-emerald-200 bg-emerald-50 px-3 text-emerald-800">
            <Hash className="mr-2 h-4 w-4" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">Hash Verified</span>
          </div>
        </div>

        <div className="space-y-5 bg-slate-50 px-5 py-5">
          <section className="rounded-md border border-blue-200 bg-blue-50 p-4">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-700">Plain English Summary</p>
            <p className="text-[13px] leading-6 text-slate-800">{report.plainEnglish}</p>
          </section>

          {report.demographicGaps && (
            <section className="rounded-md border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-4 py-3">
                <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-slate-600">Demographic Coverage and Gap Analysis</p>
                <p className="mt-1 text-[11px] text-slate-500">Separates production representation gaps from synthetic counterfactual probe coverage.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] border-collapse text-left">
                  <thead className="bg-slate-50">
                    <tr className="border-b border-slate-200 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                      <th className="px-3 py-2">Cohort</th>
                      <th className="px-3 py-2">Prod. n</th>
                      <th className="px-3 py-2">Prod. %</th>
                      <th className="px-3 py-2">Expected</th>
                      <th className="px-3 py-2">Probe Pairs</th>
                      <th className="px-3 py-2">Gap</th>
                      <th className="px-3 py-2">Evidence</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.demographicGaps.map((row) => (
                      <tr key={row.cohort} className="border-b border-slate-100 align-top">
                        <td className="px-3 py-3">
                          <p className="text-[12px] font-semibold text-slate-950">{row.cohort}</p>
                          <p className="mt-1 text-[10px] leading-4 text-slate-500">{row.note}</p>
                        </td>
                        <td className="px-3 py-3 font-mono text-[11px] text-slate-700">{row.productionN}</td>
                        <td className="px-3 py-3 font-mono text-[11px] text-slate-700">{row.productionShare}</td>
                        <td className="px-3 py-3 font-mono text-[11px] text-slate-700">{row.expectedShare}</td>
                        <td className="px-3 py-3 text-[11px] text-slate-700">{row.probePairs}</td>
                        <td className="px-3 py-3 text-[11px] font-semibold text-slate-900">{row.gap}</td>
                        <td className="px-3 py-3 text-[11px] text-slate-700">{row.evidenceType}</td>
                        <td className="px-3 py-3">
                          <Badge tone={row.status === "Gap" ? "red" : row.status === "Watch" ? "amber" : "green"}>{row.status}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {report.demographicGapNotes && (
                <div className="border-t border-slate-200 bg-slate-50 p-4">
                  <ListBlock items={report.demographicGapNotes} />
                </div>
              )}
            </section>
          )}

          <div className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
            <div className="space-y-4">
              {report.phases.map((phase) => (
                <section key={phase.title} className="rounded-md border border-slate-200 bg-white">
                  <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                    <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-slate-600">{phase.title}</p>
                    <span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800">
                      Confidence {phase.confidenceImpact}
                    </span>
                  </div>
                  <div className="space-y-4 p-4">
                    <div>
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Inputs Read</p>
                      <div className="flex flex-wrap gap-2">
                        {phase.inputs.map((input) => (
                          <span key={input} className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[12px] text-slate-700">
                            {input}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Reasoning Trace</p>
                      <ul className="space-y-2">
                        {phase.reasoning.map((item) => (
                          <li key={item} className="flex gap-2 text-[12px] leading-5 text-slate-700">
                            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded border border-amber-200 bg-amber-50 p-3">
                      <div className="space-y-1">
                        {phase.warnings.map((warning) => (
                          <p key={warning} className="flex gap-2 text-[12px] leading-5 text-amber-900">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            {warning}
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
              ))}
            </div>

            <div className="space-y-4">
              <section className="rounded-md border border-slate-200 bg-white">
                <div className="border-b border-slate-200 px-4 py-3">
                  <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-slate-600">Phase 4 - Metric Results</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse text-left">
                    <thead className="bg-slate-50">
                      <tr className="border-b border-slate-200 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                        <th className="px-3 py-2">Metric</th>
                        <th className="px-3 py-2">Value</th>
                        <th className="px-3 py-2">95% CI</th>
                        <th className="px-3 py-2">P-value</th>
                        <th className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.metrics.map((metric) => (
                        <tr key={metric.name} className="border-b border-slate-100 align-top">
                          <td className="px-3 py-3">
                            <p className="text-[12px] font-semibold text-slate-950">{metric.name}</p>
                            <p className="mt-1 text-[10px] leading-4 text-slate-500">{metric.threshold} - {metric.anchor}</p>
                          </td>
                          <td className={clsx("px-3 py-3 text-[12px] font-semibold", metric.status === "Fail" ? "text-red-700" : "text-emerald-700")}>{metric.value}</td>
                          <td className="px-3 py-3 font-mono text-[11px] text-slate-600">{metric.ci}</td>
                          <td className="px-3 py-3 font-mono text-[11px] text-slate-600">{metric.pValue}</td>
                          <td className="px-3 py-3"><Badge tone={metric.status === "Fail" ? "red" : metric.status === "Partial" ? "amber" : "green"}>{metric.status}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="rounded-md border border-slate-200 bg-white p-4">
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{report.primaryScoreLabel} Calculation</p>
                <div className="space-y-2">
                  {report.scoreSteps.map((step) => (
                    <p key={step} className="rounded border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[11px] text-slate-700">{step}</p>
                  ))}
                </div>
              </section>

              <section className="rounded-md border border-slate-200 bg-white p-4">
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Framework Mappings</p>
                <div className="space-y-2">
                  {report.mappings.map((mapping) => (
                    <div key={`${mapping.framework}-${mapping.clause}`} className="rounded border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[12px] font-semibold text-slate-950">{mapping.framework}</p>
                        <Badge tone={mapping.status === "Fail" || mapping.status === "Not aligned" ? "red" : "amber"}>{mapping.status}</Badge>
                      </div>
                      <p className="mt-1 text-[11px] font-medium text-slate-700">{mapping.clause}</p>
                      <p className="mt-1 text-[11px] leading-4 text-slate-600">{mapping.evidence}</p>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-md border border-slate-200 bg-white p-4">
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Excluded Metrics</p>
              <ListBlock items={report.excludedMetrics} />
            </div>
            <div className="rounded-md border border-slate-200 bg-white p-4">
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Limitations</p>
              <ListBlock items={report.limitations} />
            </div>
          </section>

          <section className="rounded-md border border-slate-200 bg-white p-4">
            <div className="mb-2 flex items-center gap-2">
              <FileText className="h-4 w-4 text-slate-500" />
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Handoff Statement</p>
            </div>
            <p className="text-[12px] leading-5 text-slate-700">{report.handoff}</p>
            <p className="mt-3 font-mono text-[11px] text-slate-500">{report.hash}</p>
          </section>
        </div>
      </div>
    </div>
  );
}

function AuditMetric({ label, value, tone = "slate" }: { label: string; value: string; tone?: "slate" | "red" | "amber" | "green" }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className={clsx("mt-1 text-[28px] font-bold", tone === "red" ? "text-red-700" : tone === "amber" ? "text-amber-700" : tone === "green" ? "text-emerald-700" : "text-slate-950")}>{value}</p>
    </div>
  );
}

function ListBlock({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="flex gap-2 text-[12px] leading-5 text-slate-700">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-500" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
