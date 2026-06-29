from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.enums import (
    ActionTier,
    AgentExecutionStatus,
    AISystemStatus,
    CapabilityType,
    FindingStatus,
    LedgerActorType,
    MetricResultStatus,
    RiskTier,
    RunPhase,
    RunStatus,
    Severity,
    SideEffectLevel,
)


class APIModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, str_strip_whitespace=True)


class AISystemCreate(APIModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    owner: str = Field(min_length=1, max_length=200)
    system_type: str = Field(min_length=1, max_length=100)
    risk_tier: RiskTier = RiskTier.medium
    deployment_environment: str = Field(default="local", max_length=100)
    selected_frameworks: list[str] = Field(default_factory=list)
    model_provider: str = Field(default="azure_foundry", max_length=100)
    model_name: str | None = Field(default=None, max_length=200)
    model_version: str | None = Field(default=None, max_length=100)
    target_endpoint_ref: str | None = Field(default=None, max_length=500)
    metadata_json: dict[str, Any] = Field(default_factory=dict)


class AISystemRead(AISystemCreate):
    id: UUID
    status: AISystemStatus
    created_at: datetime
    updated_at: datetime | None = None


class AISystemCapabilityCreate(APIModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    capability_type: CapabilityType = CapabilityType.other
    endpoint_ref: str = Field(min_length=1, max_length=500)
    http_method: str = Field(default="POST", pattern="^(GET|POST|PUT|PATCH|DELETE)$")
    input_schema: dict[str, Any] = Field(default_factory=dict)
    output_schema: dict[str, Any] = Field(default_factory=dict)
    permissions: list[str] = Field(default_factory=list)
    side_effect_level: SideEffectLevel = SideEffectLevel.none
    requires_human_review: bool = False
    enabled: bool = True
    metadata_json: dict[str, Any] = Field(default_factory=dict)

    @field_validator("http_method", mode="before")
    @classmethod
    def normalize_http_method(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip().upper()
        return value


class AISystemCapabilityRead(AISystemCapabilityCreate):
    id: UUID
    ai_system_id: UUID
    created_at: datetime
    updated_at: datetime | None = None


class ApplicationContextProfileCreate(APIModel):
    identity_purpose: dict[str, Any]
    pre_model_controls: dict[str, Any]
    model_configuration: dict[str, Any]
    post_model_controls: dict[str, Any]
    integration_context: dict[str, Any]


class ApplicationContextProfileRead(ApplicationContextProfileCreate):
    id: UUID
    ai_system_id: UUID
    created_at: datetime
    updated_at: datetime | None = None


class EvaluationRunCreate(APIModel):
    ai_system_id: UUID
    selected_frameworks: list[str] = Field(default_factory=list)
    selected_metrics: list[str] = Field(default_factory=list)
    created_by: str | None = Field(default=None, max_length=200)


class EvaluationRunRead(EvaluationRunCreate):
    id: UUID
    status: RunStatus
    current_phase: RunPhase
    started_at: datetime | None = None
    completed_at: datetime | None = None
    result_summary: dict[str, Any] | None = None
    error_summary: dict[str, Any] | None = None
    created_at: datetime
    updated_at: datetime | None = None


class EvaluationRunStart(APIModel):
    note: str | None = Field(default=None, max_length=500)


class EvaluationRunComplete(APIModel):
    result_summary: dict[str, Any] = Field(default_factory=dict)


class EvaluationRunFail(APIModel):
    error_summary: dict[str, Any] = Field(default_factory=dict)


class EvaluationRunCancel(APIModel):
    reason: str | None = Field(default=None, max_length=500)


class GovernanceStateEntryRead(APIModel):
    id: UUID
    run_id: UUID
    sequence_number: int
    entry_type: str
    source: str
    phase: str
    payload: dict[str, Any]
    previous_hash: str | None = None
    entry_hash: str
    created_at: datetime
    updated_at: datetime | None = None


class GovernanceStateEntryCreate(APIModel):
    entry_type: str = Field(min_length=1, max_length=100)
    source: str = Field(min_length=1, max_length=100)
    phase: str = Field(min_length=1, max_length=100)
    payload: dict[str, Any] = Field(default_factory=dict)


class GovernanceStateChainVerification(APIModel):
    valid: bool
    entry_count: int
    failed_sequence: int | None = None
    reason: str | None = None


class AuditLedgerEntryCreate(APIModel):
    event_type: str = Field(min_length=1, max_length=100)
    actor_type: LedgerActorType = LedgerActorType.system
    actor_id: str | None = Field(default=None, max_length=200)
    payload: dict[str, Any] = Field(default_factory=dict)


class AuditLedgerEntryRead(AuditLedgerEntryCreate):
    id: UUID
    run_id: UUID
    sequence_number: int
    previous_hash: str | None = None
    entry_hash: str
    created_at: datetime
    updated_at: datetime | None = None


class AuditLedgerChainVerification(APIModel):
    valid: bool
    entry_count: int
    failed_entry_id: UUID | None = None
    reason: str | None = None


class MetricConfigCreate(APIModel):
    metric_id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    dimension: str = Field(min_length=1, max_length=200)
    primary_agent: str | None = Field(default=None, max_length=100)
    tool_name: str | None = Field(default=None, max_length=100)
    framework_ids: list[str] = Field(default_factory=list)
    modality: str | None = Field(default=None, max_length=100)
    threshold_rules: dict[str, Any] = Field(default_factory=dict)
    scoring_config: dict[str, Any] = Field(default_factory=dict)
    version: str = Field(default="v1", max_length=50)
    enabled: bool = True
    metadata_json: dict[str, Any] = Field(default_factory=dict)


class MetricConfigRead(MetricConfigCreate):
    id: UUID
    created_at: datetime
    updated_at: datetime | None = None


class FrameworkMappingCreate(APIModel):
    framework_id: str = Field(min_length=1, max_length=100)
    framework_name: str = Field(min_length=1, max_length=200)
    framework_version: str = Field(default="v1", max_length=50)
    control_ref: str = Field(min_length=1, max_length=100)
    control_title: str | None = Field(default=None, max_length=300)
    control_category: str | None = Field(default=None, max_length=150)
    jurisdiction: str | None = Field(default=None, max_length=100)
    requirement_text: str | None = None
    metric_ids: list[str] = Field(default_factory=list)
    agent_names: list[str] = Field(default_factory=list)
    risk_tiers: list[str] = Field(default_factory=list)
    evidence_requirements: list[str] = Field(default_factory=list)
    enabled: bool = True
    metadata_json: dict[str, Any] = Field(default_factory=dict)


class FrameworkMappingRead(FrameworkMappingCreate):
    id: UUID
    created_at: datetime
    updated_at: datetime | None = None


class GovernanceConfigBootstrapRead(APIModel):
    metrics_created: int
    metrics_skipped: int
    framework_mappings_created: int
    framework_mappings_skipped: int
    metric_ids_created: list[str] = Field(default_factory=list)
    metric_ids_skipped: list[str] = Field(default_factory=list)
    control_refs_created: list[str] = Field(default_factory=list)
    control_refs_skipped: list[str] = Field(default_factory=list)


class MetricPlanControl(APIModel):
    framework_id: str
    framework_name: str
    framework_version: str
    control_ref: str
    control_title: str | None = None
    control_category: str | None = None
    jurisdiction: str | None = None
    evidence_requirements: list[str] = Field(default_factory=list)
    agent_names: list[str] = Field(default_factory=list)
    risk_tiers: list[str] = Field(default_factory=list)


class MetricPlanItem(APIModel):
    metric_config_id: UUID
    metric_id: str
    name: str
    description: str | None = None
    dimension: str
    primary_agent: str | None = None
    tool_name: str | None = None
    framework_ids: list[str] = Field(default_factory=list)
    modality: str | None = None
    threshold_rules: dict[str, Any] = Field(default_factory=dict)
    scoring_config: dict[str, Any] = Field(default_factory=dict)
    version: str
    controls: list[MetricPlanControl] = Field(default_factory=list)


class MetricPlanRead(APIModel):
    run_id: UUID
    ai_system_id: UUID
    selected_frameworks: list[str] = Field(default_factory=list)
    selected_metrics: list[str] = Field(default_factory=list)
    metric_count: int
    control_count: int
    metrics: list[MetricPlanItem] = Field(default_factory=list)


class EvidenceRecordCreate(APIModel):
    ai_system_capability_id: UUID | None = None
    source_type: str = Field(min_length=1, max_length=100)
    source_name: str = Field(min_length=1, max_length=200)
    tool_name: str | None = Field(default=None, max_length=100)
    tool_version: str | None = Field(default=None, max_length=100)
    input_ref: str | None = Field(default=None, max_length=500)
    output_ref: str | None = Field(default=None, max_length=500)
    raw_score: float | None = None
    normalized_score: float | None = None
    threshold: float | None = None
    passed: bool | None = None
    trace_id: str | None = Field(default=None, max_length=200)
    sensitivity: str = Field(default="internal", max_length=100)
    payload: dict[str, Any] = Field(default_factory=dict)


class EvidenceRecordRead(EvidenceRecordCreate):
    id: UUID
    run_id: UUID
    created_at: datetime
    updated_at: datetime | None = None


class MetricResultCreate(APIModel):
    ai_system_capability_id: UUID | None = None
    metric_id: str = Field(min_length=1, max_length=100)
    dimension: str = Field(min_length=1, max_length=200)
    tool_name: str = Field(min_length=1, max_length=100)
    status: MetricResultStatus = MetricResultStatus.pending
    raw_score: float | None = None
    normalized_score: float | None = None
    threshold: float | None = None
    passed: bool | None = None
    evidence_ids: list[str] = Field(default_factory=list)


class MetricResultRead(MetricResultCreate):
    id: UUID
    run_id: UUID
    created_at: datetime
    updated_at: datetime | None = None


class MetricExecutionCreate(APIModel):
    mock_score: float = Field(default=0.5, ge=0.0, le=1.0)
    force_status: MetricResultStatus | None = None
    source_name: str = Field(default="threshold_metric_runner", max_length=200)
    evaluator_name: str = Field(default="threshold", min_length=1, max_length=100)


class MetricExecutionRead(APIModel):
    run_id: UUID
    evidence_created: int
    metric_results_created: int
    evidence: list[EvidenceRecordRead] = Field(default_factory=list)
    metric_results: list[MetricResultRead] = Field(default_factory=list)


class FindingCreate(APIModel):
    ai_system_capability_id: UUID | None = None
    finding_type: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=300)
    summary: str = Field(min_length=1)
    severity: Severity = Severity.medium
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    dimension: str = Field(min_length=1, max_length=200)
    framework_refs: list[str] = Field(default_factory=list)
    evidence_ids: list[str] = Field(default_factory=list)
    agent_name: str | None = Field(default=None, max_length=100)
    recommended_action: str | None = None
    status: FindingStatus = FindingStatus.open
    payload: dict[str, Any] = Field(default_factory=dict)


class FindingRead(FindingCreate):
    id: UUID
    run_id: UUID
    created_at: datetime
    updated_at: datetime | None = None


class AgentRunCreate(APIModel):
    agent_names: list[str] | None = None


class AgentRunSummary(APIModel):
    id: UUID | None = None
    agent_name: str
    finding_count: int
    status: AgentExecutionStatus = AgentExecutionStatus.completed


class AgentExecutionRead(APIModel):
    id: UUID
    run_id: UUID
    agent_name: str
    status: AgentExecutionStatus
    finding_count: int
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error_summary: dict[str, Any] | None = None
    metadata_json: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime | None = None


class AgentRunRead(APIModel):
    run_id: UUID
    agents_run: list[AgentRunSummary] = Field(default_factory=list)
    executions: list[AgentExecutionRead] = Field(default_factory=list)
    findings_created: int
    findings: list[FindingRead] = Field(default_factory=list)


class VerdictCreate(APIModel):
    confidence_score: float = Field(default=0.0, ge=0.0, le=1.0)
    action_tier: ActionTier = ActionTier.human_review
    label: str = Field(min_length=1, max_length=100)
    synthesis: str | None = None
    objections: list[dict[str, Any]] = Field(default_factory=list)
    reasoning: str | None = None
    required_actions: list[dict[str, Any]] = Field(default_factory=list)


class VerdictRead(VerdictCreate):
    id: UUID
    run_id: UUID
    created_at: datetime
    updated_at: datetime | None = None


class CouncilDeliberationCreate(APIModel):
    requested_by: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=1000)


class CouncilDeliberationRead(APIModel):
    run_id: UUID
    verdict: VerdictRead
    finding_count: int
    open_finding_count: int
    metric_result_count: int
    failed_metric_count: int
    pending_metric_count: int
    highest_severity: Severity | None = None
    created_verdict: bool = True


class GovernanceReportRead(APIModel):
    run: EvaluationRunRead
    ai_system: AISystemRead
    context_profile: ApplicationContextProfileRead | None = None
    capabilities: list[AISystemCapabilityRead] = Field(default_factory=list)
    metric_plan: MetricPlanRead
    agent_executions: list[AgentExecutionRead] = Field(default_factory=list)
    evidence: list[EvidenceRecordRead] = Field(default_factory=list)
    metric_results: list[MetricResultRead] = Field(default_factory=list)
    findings: list[FindingRead] = Field(default_factory=list)
    verdict: VerdictRead | None = None
    state_chain: GovernanceStateChainVerification
    counts: dict[str, int] = Field(default_factory=dict)


FrameworkControlStatus = Literal["passed", "failed", "needs_review", "not_evaluated"]


class FrameworkControlAssessment(APIModel):
    framework_id: str
    framework_name: str
    framework_version: str
    control_ref: str
    control_title: str | None = None
    control_category: str | None = None
    jurisdiction: str | None = None
    status: FrameworkControlStatus
    metric_ids: list[str] = Field(default_factory=list)
    passed_metric_count: int
    failed_metric_count: int
    pending_metric_count: int
    finding_count: int
    highest_severity: Severity | None = None
    evidence_requirements: list[str] = Field(default_factory=list)
    metric_results: list[MetricResultRead] = Field(default_factory=list)
    findings: list[FindingRead] = Field(default_factory=list)


class FrameworkComplianceMapRead(APIModel):
    run_id: UUID
    ai_system_id: UUID
    selected_frameworks: list[str] = Field(default_factory=list)
    control_count: int
    status_counts: dict[str, int] = Field(default_factory=dict)
    controls: list[FrameworkControlAssessment] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Layer 1: Context Assembly
# ---------------------------------------------------------------------------


class ContextLogEntry(APIModel):
    """One production/staging log record fed to the deterministic log analyzer."""

    request_category: str = Field(min_length=1, max_length=200)
    demographic_group: str | None = Field(default=None, max_length=200)
    jurisdiction: str | None = Field(default=None, max_length=100)
    outcome: str | None = Field(default=None, max_length=200)
    modality: str = Field(default="text", max_length=100)
    contains_pii: bool = False
    flagged: bool = False
    timestamp: datetime | None = None


class ContextAssemblyCreate(APIModel):
    logs: list[ContextLogEntry] = Field(default_factory=list)
    requested_by: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=1000)


class LogAnalysisSummary(APIModel):
    total_requests: int
    empty: bool
    request_category_counts: dict[str, int] = Field(default_factory=dict)
    demographic_coverage: dict[str, int] = Field(default_factory=dict)
    jurisdiction_coverage: dict[str, int] = Field(default_factory=dict)
    outcome_counts: dict[str, int] = Field(default_factory=dict)
    modality_counts: dict[str, int] = Field(default_factory=dict)
    pii_request_count: int = 0
    flagged_request_count: int = 0
    distinct_request_categories: int = 0
    distinct_demographic_groups: int = 0
    distinct_jurisdictions: int = 0
    distinct_outcomes: int = 0
    observed_request_categories: list[str] = Field(default_factory=list)
    observed_demographic_groups: list[str] = Field(default_factory=list)
    observed_jurisdictions: list[str] = Field(default_factory=list)
    observed_outcomes: list[str] = Field(default_factory=list)


class RegulatoryRubricItemRead(APIModel):
    rubric_id: str
    dimension: str
    description: str
    scoring_guidance: str


class RegulatoryProbeTemplateRead(APIModel):
    probe_id: str
    dimension: str
    description: str
    prompt_template: str
    control_refs: list[str] = Field(default_factory=list)


class RegulatoryControlChunk(APIModel):
    framework_id: str
    framework_name: str
    framework_version: str
    control_ref: str
    citation: str
    control_title: str | None = None
    control_category: str | None = None
    jurisdiction: str | None = None
    requirement_text: str | None = None
    metric_ids: list[str] = Field(default_factory=list)
    agent_names: list[str] = Field(default_factory=list)
    risk_tiers: list[str] = Field(default_factory=list)
    evidence_requirements: list[str] = Field(default_factory=list)


class RegulatoryFrameworkContext(APIModel):
    framework_id: str
    framework_name: str
    framework_version: str
    citation_format: str
    severity_thresholds: dict[str, float] = Field(default_factory=dict)
    control_count: int
    controls: list[RegulatoryControlChunk] = Field(default_factory=list)
    rubric: list[RegulatoryRubricItemRead] = Field(default_factory=list)
    probe_templates: list[RegulatoryProbeTemplateRead] = Field(default_factory=list)


class RegulatoryContextRead(APIModel):
    selected_frameworks: list[str] = Field(default_factory=list)
    resolved_frameworks: list[str] = Field(default_factory=list)
    missing_frameworks: list[str] = Field(default_factory=list)
    control_count: int
    frameworks: list[RegulatoryFrameworkContext] = Field(default_factory=list)


class CoverageGapRead(APIModel):
    gap_id: str
    framework_id: str
    category: str
    dimension: str
    severity: Severity
    description: str
    control_refs: list[str] = Field(default_factory=list)
    recommended_probe_id: str | None = None
    recommended_action: str
    expected: list[str] = Field(default_factory=list)
    observed: list[str] = Field(default_factory=list)


class ContextAssemblyRead(APIModel):
    run_id: UUID
    state_sequence_number: int
    state_entry_hash: str
    generated_at: datetime
    log_analysis: LogAnalysisSummary
    regulatory_context: RegulatoryContextRead
    coverage_gaps: list[CoverageGapRead] = Field(default_factory=list)
    gap_count: int
    highest_gap_severity: Severity | None = None
    counts: dict[str, int] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Layer 2: Adaptive Orchestrator
# ---------------------------------------------------------------------------

AgentPriority = Literal["high", "medium", "low"]


class PriorityTarget(APIModel):
    dimension: str
    severity: Severity
    reason: str
    control_refs: list[str] = Field(default_factory=list)
    gap_ids: list[str] = Field(default_factory=list)


class AgentPlanItem(APIModel):
    agent_name: str
    activated: bool = True
    priority: AgentPriority
    probe_budget: int
    assigned_metric_ids: list[str] = Field(default_factory=list)
    target_dimensions: list[str] = Field(default_factory=list)
    target_controls: list[str] = Field(default_factory=list)
    coverage_gap_ids: list[str] = Field(default_factory=list)
    instructions: str
    rationale: str


class EvaluationPlanCreate(APIModel):
    requested_by: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=1000)


class EvaluationPlanRead(APIModel):
    run_id: UUID
    ai_system_id: UUID
    state_sequence_number: int
    state_entry_hash: str
    generated_at: datetime
    risk_tier: str
    selected_frameworks: list[str] = Field(default_factory=list)
    metric_count: int
    coverage_gap_count: int
    probe_budget_total: int
    probe_budget_allocated: int
    activated_agents: list[AgentPlanItem] = Field(default_factory=list)
    priority_targets: list[PriorityTarget] = Field(default_factory=list)
    risk_rationale: str
    counts: dict[str, int] = Field(default_factory=dict)


class GovernancePipelineRunCreate(APIModel):
    mock_score: float = Field(default=1.0, ge=0.0, le=1.0)
    force_metric_status: MetricResultStatus | None = None
    source_name: str = Field(default="mock_metric_runner", max_length=200)
    evaluator_name: str = Field(default="mock", min_length=1, max_length=100)
    agent_names: list[str] | None = None
    logs: list[ContextLogEntry] = Field(default_factory=list)
    requested_by: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=1000)


class GovernancePipelineRunRead(APIModel):
    run_id: UUID
    context_assembly: ContextAssemblyRead | None = None
    evaluation_plan: EvaluationPlanRead | None = None
    metric_execution: MetricExecutionRead
    agent_run: AgentRunRead
    council: CouncilDeliberationRead
    report: GovernanceReportRead


# ---------------------------------------------------------------------------
# LLM Call Logs — audit trail for every LLM API call in the pipeline
# ---------------------------------------------------------------------------


class LLMCallLogRead(APIModel):
    id: UUID
    run_id: UUID | None = None
    agent_name: str | None = None
    task: str
    call_type: str
    model: str
    deployment_name: str | None = None
    client_mode: str
    routed_via: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    estimated_cost_usd: float | None = None
    latency_ms: int
    status: str
    request_chars: int
    response_chars: int
    trace_id: str | None = None
    policy_flags: list[str] = Field(default_factory=list)
    created_at: datetime


class LLMCallLogSummary(APIModel):
    run_id: UUID
    call_count: int
    total_prompt_tokens: int
    total_completion_tokens: int
    total_tokens: int
    estimated_total_cost_usd: float
    live_call_count: int
    mock_call_count: int
    error_count: int
    calls: list[LLMCallLogRead] = Field(default_factory=list)
