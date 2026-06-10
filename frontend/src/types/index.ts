import type { LucideIcon } from "lucide-react";

export type PageId =
  | "dashboard"
  | "systems"
  | "engine"
  | "runs"
  | "agents"
  | "council"
  | "verdicts"
  | "reports"
  | "ledger";

export type RiskTier = "High" | "Medium" | "Low";
export type RunStatus = "Running" | "Complete" | "Waiting" | "Failed";
export type FindingSeverity = "Critical" | "High" | "Medium" | "Low";

export type NavigationItem = {
  id: PageId;
  label: string;
  section: "Govern" | "Assurance";
  path: string;
  icon: LucideIcon;
  badge?: string;
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
