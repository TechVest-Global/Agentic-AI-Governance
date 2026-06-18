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
    mock_score: float = Field(default=1.0, ge=0.0, le=1.0)
    force_status: MetricResultStatus | None = None
    source_name: str = Field(default="mock_metric_runner", max_length=200)


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


class GovernancePipelineRunCreate(APIModel):
    mock_score: float = Field(default=1.0, ge=0.0, le=1.0)
    force_metric_status: MetricResultStatus | None = None
    source_name: str = Field(default="mock_metric_runner", max_length=200)
    agent_names: list[str] | None = None
    requested_by: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=1000)


class GovernancePipelineRunRead(APIModel):
    run_id: UUID
    metric_execution: MetricExecutionRead
    agent_run: AgentRunRead
    council: CouncilDeliberationRead
    report: GovernanceReportRead
