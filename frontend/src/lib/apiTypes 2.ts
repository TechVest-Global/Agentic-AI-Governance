// Typed mirrors of the backend Pydantic schemas (backend/app/schemas/governance.py)
// and enums (backend/app/models/enums.py). Keep these in sync with the backend.
// Mock-only until the backend is running; see INTEGRATION.md.

// ── Enums ─────────────────────────────────────────────────────────────────────

export type RiskTier = "low" | "medium" | "high";

export type AISystemStatus = "registered" | "active" | "inactive" | "archived";

export type CapabilityType =
  | "inference"
  | "retrieval"
  | "generation"
  | "action"
  | "integration"
  | "other";

export type SideEffectLevel = "none" | "read" | "write" | "destructive";

export type RunStatus =
  | "created"
  | "context_assembly"
  | "planned"
  | "metrics_running"
  | "agents_running"
  | "council_running"
  | "report_ready"
  | "completed"
  | "failed"
  | "degraded"
  | "cancelled";

export type RunPhase =
  | "created"
  | "context_assembly"
  | "adaptive_orchestrator"
  | "metric_execution"
  | "specialist_agents"
  | "deliberation_council"
  | "action_reporting";

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export type FindingStatus = "open" | "accepted" | "mitigated" | "dismissed";

export type MetricResultStatus = "pending" | "passed" | "failed" | "error" | "skipped";

export type AgentExecutionStatus = "pending" | "running" | "completed" | "failed";

export type ActionTier = "autonomous" | "supervised" | "human_review";

export type LedgerActorType = "system" | "user" | "agent" | "tool";

export type ISODateString = string;
export type UUID = string;
export type JsonObject = Record<string, unknown>;

// ── AI Systems ────────────────────────────────────────────────────────────────

export type AISystemCreate = {
  name: string;
  description?: string | null;
  owner: string;
  system_type: string;
  risk_tier?: RiskTier;
  deployment_environment?: string;
  selected_frameworks?: string[];
  model_provider?: string;
  model_name?: string | null;
  model_version?: string | null;
  target_endpoint_ref?: string | null;
  metadata_json?: JsonObject;
};

export type AISystemRead = AISystemCreate & {
  id: UUID;
  status: AISystemStatus;
  created_at: ISODateString;
  updated_at?: ISODateString | null;
};

export type AISystemCapabilityCreate = {
  name: string;
  description?: string | null;
  capability_type?: CapabilityType;
  endpoint_ref: string;
  http_method?: string;
  input_schema?: JsonObject;
  output_schema?: JsonObject;
  permissions?: string[];
  side_effect_level?: SideEffectLevel;
  requires_human_review?: boolean;
  enabled?: boolean;
  metadata_json?: JsonObject;
};

export type AISystemCapabilityRead = AISystemCapabilityCreate & {
  id: UUID;
  ai_system_id: UUID;
  created_at: ISODateString;
  updated_at?: ISODateString | null;
};

// ── Application Context Profile (sections A–E) ─────────────────────────────────

export type ApplicationContextProfileCreate = {
  identity_purpose: JsonObject;
  pre_model_controls: JsonObject;
  model_configuration: JsonObject;
  post_model_controls: JsonObject;
  integration_context: JsonObject;
};

export type ApplicationContextProfileRead = ApplicationContextProfileCreate & {
  id: UUID;
  ai_system_id: UUID;
  created_at: ISODateString;
  updated_at?: ISODateString | null;
};

// ── Evaluation Runs + lifecycle ────────────────────────────────────────────────

export type EvaluationRunCreate = {
  ai_system_id: UUID;
  selected_frameworks?: string[];
  selected_metrics?: string[];
  created_by?: string | null;
};

export type EvaluationRunRead = EvaluationRunCreate & {
  id: UUID;
  status: RunStatus;
  current_phase: RunPhase;
  started_at?: ISODateString | null;
  completed_at?: ISODateString | null;
  result_summary?: JsonObject | null;
  error_summary?: JsonObject | null;
  created_at: ISODateString;
  updated_at?: ISODateString | null;
};

export type EvaluationRunStart = { note?: string | null };
export type EvaluationRunComplete = { result_summary?: JsonObject };
export type EvaluationRunFail = { error_summary?: JsonObject };
export type EvaluationRunCancel = { reason?: string | null };

// ── Governance State (hash-chained) ────────────────────────────────────────────

export type GovernanceStateEntryCreate = {
  entry_type: string;
  source: string;
  phase: string;
  payload?: JsonObject;
};

export type GovernanceStateEntryRead = {
  id: UUID;
  run_id: UUID;
  sequence_number: number;
  entry_type: string;
  source: string;
  phase: string;
  payload: JsonObject;
  previous_hash?: string | null;
  entry_hash: string;
  created_at: ISODateString;
  updated_at?: ISODateString | null;
};

export type GovernanceStateChainVerification = {
  valid: boolean;
  entry_count: number;
  failed_sequence?: number | null;
  reason?: string | null;
};

// ── Audit Ledger (hash-chained) ─────────────────────────────────────────────────

export type AuditLedgerEntryCreate = {
  event_type: string;
  actor_type?: LedgerActorType;
  actor_id?: string | null;
  payload?: JsonObject;
};

export type AuditLedgerEntryRead = AuditLedgerEntryCreate & {
  id: UUID;
  run_id: UUID;
  sequence_number: number;
  previous_hash?: string | null;
  entry_hash: string;
  created_at: ISODateString;
  updated_at?: ISODateString | null;
};

export type AuditLedgerChainVerification = {
  valid: boolean;
  entry_count: number;
  failed_entry_id?: UUID | null;
  reason?: string | null;
};

// ── Metric results / findings / agents / verdict ────────────────────────────────

export type MetricResultRead = {
  id: UUID;
  run_id: UUID;
  ai_system_capability_id?: UUID | null;
  metric_id: string;
  dimension: string;
  tool_name: string;
  status: MetricResultStatus;
  raw_score?: number | null;
  normalized_score?: number | null;
  threshold?: number | null;
  passed?: boolean | null;
  evidence_ids: string[];
  created_at: ISODateString;
  updated_at?: ISODateString | null;
};

export type FindingRead = {
  id: UUID;
  run_id: UUID;
  ai_system_capability_id?: UUID | null;
  finding_type: string;
  title: string;
  summary: string;
  severity: Severity;
  confidence: number;
  dimension: string;
  framework_refs: string[];
  evidence_ids: string[];
  agent_name?: string | null;
  recommended_action?: string | null;
  status: FindingStatus;
  payload: JsonObject;
  created_at: ISODateString;
  updated_at?: ISODateString | null;
};

export type AgentExecutionRead = {
  id: UUID;
  run_id: UUID;
  agent_name: string;
  status: AgentExecutionStatus;
  finding_count: number;
  started_at?: ISODateString | null;
  completed_at?: ISODateString | null;
  error_summary?: JsonObject | null;
  metadata_json: JsonObject;
  created_at: ISODateString;
  updated_at?: ISODateString | null;
};

export type VerdictRead = {
  id: UUID;
  run_id: UUID;
  confidence_score: number;
  action_tier: ActionTier;
  label: string;
  synthesis?: string | null;
  objections: JsonObject[];
  reasoning?: string | null;
  required_actions: JsonObject[];
  created_at: ISODateString;
  updated_at?: ISODateString | null;
};

// ── Metric plan ─────────────────────────────────────────────────────────────────

export type MetricPlanControl = {
  framework_id: string;
  framework_name: string;
  framework_version: string;
  control_ref: string;
  control_title?: string | null;
  control_category?: string | null;
  jurisdiction?: string | null;
  evidence_requirements: string[];
  agent_names: string[];
  risk_tiers: string[];
};

export type MetricPlanItem = {
  metric_config_id: UUID;
  metric_id: string;
  name: string;
  description?: string | null;
  dimension: string;
  primary_agent?: string | null;
  tool_name?: string | null;
  framework_ids: string[];
  modality?: string | null;
  threshold_rules: JsonObject;
  scoring_config: JsonObject;
  version: string;
  controls: MetricPlanControl[];
};

export type MetricPlanRead = {
  run_id: UUID;
  ai_system_id: UUID;
  selected_frameworks: string[];
  selected_metrics: string[];
  metric_count: number;
  control_count: number;
  metrics: MetricPlanItem[];
};

// ── Consolidated governance report ───────────────────────────────────────────────

export type GovernanceReportRead = {
  run: EvaluationRunRead;
  ai_system: AISystemRead;
  context_profile?: ApplicationContextProfileRead | null;
  capabilities: AISystemCapabilityRead[];
  metric_plan: MetricPlanRead;
  agent_executions: AgentExecutionRead[];
  metric_results: MetricResultRead[];
  findings: FindingRead[];
  verdict?: VerdictRead | null;
  state_chain: GovernanceStateChainVerification;
  counts: Record<string, number>;
};

// ── Pagination helper ─────────────────────────────────────────────────────────────

export type Paginated<T> = T[]; // backend returns bare arrays with offset/limit query params
