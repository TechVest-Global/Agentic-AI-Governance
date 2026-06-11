from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import (
    ActionTier,
    AISystemStatus,
    FindingStatus,
    MetricResultStatus,
    RiskTier,
    RunPhase,
    RunStatus,
    Severity,
)


class APIModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


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


class ApplicationContextProfileCreate(APIModel):
    section_a: dict[str, Any] = Field(default_factory=dict)
    section_b: dict[str, Any] = Field(default_factory=dict)
    section_c: dict[str, Any] = Field(default_factory=dict)
    section_d: dict[str, Any] = Field(default_factory=dict)
    section_e: dict[str, Any] = Field(default_factory=dict)


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


class EvidenceRecordRead(APIModel):
    id: UUID
    run_id: UUID
    source_type: str
    source_name: str
    tool_name: str | None = None
    tool_version: str | None = None
    input_ref: str | None = None
    output_ref: str | None = None
    raw_score: float | None = None
    normalized_score: float | None = None
    threshold: float | None = None
    passed: bool | None = None
    trace_id: str | None = None
    sensitivity: str
    payload: dict[str, Any]
    created_at: datetime
    updated_at: datetime | None = None


class MetricResultRead(APIModel):
    id: UUID
    run_id: UUID
    metric_id: str
    dimension: str
    tool_name: str
    status: MetricResultStatus
    raw_score: float | None = None
    normalized_score: float | None = None
    threshold: float | None = None
    passed: bool | None = None
    evidence_ids: list[str]
    created_at: datetime
    updated_at: datetime | None = None


class FindingRead(APIModel):
    id: UUID
    run_id: UUID
    finding_type: str
    title: str
    summary: str
    severity: Severity
    confidence: float
    dimension: str
    framework_refs: list[str]
    evidence_ids: list[str]
    agent_name: str | None = None
    recommended_action: str | None = None
    status: FindingStatus
    payload: dict[str, Any]
    created_at: datetime
    updated_at: datetime | None = None


class VerdictRead(APIModel):
    id: UUID
    run_id: UUID
    confidence_score: float
    action_tier: ActionTier
    label: str
    synthesis: str | None = None
    objections: list[dict[str, Any]]
    reasoning: str | None = None
    required_actions: list[dict[str, Any]]
    created_at: datetime
    updated_at: datetime | None = None
