import type { LucideIcon } from "lucide-react";

export type PageId =
  | "dashboard"
  | "systems"
  | "eval-runs"
  | "runs"
  | "metric-plan"
  | "council"
  | "findings"
  | "metric-results"
  | "verdicts"
  | "reports"
  | "evidence"
  | "ledger"
  // Developer · Configure
  | "context-profiles"
  | "capabilities"
  | "metrics-config"
  | "framework-mapping"
  | "llm-boundary"
  | "security-tools"
  // Developer · Operate
  | "governance-state"
  | "api-debug"
  // Auditor / client assurance window (3-item rail + record detail)
  | "applications"
  | "application-detail"
  | "compliance"
  | "client-reports"
  | "assurance-tools"
  // Auditor workspace — retired from nav (components retained, no longer surfaced)
  | "overview"
  | "my-assignments"
  | "review-queue"
  | "audit-systems"
  | "evidence-review"
  | "findings-review"
  | "verdict-review"
  | "compliance-reports"
  | "audit-ledger"
  | "remediation"
  | "notes-queries";

export type NavSection =
  | "Govern"
  | "Assurance"
  | "Configure"
  | "Operate"
  // Auditor workspace sections
  | "My Workspace"
  | "Review"
  | "Compliance & Reporting"
  | "Collaboration";

/** Capability flags derived from persona — the permission model for the UI. */
export type Permission =
  | "canViewTechnicalConfig"
  | "canEditAISystem"
  | "canRunEvaluation"
  | "canRunSecurityTools"
  | "canReviewFindings"
  | "canExportReports";

/**
 * Persona drives a strict, role-locked split of the product surface:
 * - `auditor`   — compliance / assurance view. No engine internals.
 * - `developer` — full governance-engine view (agents, probes, pipeline, council).
 */
export type Persona = "auditor" | "developer";

export type RiskTier = "High" | "Medium" | "Low";
export type RunStatus = "Running" | "Complete" | "Waiting" | "Failed";
export type FindingSeverity = "Critical" | "High" | "Medium" | "Low";

export type NavigationItem = {
  id: PageId;
  label: string;
  section: NavSection;
  path: string;
  icon: LucideIcon;
  badge?: string;
  /** Which personas may see this nav item. */
  personas: Persona[];
  /** Reachable and permission-checked via canAccess, but not listed in the sidebar (e.g. footer-only links). */
  hidden?: boolean;
};

export type AiSystem = {
  id: string;
  name: string;
  version: string;
  users: string;
  applicationType: string;
  domain: string;
  environment: "Production" | "Shadow" | "Staging";
  riskTier: RiskTier;
  owner: string;
  lastRun: string;
  verdict: "Pass" | "Medium" | "Blocked";
  confidence: number;
  nextReview: string;
  status: "Active" | "Shadow" | "Blocked";
};

export type GovernanceRun = {
  id: string;
  system: string;
  framework: string;
  status: RunStatus;
  progress: number;
  startedAt: string;
  probes: number;
  findings: number;
};

export type AgentStatus = {
  name: string;
  role: string;
  status: RunStatus;
  progress: number;
  probes: number;
  findings: number;
  confidence: number;
};

export type Finding = {
  id: string;
  agent: string;
  title: string;
  severity: FindingSeverity;
  framework: string;
  evidence: string;
  confidence: number;
};

export type AuditEvent = {
  id: string;
  timestamp: string;
  actor: string;
  type: string;
  description: string;
  hash: string;
  parentHash: string;
};
