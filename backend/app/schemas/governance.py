from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.enums import (
    ActionTier,
    AgentExecutionStatus,
    AISystemStatus,
    ApplicabilityType,
    AssessmentRequestStatus,
    CapabilityType,
    EndpointStatus,
    FindingStatus,
    LedgerActorType,
    MetricResultStatus,
    Modality,
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
    modality: Modality = Modality.text
    deployment_environment: str = Field(default="local", max_length=100)
    selected_frameworks: list[str] = Field(default_factory=list)
    model_provider: str = Field(default="azure_foundry", max_length=100)
    model_name: str | None = Field(default=None, max_length=200)
    model_version: str | None = Field(default=None, max_length=100)
    target_endpoint_ref: str | None = Field(default=None, max_length=500)
    metadata_json: dict[str, Any] = Field(default_factory=dict)


class AISystemUpdate(APIModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    owner: str | None = Field(default=None, min_length=1, max_length=200)
    system_type: str | None = Field(default=None, min_length=1, max_length=100)
    risk_tier: RiskTier | None = None
    modality: Modality | None = None
    deployment_environment: str | None = Field(default=None, max_length=100)
    selected_frameworks: list[str] | None = None
    model_provider: str | None = Field(default=None, max_length=100)
    model_name: str | None = Field(default=None, max_length=200)
    model_version: str | None = Field(default=None, max_length=100)
    target_endpoint_ref: str | None = Field(default=None, max_length=500)
    metadata_json: dict[str, Any] | None = None


class AISystemRead(AISystemCreate):
    id: UUID
    status: AISystemStatus
    created_at: datetime
    updated_at: datetime | None = None


class AISystemCapabilityCreate(APIModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    capability_type: CapabilityType = CapabilityType.other
    modality: Modality = Modality.text
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


class AISystemCapabilityUpdate(APIModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    capability_type: CapabilityType | None = None
    modality: Modality | None = None
    endpoint_ref: str | None = Field(default=None, min_length=1, max_length=500)
    http_method: str | None = Field(default=None, pattern="^(GET|POST|PUT|PATCH|DELETE)$")
    input_schema: dict[str, Any] | None = None
    output_schema: dict[str, Any] | None = None
    permissions: list[str] | None = None
    side_effect_level: SideEffectLevel | None = None
    requires_human_review: bool | None = None
    enabled: bool | None = None
    metadata_json: dict[str, Any] | None = None

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


class RetrievalContextDocumentCreate(APIModel):
    title: str = Field(min_length=1, max_length=300)
    content: str = Field(min_length=1)
    source_uri: str | None = Field(default=None, max_length=500)
    tags: list[str] = Field(default_factory=list)


class RetrievalContextDocumentRead(RetrievalContextDocumentCreate):
    id: UUID
    ai_system_id: UUID
    created_at: datetime
    updated_at: datetime | None = None


class EvaluationRunCreate(APIModel):
    ai_system_id: UUID
    selected_frameworks: list[str] = Field(default_factory=list)
    selected_metrics: list[str] = Field(default_factory=list)
    # Capability endpoint_refs to scope the audit to. Empty = whole application
    # (probe the base endpoint), e.g. ["parse-resume", "rank-candidates"].
    selected_capabilities: list[str] = Field(default_factory=list)
    created_by: str | None = Field(default=None, max_length=200)


class EvaluationRunRead(EvaluationRunCreate):
    id: UUID
    status: RunStatus
    current_phase: RunPhase
    started_at: datetime | None = None
    completed_at: datetime | None = None
    result_summary: dict[str, Any] | None = None
    error_summary: dict[str, Any] | None = None
    # Metric-plan approval gate: set once a reviewer approves a paused run.
    # A run awaiting approval has status == planned and plan_approved_at is None.
    plan_approved_at: datetime | None = None
    plan_approved_by: str | None = None
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
    # Additive: whether the Finding/MetricResult rows the ledger summarizes
    # still match the digest recorded at write time. None when neither phase
    # has completed yet (nothing to check); the hash-chain fields above only
    # prove the ledger rows themselves are untampered, not the domain rows
    # they describe — see app.services.content_integrity.
    content_valid: bool | None = None
    content_checks: list[dict[str, object]] = Field(default_factory=list)


class MetricConfigCreate(APIModel):
    metric_id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    dimension: str = Field(min_length=1, max_length=200)
    primary_agent: str | None = Field(default=None, max_length=100)
    tool_name: str | None = Field(default=None, max_length=100)
    framework_ids: list[str] = Field(default_factory=list)
    modality: str | None = Field(default=None, max_length=100)
    applicable_capability_types: list[str] = Field(default_factory=list)
    applicable_modalities: list[str] = Field(default_factory=list)
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
    enabled: bool = True
    threshold: float | None = None
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
    # Override capture (calibration plumbing) — see VerdictOverrideCreate.
    # Additive: the original fields above are never mutated by an override.
    human_override_label: str | None = None
    human_override_reason: str | None = None
    overridden_by: str | None = None
    overridden_at: datetime | None = None


class VerdictOverrideCreate(APIModel):
    human_override_label: str = Field(min_length=1, max_length=100)
    human_override_reason: str = Field(min_length=1)


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
    # The run keeps TWO hash-chained append-only records — the state chain and
    # the audit ledger — but the report verified only the first. A reader seeing
    # a report that attests to chain integrity would reasonably assume the audit
    # trail was covered; it was not. Both are verified and reported now.
    ledger_chain: AuditLedgerChainVerification
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
    # Provenance annotation, e.g. "Log source: synthesized (12 record(s))." when
    # no logs were uploaded and a deterministic sample was generated instead.
    notes: str | None = None


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
    # LLM review of the deterministic plan (None when the governance model was
    # unavailable or returned an unusable response): {"reviewed", "model",
    # "dropped": [{"metric_id", "reason"}], "rationale"}.
    llm_review: dict[str, Any] | None = None


class GovernancePipelineRunCreate(APIModel):
    mock_score: float = Field(default=1.0, ge=0.0, le=1.0)
    force_metric_status: MetricResultStatus | None = None
    # Coarse run-level label for where results came from. The per-metric real
    # tool (garak/deepeval/presidio/…) is recorded on each evidence row's
    # tool_name/source_type; this is just the runner label. Defaulted to a
    # neutral name so real ("auto") runs aren't mislabeled "mock" — callers that
    # genuinely want the mock evaluator pass evaluator_name="mock" explicitly.
    source_name: str = Field(default="metric_execution_engine", max_length=200)
    evaluator_name: str = Field(default="mock", min_length=1, max_length=100)
    agent_names: list[str] | None = None
    logs: list[ContextLogEntry] = Field(default_factory=list)
    requested_by: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=1000)
    # Human-in-the-loop gate: when true, the pipeline pauses after the adaptive
    # orchestrator builds the metric plan and parks the run at RunStatus.planned
    # until POST /{run_id}/approve-plan is called. Defaults false so existing
    # API/service callers keep the straight-through behavior; the UI opts in.
    require_plan_approval: bool = False


class PlanApprovalCreate(APIModel):
    """Approve a paused metric plan and resume the run.

    selected_metrics: when provided, the reviewer manually overrode the
    orchestrator's selection — run exactly these metric_ids instead. None means
    approve the plan as-is. An empty list is rejected (would fall back to running
    every framework metric, the opposite of the reviewer's intent).
    """

    approved_by: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=1000)
    selected_metrics: list[str] | None = None


class GovernancePipelineRunRead(APIModel):
    run_id: UUID
    context_assembly: ContextAssemblyRead | None = None
    evaluation_plan: EvaluationPlanRead | None = None
    metric_execution: MetricExecutionRead
    agent_run: AgentRunRead
    # Both optional so a run whose council or report step failed still returns
    # the evidence the earlier phases DID produce, instead of the whole pipeline
    # collapsing to an error and discarding it. The run is marked `degraded` and
    # the reason recorded in error_summary — see orchestration._execute_and_report.
    council: CouncilDeliberationRead | None = None
    report: GovernanceReportRead | None = None


# ---------------------------------------------------------------------------
# LLM Call Logs — audit trail for every LLM API call in the pipeline
# ---------------------------------------------------------------------------


class LLMCallLogRead(APIModel):
    id: UUID
    run_id: UUID | None = None
    agent_name: str | None = None
    phase: str | None = None
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
    prompt_text: str | None = None
    response_text: str | None = None
    error_text: str | None = None


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


class ExecutionArtifactRead(APIModel):
    """Metadata for one generated-media artifact — the actual image/audio/video
    bytes are served separately via the .../media endpoint, so this list stays
    light even when a run produced several large probe videos."""

    id: UUID
    run_id: UUID
    agent_name: str
    dimension: str | None = None
    capability_name: str | None = None
    endpoint_ref: str
    prompt_text: str
    response_text: str
    media_kind: str
    mime_type: str
    has_media: bool
    source_url: str | None = None
    created_at: datetime


# ── AI application registration: backend-sourced options + frameworks ──────────


class OptionItem(APIModel):
    """A single selectable option (machine value + human label)."""

    value: str
    label: str


class RegistrationFrameworkOption(APIModel):
    """An applicable governance framework the registration form can offer."""

    framework_id: str
    framework_name: str
    framework_version: str
    description: str
    rubric_count: int
    probe_count: int
    coverage_count: int


class RegistrationOptions(APIModel):
    """All option lists that drive the AI application registration form.

    Sourced from backend enums + curated catalogs so the frontend never
    hardcodes dropdown values.
    """

    risk_tiers: list[OptionItem]
    modalities: list[OptionItem]
    deployment_environments: list[OptionItem]
    application_types: list[OptionItem]
    domains: list[OptionItem]
    model_providers: list[OptionItem]
    capability_types: list[OptionItem]
    side_effect_levels: list[OptionItem]
    http_methods: list[OptionItem]
    statuses: list[OptionItem]
    # Enhanced registration catalogs (Phase 1)
    system_types: list[OptionItem] = Field(default_factory=list)
    business_domains: list[OptionItem] = Field(default_factory=list)
    lifecycle_stages: list[OptionItem] = Field(default_factory=list)
    production_criticalities: list[OptionItem] = Field(default_factory=list)
    internal_external_use: list[OptionItem] = Field(default_factory=list)
    output_usage: list[OptionItem] = Field(default_factory=list)
    human_oversight: list[OptionItem] = Field(default_factory=list)
    owner_roles: list[OptionItem] = Field(default_factory=list)
    model_types: list[OptionItem] = Field(default_factory=list)
    input_modalities: list[OptionItem] = Field(default_factory=list)
    output_types: list[OptionItem] = Field(default_factory=list)
    capability_tags: list[OptionItem] = Field(default_factory=list)
    gateway_types: list[OptionItem] = Field(default_factory=list)
    authentication_types: list[OptionItem] = Field(default_factory=list)
    exposure_types: list[OptionItem] = Field(default_factory=list)
    endpoint_statuses: list[OptionItem] = Field(default_factory=list)
    applicability_types: list[OptionItem] = Field(default_factory=list)
    # Phase 2 catalogs
    data_source_types: list[OptionItem] = Field(default_factory=list)
    data_classifications: list[OptionItem] = Field(default_factory=list)
    data_usage_purposes: list[OptionItem] = Field(default_factory=list)
    security_controls: list[OptionItem] = Field(default_factory=list)
    security_statuses: list[OptionItem] = Field(default_factory=list)
    dependency_types: list[OptionItem] = Field(default_factory=list)
    document_types: list[OptionItem] = Field(default_factory=list)
    confidentiality_levels: list[OptionItem] = Field(default_factory=list)


# ── Enhanced AI system registration: nested request + response ─────────────────

_EMAIL_RE = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
_URL_RE = r"^https?://.+"


def _normalize_email(value: object) -> object:
    if isinstance(value, str):
        text = value.strip()
        return text or None
    return value


class RegistrationSystemInput(APIModel):
    """Core System Identity facts. risk_tier + selected_frameworks are DERIVED."""

    name: str = Field(min_length=1, max_length=200)
    version: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    business_purpose: str | None = Field(default=None, max_length=2000)
    system_type: str | None = Field(default=None, max_length=100)
    business_domain: str | None = Field(default=None, max_length=100)
    lifecycle_stage: str | None = Field(default=None, max_length=100)
    deployment_environment: str = Field(default="development", max_length=100)
    modality: Modality = Modality.text
    business_unit: str | None = Field(default=None, max_length=200)
    product_name: str | None = Field(default=None, max_length=200)
    internal_identifier: str | None = Field(default=None, max_length=200)
    production_criticality: str | None = Field(default=None, max_length=100)
    notes: str | None = Field(default=None, max_length=2000)


class RegistrationUsageContextInput(APIModel):
    primary_use_case: str | None = Field(default=None, max_length=2000)
    intended_users: str | None = Field(default=None, max_length=500)
    internal_external_use: str | None = Field(default=None, max_length=100)
    output_usage: str | None = Field(default=None, max_length=100)
    human_oversight: str | None = Field(default=None, max_length=100)
    input_modalities: list[str] = Field(default_factory=list)
    output_types: list[str] = Field(default_factory=list)
    capabilities: list[str] = Field(default_factory=list)
    metadata_json: dict[str, Any] = Field(default_factory=dict)


class RegistrationOwnerInput(APIModel):
    role: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=200)
    email: str | None = Field(default=None, max_length=320, pattern=_EMAIL_RE)
    is_primary: bool = False

    @field_validator("email", mode="before")
    @classmethod
    def clean_email(cls, value: object) -> object:
        return _normalize_email(value)


class RegistrationModelInput(APIModel):
    name: str = Field(min_length=1, max_length=200)
    provider: str = Field(min_length=1, max_length=100)
    version: str | None = Field(default=None, max_length=100)
    deployment_name: str | None = Field(default=None, max_length=200)
    model_type: str | None = Field(default=None, max_length=100)
    purpose: str | None = Field(default=None, max_length=500)
    hosting_platform: str | None = Field(default=None, max_length=200)
    hosting_region: str | None = Field(default=None, max_length=100)
    base_model: str | None = Field(default=None, max_length=200)
    is_fine_tuned: bool = False
    is_open_source: bool = False
    is_third_party: bool = True
    input_modalities: list[str] = Field(default_factory=list)
    output_modalities: list[str] = Field(default_factory=list)
    safety_filters_enabled: bool = True
    fallback_model: str | None = Field(default=None, max_length=200)
    documentation_url: str | None = Field(default=None, max_length=1000)


class RegistrationEndpointInput(APIModel):
    name: str = Field(min_length=1, max_length=200)
    url: str = Field(min_length=1, max_length=1000, pattern=_URL_RE)
    purpose: str | None = Field(default=None, max_length=500)
    http_method: str = Field(default="POST", pattern="^(GET|POST|PUT|PATCH|DELETE)$")
    environment: str = Field(default="development", max_length=100)
    model_ref: str | None = Field(default=None, max_length=200)
    gateway_type: str | None = Field(default=None, max_length=100)
    authentication_type: str | None = Field(default=None, max_length=100)
    exposure_type: str | None = Field(default=None, max_length=100)
    is_public: bool = False
    input_format: str | None = Field(default=None, max_length=100)
    output_format: str | None = Field(default=None, max_length=100)
    rate_limit: int | None = Field(default=None, ge=0)
    timeout_seconds: int | None = Field(default=None, ge=0)
    logging_enabled: bool = True
    monitoring_enabled: bool = True
    pii_allowed: bool = False
    retention_days: int | None = Field(default=None, ge=0)
    status: EndpointStatus = EndpointStatus.active

    @field_validator("http_method", mode="before")
    @classmethod
    def normalize_http_method(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip().upper()
        return value


class RegistrationFrameworkInput(APIModel):
    framework_id: str = Field(min_length=1, max_length=100)
    applicability_type: ApplicabilityType = ApplicabilityType.unsure
    applicability_note: str | None = Field(default=None, max_length=2000)


class RegistrationRiskScreeningInput(APIModel):
    answers: dict[str, str] = Field(default_factory=dict)

    @field_validator("answers")
    @classmethod
    def validate_answers(cls, value: dict[str, str]) -> dict[str, str]:
        allowed = {"yes", "no", "unknown"}
        for key, answer in value.items():
            if str(answer).strip().lower() not in allowed:
                raise ValueError(
                    f"Answer for '{key}' must be one of yes/no/unknown, got '{answer}'."
                )
        return value


class RegistrationDataSourceInput(APIModel):
    name: str = Field(min_length=1, max_length=200)
    source_type: str | None = Field(default=None, max_length=100)
    classification: str | None = Field(default=None, max_length=100)
    usage_purpose: str | None = Field(default=None, max_length=100)
    data_owner: str | None = Field(default=None, max_length=200)
    source_location: str | None = Field(default=None, max_length=300)
    residency: str | None = Field(default=None, max_length=100)
    retention_days: int | None = Field(default=None, ge=0)
    used_for_training: bool = False
    used_for_fine_tuning: bool = False
    used_for_inference: bool = False
    used_for_rag: bool = False
    external_sharing: bool = False
    contains_personal_data: bool = False
    contains_sensitive_personal_data: bool = False
    contains_confidential_data: bool = False
    contains_health_data: bool = False
    contains_financial_data: bool = False
    contains_biometric_data: bool = False
    contains_minors_data: bool = False


class RegistrationRAGConfigInput(APIModel):
    knowledge_base_name: str | None = Field(default=None, max_length=200)
    vector_database: str | None = Field(default=None, max_length=100)
    embedding_model: str | None = Field(default=None, max_length=200)
    reranking_model: str | None = Field(default=None, max_length=200)
    retrieval_strategy: str | None = Field(default=None, max_length=100)
    top_k: int | None = Field(default=None, ge=0)
    citations_enabled: bool = False
    access_control_applied: bool = False
    document_refresh_frequency: str | None = Field(default=None, max_length=100)


class RegistrationAgentConfigInput(APIModel):
    agent_purpose: str | None = Field(default=None, max_length=2000)
    num_agents: int | None = Field(default=None, ge=0)
    tools_used: list[str] = Field(default_factory=list)
    external_systems: list[str] = Field(default_factory=list)
    read_access: bool = False
    write_access: bool = False
    can_send_messages: bool = False
    can_modify_files: bool = False
    can_write_database: bool = False
    can_execute_code: bool = False
    human_approval_required: bool = False
    max_steps: int | None = Field(default=None, ge=0)
    max_execution_seconds: int | None = Field(default=None, ge=0)
    persistent_memory_enabled: bool = False


class RegistrationSecurityControlInput(APIModel):
    control_key: str = Field(min_length=1, max_length=100)
    implementation_status: str = Field(default="unknown", max_length=50)
    notes: str | None = Field(default=None, max_length=2000)


class RegistrationDependencyInput(APIModel):
    name: str = Field(min_length=1, max_length=200)
    service_purpose: str | None = Field(default=None, max_length=500)
    dependency_type: str | None = Field(default=None, max_length=100)
    data_shared: str | None = Field(default=None, max_length=500)
    hosting_region: str | None = Field(default=None, max_length=100)
    is_critical: bool = False
    is_third_party_api: bool = False
    contract_sla_available: bool = False
    exit_option: str | None = Field(default=None, max_length=500)


class RegistrationDocumentInput(APIModel):
    name: str = Field(min_length=1, max_length=300)
    document_type: str | None = Field(default=None, max_length=100)
    version: str | None = Field(default=None, max_length=100)
    document_owner: str | None = Field(default=None, max_length=200)
    related_framework: str | None = Field(default=None, max_length=100)
    confidentiality_level: str | None = Field(default=None, max_length=100)
    storage_ref: str | None = Field(default=None, max_length=1000)
    content_type: str | None = Field(default=None, max_length=200)
    file_size: int | None = Field(default=None, ge=0)
    notes: str | None = Field(default=None, max_length=2000)


class AISystemRegistrationCreate(APIModel):
    status: Literal["draft", "registered"] = "registered"
    system: RegistrationSystemInput
    usage_context: RegistrationUsageContextInput | None = None
    owners: list[RegistrationOwnerInput] = Field(default_factory=list)
    models: list[RegistrationModelInput] = Field(default_factory=list)
    endpoints: list[RegistrationEndpointInput] = Field(default_factory=list)
    frameworks: list[RegistrationFrameworkInput] = Field(default_factory=list)
    risk_screening: RegistrationRiskScreeningInput | None = None
    # Phase 2 (all optional)
    data_sources: list[RegistrationDataSourceInput] = Field(default_factory=list)
    rag_configuration: RegistrationRAGConfigInput | None = None
    agent_configuration: RegistrationAgentConfigInput | None = None
    security_posture: list[RegistrationSecurityControlInput] = Field(default_factory=list)
    dependencies: list[RegistrationDependencyInput] = Field(default_factory=list)
    documents: list[RegistrationDocumentInput] = Field(default_factory=list)


class AISystemOwnerRead(APIModel):
    id: UUID
    ai_system_id: UUID
    role: str
    name: str
    email: str | None = None
    is_primary: bool
    created_at: datetime
    updated_at: datetime | None = None


class AISystemModelRead(APIModel):
    id: UUID
    ai_system_id: UUID
    name: str
    provider: str
    version: str | None = None
    deployment_name: str | None = None
    model_type: str | None = None
    purpose: str | None = None
    hosting_platform: str | None = None
    hosting_region: str | None = None
    base_model: str | None = None
    is_fine_tuned: bool
    is_open_source: bool
    is_third_party: bool
    input_modalities: list[str] = Field(default_factory=list)
    output_modalities: list[str] = Field(default_factory=list)
    safety_filters_enabled: bool
    fallback_model: str | None = None
    documentation_url: str | None = None
    created_at: datetime
    updated_at: datetime | None = None


class AISystemEndpointRead(APIModel):
    id: UUID
    ai_system_id: UUID
    model_id: UUID | None = None
    name: str
    url: str
    purpose: str | None = None
    http_method: str
    environment: str
    gateway_type: str | None = None
    authentication_type: str | None = None
    exposure_type: str | None = None
    is_public: bool
    input_format: str | None = None
    output_format: str | None = None
    rate_limit: int | None = None
    timeout_seconds: int | None = None
    logging_enabled: bool
    monitoring_enabled: bool
    pii_allowed: bool
    retention_days: int | None = None
    status: EndpointStatus
    created_at: datetime
    updated_at: datetime | None = None


class AISystemFrameworkRead(APIModel):
    id: UUID
    ai_system_id: UUID
    framework_id: str
    applicability_type: ApplicabilityType
    applicability_note: str | None = None
    created_at: datetime
    updated_at: datetime | None = None


class AISystemUsageContextRead(APIModel):
    id: UUID
    ai_system_id: UUID
    primary_use_case: str | None = None
    intended_users: str | None = None
    internal_external_use: str | None = None
    output_usage: str | None = None
    human_oversight: str | None = None
    business_domain: str | None = None
    lifecycle_stage: str | None = None
    production_criticality: str | None = None
    input_modalities: list[str] = Field(default_factory=list)
    output_types: list[str] = Field(default_factory=list)
    capabilities: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime | None = None


class AISystemRiskScreeningRead(APIModel):
    id: UUID
    ai_system_id: UUID
    answers: dict[str, str] = Field(default_factory=dict)
    preliminary_risk_score: int
    preliminary_risk_tier: str
    triggered_risk_factors: list[str] = Field(default_factory=list)
    risk_summary: str | None = None
    created_at: datetime
    updated_at: datetime | None = None


class AISystemDataSourceRead(RegistrationDataSourceInput):
    id: UUID
    ai_system_id: UUID
    created_at: datetime
    updated_at: datetime | None = None


class AISystemRAGConfigRead(RegistrationRAGConfigInput):
    id: UUID
    ai_system_id: UUID
    created_at: datetime
    updated_at: datetime | None = None


class AISystemAgentConfigRead(RegistrationAgentConfigInput):
    id: UUID
    ai_system_id: UUID
    created_at: datetime
    updated_at: datetime | None = None


class AISystemSecurityControlRead(RegistrationSecurityControlInput):
    id: UUID
    ai_system_id: UUID
    created_at: datetime
    updated_at: datetime | None = None


class AISystemDependencyRead(RegistrationDependencyInput):
    id: UUID
    ai_system_id: UUID
    created_at: datetime
    updated_at: datetime | None = None


class AISystemDocumentRead(RegistrationDocumentInput):
    id: UUID
    ai_system_id: UUID
    created_at: datetime
    updated_at: datetime | None = None


class AISystemRegistrationRead(APIModel):
    """Complete registered AI system with nested children + preliminary risk."""

    system: AISystemRead
    usage_context: AISystemUsageContextRead | None = None
    owners: list[AISystemOwnerRead] = Field(default_factory=list)
    models: list[AISystemModelRead] = Field(default_factory=list)
    endpoints: list[AISystemEndpointRead] = Field(default_factory=list)
    frameworks: list[AISystemFrameworkRead] = Field(default_factory=list)
    capabilities: list[AISystemCapabilityRead] = Field(default_factory=list)
    risk_screening: AISystemRiskScreeningRead | None = None
    data_sources: list[AISystemDataSourceRead] = Field(default_factory=list)
    rag_configuration: AISystemRAGConfigRead | None = None
    agent_configuration: AISystemAgentConfigRead | None = None
    security_posture: list[AISystemSecurityControlRead] = Field(default_factory=list)
    dependencies: list[AISystemDependencyRead] = Field(default_factory=list)
    documents: list[AISystemDocumentRead] = Field(default_factory=list)
    preliminary_risk_score: int = 0
    preliminary_risk_tier: str = "unassessed"
    triggered_risk_factors: list[str] = Field(default_factory=list)
    profile_completeness: float = 0.0
    missing_recommended_fields: list[str] = Field(default_factory=list)
    registration_status: Literal["draft", "registered"] = "registered"


class AssessmentRequestCreate(APIModel):
    note: str | None = Field(default=None, max_length=2000)


class AssessmentRequestRead(APIModel):
    id: UUID
    ai_system_id: UUID
    note: str | None = None
    status: AssessmentRequestStatus
    requested_by_name: str
    requested_by_email: str
    requested_by_role: str
    resolved_run_id: UUID | None = None
    resolved_at: datetime | None = None
    created_at: datetime
    updated_at: datetime | None = None


class AssessmentRequestStatusUpdate(APIModel):
    status: AssessmentRequestStatus
    resolved_run_id: UUID | None = None
