const API_BASE_URL =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_API_BASE_URL?.replace(/\/$/, "") ??
  "http://127.0.0.1:8000/api/v1";


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
  deployment_environment: string;
  selected_frameworks: string[];
  model_provider: string;
  model_name?: string | null;
  model_version?: string | null;
  target_endpoint_ref?: string | null;
  metadata_json?: Record<string, unknown>;
};

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
  created_at: string;
  updated_at?: string | null;
};

export type Verdict = {
  id: string;
  run_id: string;
  confidence_score: number;
  action_tier: string;
  label: string;
  synthesis?: string | null;
  objections: Array<Record<string, unknown>>;
  reasoning?: string | null;
  required_actions: Array<Record<string, unknown>>;
  created_at: string;
};

export type GovernanceReport = {
  run: EvaluationRun;
  ai_system: {
    id: string;
    name: string;
    owner: string;
    system_type: string;
    risk_tier: string;
    status: string;
  };
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
  status: "passed" | "failed" | "needs_review" | "not_evaluated";
  metric_ids: string[];
  passed_metric_count: number;
  failed_metric_count: number;
  pending_metric_count: number;
  finding_count: number;
  evidence_requirements: string[];
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function getLatestEvaluationRun(): Promise<EvaluationRun | null> {
  const runs = await request<EvaluationRun[]>("/evaluation-runs?limit=1");
  return runs[0] ?? null;
}

export async function getGovernanceReport(runId: string): Promise<GovernanceReport> {
  return request<GovernanceReport>(`/evaluation-runs/${runId}/report`);
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

export async function createAISystemCapability(
  systemId: string,
  payload: BackendAISystemCapabilityCreate,
): Promise<BackendAISystemCapability> {
  return request<BackendAISystemCapability>(`/ai-systems/${systemId}/capabilities`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ── Context Profile ────────────────────────────────────────────────────────────

export type BackendContextProfileSections = {
  identity_purpose: Record<string, unknown>;
  pre_model_controls: Record<string, unknown>;
  model_configuration: Record<string, unknown>;
  post_model_controls: Record<string, unknown>;
  integration_context: Record<string, unknown>;
};

export type BackendContextProfile = BackendContextProfileSections & {
  id: string;
  ai_system_id: string;
  created_at: string;
  updated_at?: string | null;
};

export async function getContextProfile(systemId: string): Promise<BackendContextProfile> {
  return request<BackendContextProfile>(`/ai-systems/${systemId}/context-profile`);
}

export async function upsertContextProfile(
  systemId: string,
  payload: BackendContextProfileSections,
): Promise<BackendContextProfile> {
  return request<BackendContextProfile>(`/ai-systems/${systemId}/context-profile`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

// ── Evaluation Runs (create + list) ────────────────────────────────────────────

export type BackendEvaluationRunCreate = {
  ai_system_id: string;
  selected_frameworks: string[];
  selected_metrics?: string[];
};

export async function createEvaluationRun(payload: BackendEvaluationRunCreate): Promise<EvaluationRun> {
  return request<EvaluationRun>("/evaluation-runs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listEvaluationRuns(systemId?: string): Promise<EvaluationRun[]> {
  const q = systemId ? `?ai_system_id=${systemId}` : "";
  return request<EvaluationRun[]>(`/evaluation-runs${q}`);
}

// ── Metric Plan ────────────────────────────────────────────────────────────────

export type BackendMetricPlanControl = {
  framework_id: string;
  framework_name: string;
  framework_version: string;
  control_ref: string;
  control_title?: string | null;
  control_category?: string | null;
  jurisdiction?: string | null;
  evidence_requirements: string[];
  agent_names: string[];
};

export type BackendMetricPlanItem = {
  metric_config_id: string;
  metric_id: string;
  name: string;
  description?: string | null;
  dimension: string;
  primary_agent?: string | null;
  tool_name?: string | null;
  framework_ids: string[];
  modality?: string | null;
  threshold_rules: Record<string, unknown>;
  scoring_config: Record<string, unknown>;
  version: string;
  controls: BackendMetricPlanControl[];
};

export type BackendMetricPlan = {
  run_id: string;
  ai_system_id: string;
  selected_frameworks: string[];
  selected_metrics: string[];
  metric_count: number;
  control_count: number;
  metrics: BackendMetricPlanItem[];
};

export async function getMetricPlan(runId: string): Promise<BackendMetricPlan> {
  return request<BackendMetricPlan>(`/evaluation-runs/${runId}/metric-plan`);
}

// ── Metric Configs ─────────────────────────────────────────────────────────────

export type BackendMetricConfig = {
  id: string;
  metric_id: string;
  name: string;
  description?: string | null;
  dimension: string;
  primary_agent?: string | null;
  tool_name?: string | null;
  framework_ids: string[];
  modality?: string | null;
  threshold_rules: Record<string, unknown>;
  scoring_config: Record<string, unknown>;
  version: string;
  enabled: boolean;
  created_at: string;
};

export async function listMetricConfigs(params?: { framework_id?: string; dimension?: string }): Promise<BackendMetricConfig[]> {
  const q = params ? `?${new URLSearchParams(params as Record<string, string>).toString()}` : "";
  return request<BackendMetricConfig[]>(`/metrics${q}`);
}

// ── Verdict (direct) ──────────────────────────────────────────────────────────

export async function getVerdict(runId: string): Promise<Verdict> {
  return request<Verdict>(`/evaluation-runs/${runId}/verdict`);
}
