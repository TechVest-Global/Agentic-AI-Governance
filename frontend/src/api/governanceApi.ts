import { useAuthStore } from "@/store/useAuthStore";

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:8000/api/v1";

function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}


export type BackendAISystem = {
  id: string;
  name: string;
  description?: string | null;
  owner: string;
  system_type: string;
  risk_tier: "low" | "medium" | "high";
  deployment_environment: string;
  selected_frameworks: string[];
  model_provider: string;
  model_name?: string | null;
  model_version?: string | null;
  target_endpoint_ref?: string | null;
  metadata_json: Record<string, unknown>;
  status: "registered" | "active" | "inactive" | "archived";
  created_at: string;
  updated_at?: string | null;
};

export type BackendAISystemCreate = {
  name: string;
  description?: string | null;
  owner: string;
  system_type: string;
  risk_tier: "low" | "medium" | "high";
  modality?: string;
  deployment_environment: string;
  selected_frameworks: string[];
  model_provider: string;
  model_name?: string | null;
  model_version?: string | null;
  target_endpoint_ref?: string | null;
  metadata_json?: Record<string, unknown>;
};

export type BackendAISystemUpdate = Partial<BackendAISystemCreate>;

export type BackendAISystemCapability = {
  id: string;
  ai_system_id: string;
  name: string;
  description?: string | null;
  capability_type: "inference" | "retrieval" | "generation" | "action" | "integration" | "other";
  endpoint_ref: string;
  http_method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  permissions: string[];
  side_effect_level: "none" | "read" | "write" | "destructive";
  requires_human_review: boolean;
  enabled: boolean;
  metadata_json: Record<string, unknown>;
  created_at: string;
  updated_at?: string | null;
};

export type BackendAISystemCapabilityCreate = Omit<
  BackendAISystemCapability,
  "id" | "ai_system_id" | "created_at" | "updated_at"
>;

/* ─── Registration form options + frameworks (backend-sourced) ─── */

export type OptionItem = { value: string; label: string };

export type RegistrationFrameworkOption = {
  framework_id: string;
  framework_name: string;
  framework_version: string;
  description: string;
  rubric_count: number;
  probe_count: number;
  coverage_count: number;
};

export type RegistrationOptions = {
  risk_tiers: OptionItem[];
  modalities: OptionItem[];
  deployment_environments: OptionItem[];
  application_types: OptionItem[];
  domains: OptionItem[];
  model_providers: OptionItem[];
  capability_types: OptionItem[];
  side_effect_levels: OptionItem[];
  http_methods: OptionItem[];
  statuses: OptionItem[];
  // Enhanced registration catalogs (Phase 1) — all optional for backward compat.
  system_types?: OptionItem[];
  business_domains?: OptionItem[];
  lifecycle_stages?: OptionItem[];
  production_criticalities?: OptionItem[];
  internal_external_use?: OptionItem[];
  output_usage?: OptionItem[];
  human_oversight?: OptionItem[];
  owner_roles?: OptionItem[];
  model_types?: OptionItem[];
  input_modalities?: OptionItem[];
  output_types?: OptionItem[];
  capability_tags?: OptionItem[];
  gateway_types?: OptionItem[];
  authentication_types?: OptionItem[];
  exposure_types?: OptionItem[];
  endpoint_statuses?: OptionItem[];
  applicability_types?: OptionItem[];
  // Phase 2 catalogs
  data_source_types?: OptionItem[];
  data_classifications?: OptionItem[];
  data_usage_purposes?: OptionItem[];
  security_controls?: OptionItem[];
  security_statuses?: OptionItem[];
  dependency_types?: OptionItem[];
  document_types?: OptionItem[];
  confidentiality_levels?: OptionItem[];
};

// ── Enhanced AI system registration (nested request + response) ───────────────

export type RegistrationSystemInput = {
  name: string;
  version?: string | null;
  description?: string | null;
  business_purpose?: string | null;
  system_type?: string | null;
  business_domain?: string | null;
  lifecycle_stage?: string | null;
  deployment_environment?: string;
  modality?: string;
  business_unit?: string | null;
  product_name?: string | null;
  internal_identifier?: string | null;
  production_criticality?: string | null;
  notes?: string | null;
};

export type RegistrationUsageContextInput = {
  primary_use_case?: string | null;
  intended_users?: string | null;
  internal_external_use?: string | null;
  output_usage?: string | null;
  human_oversight?: string | null;
  input_modalities?: string[];
  output_types?: string[];
  capabilities?: string[];
  metadata_json?: Record<string, unknown>;
};

export type RegistrationOwnerInput = {
  role: string;
  name: string;
  email?: string | null;
  is_primary?: boolean;
};

export type RegistrationModelInput = {
  name: string;
  provider: string;
  version?: string | null;
  deployment_name?: string | null;
  model_type?: string | null;
  purpose?: string | null;
  hosting_platform?: string | null;
  hosting_region?: string | null;
  base_model?: string | null;
  is_fine_tuned?: boolean;
  is_open_source?: boolean;
  is_third_party?: boolean;
  input_modalities?: string[];
  output_modalities?: string[];
  safety_filters_enabled?: boolean;
  fallback_model?: string | null;
  documentation_url?: string | null;
};

export type RegistrationEndpointInput = {
  name: string;
  url: string;
  purpose?: string | null;
  http_method?: string;
  environment?: string;
  model_ref?: string | null;
  gateway_type?: string | null;
  authentication_type?: string | null;
  exposure_type?: string | null;
  is_public?: boolean;
  input_format?: string | null;
  output_format?: string | null;
  rate_limit?: number | null;
  timeout_seconds?: number | null;
  logging_enabled?: boolean;
  monitoring_enabled?: boolean;
  pii_allowed?: boolean;
  retention_days?: number | null;
  status?: string;
};

export type RegistrationFrameworkInput = {
  framework_id: string;
  applicability_type?: string;
  applicability_note?: string | null;
};

export type RegistrationRiskScreeningInput = {
  answers: Record<string, "yes" | "no" | "unknown">;
};

export type RegistrationDataSourceInput = {
  name: string;
  source_type?: string | null;
  classification?: string | null;
  usage_purpose?: string | null;
  data_owner?: string | null;
  source_location?: string | null;
  residency?: string | null;
  retention_days?: number | null;
  used_for_training?: boolean;
  used_for_fine_tuning?: boolean;
  used_for_inference?: boolean;
  used_for_rag?: boolean;
  external_sharing?: boolean;
  contains_personal_data?: boolean;
  contains_sensitive_personal_data?: boolean;
  contains_confidential_data?: boolean;
  contains_health_data?: boolean;
  contains_financial_data?: boolean;
  contains_biometric_data?: boolean;
  contains_minors_data?: boolean;
};

export type RegistrationRAGConfigInput = {
  knowledge_base_name?: string | null;
  vector_database?: string | null;
  embedding_model?: string | null;
  reranking_model?: string | null;
  retrieval_strategy?: string | null;
  top_k?: number | null;
  citations_enabled?: boolean;
  access_control_applied?: boolean;
  document_refresh_frequency?: string | null;
};

export type RegistrationAgentConfigInput = {
  agent_purpose?: string | null;
  num_agents?: number | null;
  tools_used?: string[];
  external_systems?: string[];
  read_access?: boolean;
  write_access?: boolean;
  can_send_messages?: boolean;
  can_modify_files?: boolean;
  can_write_database?: boolean;
  can_execute_code?: boolean;
  human_approval_required?: boolean;
  max_steps?: number | null;
  max_execution_seconds?: number | null;
  persistent_memory_enabled?: boolean;
};

export type RegistrationSecurityControlInput = {
  control_key: string;
  implementation_status?: string;
  notes?: string | null;
};

export type RegistrationDependencyInput = {
  name: string;
  service_purpose?: string | null;
  dependency_type?: string | null;
  data_shared?: string | null;
  hosting_region?: string | null;
  is_critical?: boolean;
  is_third_party_api?: boolean;
  contract_sla_available?: boolean;
  exit_option?: string | null;
};

export type RegistrationDocumentInput = {
  name: string;
  document_type?: string | null;
  version?: string | null;
  document_owner?: string | null;
  related_framework?: string | null;
  confidentiality_level?: string | null;
  storage_ref?: string | null;
  content_type?: string | null;
  file_size?: number | null;
  notes?: string | null;
};

export type AISystemRegistrationCreate = {
  status: "draft" | "registered";
  system: RegistrationSystemInput;
  usage_context?: RegistrationUsageContextInput | null;
  owners?: RegistrationOwnerInput[];
  models?: RegistrationModelInput[];
  endpoints?: RegistrationEndpointInput[];
  frameworks?: RegistrationFrameworkInput[];
  risk_screening?: RegistrationRiskScreeningInput | null;
  data_sources?: RegistrationDataSourceInput[];
  rag_configuration?: RegistrationRAGConfigInput | null;
  agent_configuration?: RegistrationAgentConfigInput | null;
  security_posture?: RegistrationSecurityControlInput[];
  dependencies?: RegistrationDependencyInput[];
  documents?: RegistrationDocumentInput[];
};

export type AISystemRegistrationRead = {
  system: BackendAISystem;
  usage_context?: Record<string, unknown> | null;
  owners: Array<Record<string, unknown>>;
  models: Array<Record<string, unknown>>;
  endpoints: Array<Record<string, unknown>>;
  frameworks: Array<Record<string, unknown>>;
  capabilities: BackendAISystemCapability[];
  risk_screening?: Record<string, unknown> | null;
  data_sources: Array<Record<string, unknown>>;
  rag_configuration?: Record<string, unknown> | null;
  agent_configuration?: Record<string, unknown> | null;
  security_posture: Array<Record<string, unknown>>;
  dependencies: Array<Record<string, unknown>>;
  documents: Array<Record<string, unknown>>;
  preliminary_risk_score: number;
  preliminary_risk_tier: string;
  triggered_risk_factors: string[];
  profile_completeness: number;
  missing_recommended_fields: string[];
  registration_status: "draft" | "registered";
};

export type EvaluationRun = {
  id: string;
  ai_system_id: string;
  selected_frameworks: string[];
  selected_metrics: string[];
  status: string;
  current_phase: string;
  started_at?: string | null;
  completed_at?: string | null;
  result_summary?: Record<string, unknown> | null;
  error_summary?: Record<string, unknown> | null;
  // Metric-plan approval gate: set once a reviewer approves a paused run.
  // A run awaiting approval has status === "planned" and plan_approved_at == null.
  plan_approved_at?: string | null;
  plan_approved_by?: string | null;
  created_at: string;
  updated_at?: string | null;
};

export type VerdictObjection = {
  objection_id: string;
  target_agent?: string | null;
  category: string;
  argument: string;
  suggested_fix: string;
  remediation_hint?: string | null;
};

export type VerdictRequiredAction = {
  action: string;
  severity: string;
  owner: string;
  context?: string | null;
};

export type Verdict = {
  id: string;
  run_id: string;
  confidence_score: number;
  action_tier: string;
  label: string;
  synthesis?: string | null;
  objections: VerdictObjection[];
  reasoning?: string | null;
  required_actions: VerdictRequiredAction[];
  created_at: string;
};

export type GovernanceReport = {
  run: EvaluationRun;
  ai_system: BackendAISystem;
  context_profile?: ContextProfile | null;
  capabilities: BackendAISystemCapability[];
  metric_plan?: RunMetricPlan;
  agent_executions: AgentExecution[];
  evidence: EvidenceRecord[];
  metric_results: MetricResult[];
  findings: BackendFinding[];
  verdict?: Verdict | null;
  counts: Record<string, number>;
  state_chain: {
    valid: boolean;
    entry_count: number;
  };
};

export type FrameworkControlAssessment = {
  framework_id: string;
  framework_name: string;
  framework_version: string;
  control_ref: string;
  control_title?: string | null;
  control_category?: string | null;
  jurisdiction?: string | null;
  /** Hydrated in auditor views from /framework-mappings when available. */
  requirement_text?: string | null;
  status: "passed" | "failed" | "needs_review" | "not_evaluated";
  metric_ids: string[];
  passed_metric_count: number;
  failed_metric_count: number;
  pending_metric_count: number;
  finding_count: number;
  highest_severity?: FindingSeverity | null;
  evidence_requirements: string[];
  metric_results: MetricResult[];
  findings: BackendFinding[];
};

export type FrameworkComplianceMap = {
  run_id: string;
  ai_system_id: string;
  selected_frameworks: string[];
  control_count: number;
  status_counts: Record<string, number>;
  controls: FrameworkControlAssessment[];
};

export type AgentExecution = {
  id: string;
  run_id: string;
  agent_name: string;
  status: "pending" | "running" | "completed" | "failed";
  finding_count: number;
  started_at?: string | null;
  completed_at?: string | null;
  error_summary?: Record<string, unknown> | null;
  metadata_json: Record<string, unknown>;
};

export type AuditLedgerEntry = {
  id: string;
  run_id: string;
  event_type: string;
  actor_type: string;
  actor_id?: string | null;
  payload: Record<string, unknown>;
  previous_hash?: string | null;
  entry_hash: string;
  created_at: string;
};

export type AuditLedgerVerification = {
  valid: boolean;
  entry_count: number;
  failed_entry_id?: string | null;
  reason?: string | null;
};

export type CouncilDeliberation = {
  run_id: string;
  verdict: Verdict;
  finding_count: number;
  open_finding_count: number;
  metric_result_count: number;
  failed_metric_count: number;
  pending_metric_count: number;
  highest_severity?: string | null;
  created_verdict: boolean;
};

export type FindingSeverity = "info" | "low" | "medium" | "high" | "critical";

export type FindingToolCall = {
  tool_name: string;
  metric_id: string;
  formula: string;
  status: string;
  normalized_score: number | null;
  passed: boolean | null;
};

export type BackendFinding = {
  id: string;
  run_id: string;
  finding_type: string;
  title: string;
  summary: string;
  severity: FindingSeverity;
  confidence: number;
  dimension: string;
  framework_refs: string[];
  evidence_ids: string[];
  agent_name?: string | null;
  recommended_action?: string | null;
  status: string;
  payload?: { tool_calls?: FindingToolCall[]; [key: string]: unknown } | null;
  created_at: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed with ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export type MetricConfig = {
  id: string;
  metric_id: string;
  name: string;
  dimension: string;
  primary_agent: string;
  framework_ids: string[];
  enabled: boolean;
};

export type EvaluationRunCreatePayload = {
  ai_system_id: string;
  selected_frameworks: string[];
  selected_metrics: string[];
  // Capability endpoint_refs to scope the audit to. Empty = whole application.
  selected_capabilities?: string[];
};

export type OrchestrationResult = {
  run_id: string;
  metric_execution: { metric_results_created: number; evidence_created: number };
  agent_run: { findings_created: number; agents_run: Array<{ agent_name: string }> };
  council: CouncilDeliberation;
  report: GovernanceReport;
};

export async function getLatestEvaluationRun(): Promise<EvaluationRun | null> {
  // Fetch a small page (newest first) and prefer the most recent run that has
  // actually started, so a stray/aborted "created" row doesn't hijack the Live
  // Run view and pin it to "Run Setup" forever. Fall back to the newest overall
  // only when nothing has started yet.
  const runs = await request<EvaluationRun[]>("/evaluation-runs?limit=10");
  if (runs.length === 0) return null;
  const started = runs.find(
    (r) => r.status !== "created" && r.current_phase !== "created",
  );
  return started ?? runs[0];
}

export async function listMetrics(): Promise<MetricConfig[]> {
  return request<MetricConfig[]>("/metrics?enabled=true&limit=100");
}

export async function createEvaluationRun(payload: EvaluationRunCreatePayload): Promise<EvaluationRun> {
  return request<EvaluationRun>("/evaluation-runs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function orchestrateRun(runId: string): Promise<{ run_id: string; status: string }> {
  return request<{ run_id: string; status: string }>(`/evaluation-runs/${runId}/orchestrate`, {
    method: "POST",
    // logs omitted here: the backend synthesizes a deterministic, system-specific
    // production-log sample when a run supplies none, so Context Assembly and the
    // adaptive orchestrator get real per-system evidence instead of an empty result.
    // (A user-uploaded log sample would be passed here to override the synthesizer.)
    // evaluator_name: "auto" routes each metric to the real tool its own config names
    // (garak/presidio/ragas/deepeval), falling back to deterministic threshold scoring
    // for metrics whose tool has no real integration yet (langfuse/evidently/promptfoo).
    //
    // No force_metric_status: each metric now reports its REAL status (passed/failed
    // from score-vs-threshold) instead of every result being forced to "failed".
    // mock_score: 0.5 is the threshold evaluator's "no external score supplied"
    // sentinel — it derives a conservative score from each metric's own threshold so
    // fallback metrics surface as borderline rather than a blanket pass or fail.
    // require_plan_approval: pause after the orchestrator builds the metric plan
    // so a human reviews & approves it (POST approve-plan) before probes run. This
    // is the human-in-the-loop oversight gate surfaced on the Metric Plan page.
    body: JSON.stringify({ mock_score: 0.5, evaluator_name: "auto", requested_by: "frontend", notes: "Triggered from UI.", require_plan_approval: true }),
  });
}

/** A run paused for human plan approval: parked at 'planned', not yet approved. */
export function isAwaitingApproval(run: Pick<EvaluationRun, "status" | "plan_approved_at">): boolean {
  return run.status === "planned" && !run.plan_approved_at;
}

/**
 * Approve a paused metric plan and resume the run's pipeline.
 *
 * Pass `selectedMetrics` to override the orchestrator's selection with a
 * hand-picked subset (must be non-empty); omit it to approve the plan as-is.
 */
export async function approvePlan(
  runId: string,
  approval: { approvedBy?: string; notes?: string; selectedMetrics?: string[] } = {},
): Promise<EvaluationRun> {
  return request<EvaluationRun>(`/evaluation-runs/${runId}/approve-plan`, {
    method: "POST",
    body: JSON.stringify({
      approved_by: approval.approvedBy,
      notes: approval.notes,
      selected_metrics: approval.selectedMetrics ?? null,
    }),
  });
}

export async function listEvaluationRuns(limit = 25): Promise<EvaluationRun[]> {
  return request<EvaluationRun[]>(`/evaluation-runs?limit=${limit}`);
}

export async function getGovernanceReport(runId: string): Promise<GovernanceReport> {
  return request<GovernanceReport>(`/evaluation-runs/${runId}/report`);
}

export async function getFindings(runId: string): Promise<BackendFinding[]> {
  return request<BackendFinding[]>(`/evaluation-runs/${runId}/findings?limit=100`);
}

export async function getFrameworkMap(runId: string): Promise<FrameworkComplianceMap> {
  return request<FrameworkComplianceMap>(`/evaluation-runs/${runId}/framework-map`);
}

export async function getAgentExecutions(runId: string): Promise<AgentExecution[]> {
  return request<AgentExecution[]>(`/evaluation-runs/${runId}/agents/executions`);
}

export async function getAuditLedger(runId: string): Promise<AuditLedgerEntry[]> {
  return request<AuditLedgerEntry[]>(`/evaluation-runs/${runId}/ledger`);
}

export async function verifyAuditLedger(runId: string): Promise<AuditLedgerVerification> {
  return request<AuditLedgerVerification>(`/evaluation-runs/${runId}/ledger/verify`);
}

export async function runCouncilDeliberation(runId: string): Promise<CouncilDeliberation> {
  return request<CouncilDeliberation>(`/evaluation-runs/${runId}/council/deliberate`, {
    method: "POST",
    body: JSON.stringify({
      requested_by: "frontend",
      notes: "Triggered from Council Deliberation page.",
    }),
  });
}

export async function listAISystems(): Promise<BackendAISystem[]> {
  return request<BackendAISystem[]>("/ai-systems");
}

export async function createAISystem(payload: BackendAISystemCreate): Promise<BackendAISystem> {
  return request<BackendAISystem>("/ai-systems", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateAISystem(systemId: string, payload: BackendAISystemUpdate): Promise<BackendAISystem> {
  return request<BackendAISystem>(`/ai-systems/${systemId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteAISystem(systemId: string): Promise<void> {
  await request<void>(`/ai-systems/${systemId}`, {
    method: "DELETE",
  });
}

export type AssessmentRequestStatus = "pending" | "in_progress" | "resolved" | "dismissed";

export type AssessmentRequest = {
  id: string;
  ai_system_id: string;
  note?: string | null;
  status: AssessmentRequestStatus;
  requested_by_name: string;
  requested_by_email: string;
  requested_by_role: string;
  resolved_run_id?: string | null;
  resolved_at?: string | null;
  created_at: string;
  updated_at?: string | null;
};

/** Auditor → developer "request re-assessment" ask. Auditors never trigger
 * runs directly; this is the structured request that stands in for that. */
export async function createAssessmentRequest(
  systemId: string,
  payload: { note?: string },
): Promise<AssessmentRequest> {
  return request<AssessmentRequest>(`/ai-systems/${systemId}/assessment-requests`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listAssessmentRequests(systemId: string): Promise<AssessmentRequest[]> {
  return request<AssessmentRequest[]>(`/ai-systems/${systemId}/assessment-requests`);
}

/** Cross-system inbox feed — powers the top-bar requests inbox and its badge. */
export async function listAllAssessmentRequests(
  statuses?: AssessmentRequestStatus[],
): Promise<AssessmentRequest[]> {
  const params = new URLSearchParams();
  for (const s of statuses ?? []) params.append("status", s);
  const qs = params.toString();
  return request<AssessmentRequest[]>(`/assessment-requests${qs ? `?${qs}` : ""}`);
}

export async function updateAssessmentRequestStatus(
  requestId: string,
  payload: { status: AssessmentRequestStatus; resolved_run_id?: string },
): Promise<AssessmentRequest> {
  return request<AssessmentRequest>(`/assessment-requests/${requestId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function createAISystemCapability(
  systemId: string,
  payload: BackendAISystemCapabilityCreate,
): Promise<BackendAISystemCapability> {
  return request<BackendAISystemCapability>(`/ai-systems/${systemId}/capabilities`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Register a complete AI system (nested facts) — derives a preliminary risk tier. */
export async function registerAISystem(
  payload: AISystemRegistrationCreate,
): Promise<AISystemRegistrationRead> {
  return request<AISystemRegistrationRead>("/ai-systems/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Fetch the complete nested registration record for an AI system. */
export async function getAISystemRegistration(
  systemId: string,
): Promise<AISystemRegistrationRead> {
  return request<AISystemRegistrationRead>(`/ai-systems/${systemId}/registration`);
}

/** Applicable governance frameworks the platform implements (for registration). */
export async function listRegistrationFrameworks(): Promise<RegistrationFrameworkOption[]> {
  return request<RegistrationFrameworkOption[]>("/governance-config/frameworks");
}

/** Backend-sourced dropdown options for the registration form. */
export async function getRegistrationOptions(): Promise<RegistrationOptions> {
  return request<RegistrationOptions>("/governance-config/options");
}

/* ──────────────────────────────────────────────────────────── Evidence ── */

export type EvidenceRecord = {
  id: string;
  run_id: string;
  ai_system_capability_id?: string | null;
  source_type: string;
  source_name: string;
  tool_name?: string | null;
  raw_score?: number | null;
  normalized_score?: number | null;
  threshold?: number | null;
  passed?: boolean | null;
  trace_id?: string | null;
  sensitivity?: string | null;
  payload?: Record<string, unknown> | null;
  created_at: string;
};

export async function listEvidence(
  runId: string,
  params: { source_type?: string; source_name?: string; limit?: number } = {},
): Promise<EvidenceRecord[]> {
  const query = new URLSearchParams({ limit: String(params.limit ?? 100) });
  if (params.source_type) query.set("source_type", params.source_type);
  if (params.source_name) query.set("source_name", params.source_name);
  return request<EvidenceRecord[]>(`/evaluation-runs/${runId}/evidence?${query.toString()}`);
}

export async function getEvidence(runId: string, evidenceId: string): Promise<EvidenceRecord> {
  return request<EvidenceRecord>(`/evaluation-runs/${runId}/evidence/${evidenceId}`);
}

/* ─────────────────────────────────────────────────────────── Verdict ── */

/** Fetch the single verdict for a run (404 → null). */
export async function getRunVerdict(runId: string): Promise<Verdict | null> {
  try {
    return await request<Verdict>(`/evaluation-runs/${runId}/verdict`);
  } catch {
    return null;
  }
}

/* ──────────────────────────────────────────────────────── Metric plan ── */

export type RunMetricPlanEntry = {
  metric_id: string;
  name: string;
  dimension: string;
  tool_name?: string | null;
  primary_agent?: string | null;
  framework_ids: string[];
  probe_budget?: number | null;
  threshold?: number | null;
  enabled: boolean;
};

export type RunMetricPlan = {
  run_id: string;
  ai_system_id: string;
  selected_frameworks: string[];
  metric_count: number;
  control_count: number;
  metrics: RunMetricPlanEntry[];
};

export async function getRunMetricPlan(runId: string): Promise<RunMetricPlan> {
  return request<RunMetricPlan>(`/evaluation-runs/${runId}/metric-plan`);
}

/* ────────────────────────────────────────────── Evaluation plan (orchestrator) ── */

export type AgentPlanItem = {
  agent_name: string;
  activated: boolean;
  priority: "high" | "medium" | "low";
  probe_budget: number;
  assigned_metric_ids: string[];
  target_dimensions: string[];
  target_controls: string[];
  coverage_gap_ids: string[];
  instructions: string;
  rationale: string;
};

export type PriorityTarget = {
  dimension: string;
  severity: string;
  reason: string;
  control_refs: string[];
  gap_ids: string[];
};

export type EvaluationPlanRead = {
  run_id: string;
  ai_system_id: string;
  state_sequence_number: number;
  state_entry_hash: string;
  generated_at: string;
  risk_tier: string;
  selected_frameworks: string[];
  metric_count: number;
  coverage_gap_count: number;
  probe_budget_total: number;
  probe_budget_allocated: number;
  activated_agents: AgentPlanItem[];
  priority_targets: PriorityTarget[];
  risk_rationale: string;
  counts: Record<string, number>;
};

export async function getEvaluationPlan(runId: string): Promise<EvaluationPlanRead | null> {
  try {
    return await request<EvaluationPlanRead>(`/evaluation-runs/${runId}/evaluation-plan`);
  } catch {
    return null;
  }
}

/* ────────────────────────────────────────────── Context assembly ── */

export type CoverageGapRead = {
  gap_id: string;
  framework_id: string;
  category: string;
  dimension: string;
  severity: string;
  description: string;
  control_refs: string[];
  recommended_probe_id?: string | null;
  recommended_action: string;
  expected: string[];
  observed: string[];
};

export type LogAnalysisSummary = {
  total_requests: number;
  empty: boolean;
  request_category_counts: Record<string, number>;
  demographic_coverage: Record<string, number>;
  jurisdiction_coverage: Record<string, number>;
  outcome_counts: Record<string, number>;
  modality_counts: Record<string, number>;
  pii_request_count: number;
  flagged_request_count: number;
  distinct_request_categories: number;
  distinct_demographic_groups: number;
  distinct_jurisdictions: number;
  distinct_outcomes: number;
  observed_request_categories: string[];
  observed_demographic_groups: string[];
};

export type RegulatoryContextRead = {
  selected_frameworks: string[];
  resolved_frameworks: string[];
  missing_frameworks: string[];
  control_count: number;
};

export type ContextAssemblyRead = {
  run_id: string;
  state_sequence_number: number;
  state_entry_hash: string;
  generated_at: string;
  log_analysis: LogAnalysisSummary;
  regulatory_context: RegulatoryContextRead;
  coverage_gaps: CoverageGapRead[];
  gap_count: number;
  highest_gap_severity?: string | null;
  counts: Record<string, number>;
  /** Provenance, e.g. "Log source: synthesized (12 record(s))." when no logs were uploaded. */
  notes?: string | null;
};

export async function getContextAssembly(runId: string): Promise<ContextAssemblyRead | null> {
  try {
    return await request<ContextAssemblyRead>(`/evaluation-runs/${runId}/context-assembly`);
  } catch {
    return null;
  }
}

/* ─────────────────────────────────────────────────── Context profile ── */

export type ContextProfile = {
  id: string;
  ai_system_id: string;
  identity_purpose: Record<string, unknown>;
  pre_model_controls: Record<string, unknown>;
  model_configuration: Record<string, unknown>;
  post_model_controls: Record<string, unknown>;
  integration_context: Record<string, unknown>;
  created_at?: string;
  updated_at?: string | null;
};

export async function getContextProfile(systemId: string): Promise<ContextProfile | null> {
  try {
    return await request<ContextProfile>(`/ai-systems/${systemId}/context-profile`);
  } catch {
    return null;
  }
}

export async function upsertContextProfile(
  systemId: string,
  payload: Partial<Omit<ContextProfile, "id" | "ai_system_id" | "created_at" | "updated_at">>,
): Promise<ContextProfile> {
  return request<ContextProfile>(`/ai-systems/${systemId}/context-profile`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function listCapabilities(systemId: string): Promise<BackendAISystemCapability[]> {
  return request<BackendAISystemCapability[]>(`/ai-systems/${systemId}/capabilities?limit=100`);
}

export type CatalogImportResult = {
  system_id: string;
  catalog_name?: string | null;
  total: number;
  imported: number;
  skipped: number;
  capabilities: Array<{ id: string; name: string; endpoint_ref: string; http_method: string }>;
};

/** Import all of a multi-endpoint target's functions as capabilities, from its
 *  gateway catalog (idempotent). */
export async function importCapabilitiesFromCatalog(systemId: string): Promise<CatalogImportResult> {
  return request<CatalogImportResult>(`/ai-systems/${systemId}/capabilities/import-from-catalog`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

/* ─────────────────────────────────────────────────── Metric results ── */

export type MetricResult = {
  id: string;
  run_id: string;
  metric_id: string;
  dimension: string;
  tool_name?: string | null;
  status: string;
  raw_score?: number | null;
  normalized_score?: number | null;
  threshold?: number | null;
  passed?: boolean | null;
  evidence_ids: string[];
  ai_system_capability_id?: string | null;
  created_at: string;
};

export async function listMetricResults(runId: string, limit = 100): Promise<MetricResult[]> {
  return request<MetricResult[]>(`/evaluation-runs/${runId}/metric-results?limit=${Math.min(limit, 100)}`);
}

/* ─────────────────────────────────────────────── Governance state ── */

export type GovernanceStateEntry = {
  id: string;
  run_id: string;
  entry_type: string;
  source: string;
  phase: string;
  sequence_number: number;
  payload?: Record<string, unknown> | null;
  previous_hash?: string | null;
  entry_hash: string;
  created_at: string;
};

export type ChainVerification = {
  valid: boolean;
  entry_count: number;
  failed_sequence?: number | null;
  failed_entry_id?: string | null;
  reason?: string | null;
};

export async function listGovernanceState(runId: string, limit = 200): Promise<GovernanceStateEntry[]> {
  return request<GovernanceStateEntry[]>(`/evaluation-runs/${runId}/state?limit=${limit}`);
}

export async function verifyGovernanceState(runId: string): Promise<ChainVerification> {
  return request<ChainVerification>(`/evaluation-runs/${runId}/state/verify`);
}

/* ───────────────────────────────────────────── Framework mappings ── */

export type FrameworkMapping = {
  id: string;
  framework_id: string;
  framework_name: string;
  framework_version?: string | null;
  control_ref: string;
  control_title?: string | null;
  control_category?: string | null;
  jurisdiction?: string | null;
  requirement_text?: string | null;
  metric_ids: string[];
  agent_names?: string[];
  risk_tiers?: string[];
  evidence_requirements?: string[];
  enabled: boolean;
  metadata_json?: Record<string, unknown>;
};

export async function listFrameworkMappings(params: { framework_id?: string; limit?: number } = {}): Promise<FrameworkMapping[]> {
  const query = new URLSearchParams({ limit: String(Math.min(params.limit ?? 100, 100)) });
  if (params.framework_id) query.set("framework_id", params.framework_id);
  return request<FrameworkMapping[]>(`/framework-mappings?${query.toString()}`);
}

/* ────────────────────────────────────────────── Metric configs ── */

export type MetricConfigFull = {
  id: string;
  metric_id: string;
  name: string;
  description?: string | null;
  dimension: string;
  primary_agent?: string | null;
  tool_name?: string | null;
  framework_ids: string[];
  modality?: string | null;
  threshold_rules?: Record<string, unknown> | null;
  scoring_config?: Record<string, unknown> | null;
  version?: string | null;
  enabled: boolean;
  metadata_json?: Record<string, unknown>;
};

export async function listMetricConfigs(params: { dimension?: string; framework_id?: string; limit?: number } = {}): Promise<MetricConfigFull[]> {
  const query = new URLSearchParams({ limit: String(Math.min(params.limit ?? 100, 100)) });
  if (params.dimension) query.set("dimension", params.dimension);
  if (params.framework_id) query.set("framework_id", params.framework_id);
  return request<MetricConfigFull[]>(`/metrics?${query.toString()}`);
}

/* ──────────────────────────────────────────────── LLM call log ── */

export type LlmCall = {
  id: string;
  run_id: string;
  agent_name?: string | null;
  task: string;
  call_type: string;
  model?: string | null;
  deployment_name?: string | null;
  client_mode: string;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  estimated_cost_usd?: number | null;
  latency_ms?: number | null;
  status: string;
  request_chars?: number | null;
  response_chars?: number | null;
  trace_id?: string | null;
  policy_flags?: unknown[];
  created_at: string;
  prompt_text?: string | null;
  response_text?: string | null;
};

export type LlmCallLog = {
  run_id: string;
  call_count: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_tokens: number;
  estimated_total_cost_usd: number;
  live_call_count: number;
  mock_call_count: number;
  error_count: number;
  calls: LlmCall[];
};

export async function getLlmCalls(runId: string): Promise<LlmCallLog> {
  return request<LlmCallLog>(`/evaluation-runs/${runId}/llm-calls`);
}

/* ──────────────────────────────────────── Execution artifacts ── */

export type ExecutionArtifact = {
  id: string;
  run_id: string;
  agent_name: string;
  dimension?: string | null;
  capability_name?: string | null;
  endpoint_ref: string;
  prompt_text: string;
  response_text: string;
  media_kind: string; // "image" | "audio" | "video"
  mime_type: string;
  has_media: boolean;
  source_url?: string | null;
  created_at: string;
};

export async function getExecutionArtifacts(runId: string): Promise<ExecutionArtifact[]> {
  return request<ExecutionArtifact[]>(`/evaluation-runs/${runId}/execution-artifacts`);
}

/** Direct <img>/<video>/<audio> src for one artifact's media bytes — a GET,
 * so it never needs the bearer token these tags can't attach anyway. */
export function executionArtifactMediaUrl(runId: string, artifactId: string): string {
  return `${API_BASE_URL}/evaluation-runs/${runId}/execution-artifacts/${artifactId}/media`;
}

/* ───────────────────────────────────────────── Run lifecycle ── */

export async function startRun(runId: string): Promise<EvaluationRun> {
  return request<EvaluationRun>(`/evaluation-runs/${runId}/start`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function cancelRun(runId: string): Promise<EvaluationRun> {
  return request<EvaluationRun>(`/evaluation-runs/${runId}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason: "Cancelled from frontend." }),
  });
}

export async function getEvaluationRun(runId: string): Promise<EvaluationRun> {
  return request<EvaluationRun>(`/evaluation-runs/${runId}`);
}

/* ─────────────────────────────────────────── Security tools ── */

export type SecurityAdapterStatus = {
  key: string;
  name: string;
  category: string;
  description: string;
  kind: "real" | "tracing" | "deterministic" | "not_wired";
  dependency: string | null;
  dependency_installed: boolean;
  configured: boolean;
  available: boolean;
  detail: string;
};

export type SecurityToolsStatus = {
  target_client: { mode: string; adapter: string; live: boolean };
  adapters: SecurityAdapterStatus[];
  summary: { total: number; available: number; real: number };
};

export async function getSecurityTools(aiSystemId?: string): Promise<SecurityToolsStatus> {
  const query = aiSystemId ? `?ai_system_id=${encodeURIComponent(aiSystemId)}` : "";
  return request<SecurityToolsStatus>(`/security-tools${query}`);
}

export type SecurityToolRunResult = {
  adapter: string;
  ran_at: string;
  mode: "real";
  status: "passed" | "failed" | "warnings" | "error";
  raw_status: string;
  summary: string;
  findings_created: number;
  normalized_score: number | null;
  threshold: number | null;
  system: { id: string; name: string };
  formula: string;
  payload: Record<string, unknown>;
};

/** Run one real adapter against the live target. Genuine probe, not a mock. */
export async function runSecurityTool(
  adapterKey: string,
  aiSystemId?: string,
): Promise<SecurityToolRunResult> {
  return request<SecurityToolRunResult>(`/security-tools/${adapterKey}/run`, {
    method: "POST",
    body: JSON.stringify({ ai_system_id: aiSystemId ?? null }),
  });
}

/* ─────────────────────────────────────────── LLM client boundary ── */

export type ClientBoundaryClient = {
  mode: "real" | "mock";
  provider: string;
  credential_ref: string;
};

export type ClientBoundaryStatus = {
  governance: ClientBoundaryClient;
  target: ClientBoundaryClient;
};

export type BoundaryTestResult = {
  prompt: string;
  target_mode: "real" | "mock";
  provider: string;
  trace_id: string;
  latency_ms: number;
  raw: string;
  sanitized: string;
  redaction_count: number;
  warnings: string[];
  warning_count: number;
  fenced: string;
  caught_something: boolean;
};

export async function getClientBoundary(): Promise<ClientBoundaryStatus> {
  return request<ClientBoundaryStatus>(`/client-boundary`);
}

/** Send a prompt to the REAL target model and return the sanitized + fenced result. */
export async function runBoundaryTest(prompt: string): Promise<BoundaryTestResult> {
  return request<BoundaryTestResult>(`/client-boundary/test`, {
    method: "POST",
    body: JSON.stringify({ prompt }),
  });
}

/* ─────────────────────────────────── Context document upload ── */

export type RetrievalContextDocument = {
  id: string;
  ai_system_id: string;
  title: string;
  content: string;
  source_uri: string | null;
  tags: string[];
  created_at: string;
};

export async function uploadContextDocument(
  systemId: string,
  opts: { file?: File; text?: string; title?: string; tags?: string[] },
): Promise<RetrievalContextDocument> {
  const form = new FormData();
  if (opts.file) form.append("file", opts.file);
  if (opts.text) form.append("text", opts.text);
  if (opts.title) form.append("title", opts.title);
  if (opts.tags?.length) form.append("tags", opts.tags.join(","));
  // Note: no Content-Type header — the browser sets the multipart boundary.
  const response = await fetch(
    `${API_BASE_URL}/ai-systems/${systemId}/retrieval-context/upload`,
    { method: "POST", body: form, headers: authHeaders() },
  );
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

const TERMINAL_STATUSES = new Set(["completed", "report_ready", "degraded", "failed", "cancelled", "canceled"]);

export async function waitForRunCompletion(
  runId: string,
  onProgress?: (run: EvaluationRun) => void,
  signal?: AbortSignal,
): Promise<EvaluationRun> {
  while (true) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const run = await getEvaluationRun(runId);
    onProgress?.(run);
    // Stop polling when the run finishes OR pauses for plan approval — a gated
    // run parks at 'planned' and would otherwise poll forever. Callers inspect
    // isAwaitingApproval() on the returned run to route the user to approval.
    if (TERMINAL_STATUSES.has(run.status) || isAwaitingApproval(run)) return run;
    await new Promise((res) => setTimeout(res, 3000));
  }
}
