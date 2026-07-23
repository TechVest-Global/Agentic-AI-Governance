from typing import Any
from uuid import UUID

from sqlalchemy import JSON, Column, Text, UniqueConstraint
from sqlmodel import Field

from app.models.base import TimestampMixin, UUIDPrimaryKey
from app.models.enums import (
    AISystemStatus,
    ApplicabilityType,
    CapabilityType,
    EndpointStatus,
    Modality,
    RiskTier,
    SideEffectLevel,
)


class AISystem(TimestampMixin, UUIDPrimaryKey, table=True):
    __tablename__ = "ai_systems"

    name: str = Field(index=True, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    owner: str = Field(index=True, min_length=1, max_length=200)
    system_type: str = Field(index=True, min_length=1, max_length=100)
    risk_tier: RiskTier = Field(default=RiskTier.medium, index=True)
    deployment_environment: str = Field(default="local", index=True, max_length=100)
    status: AISystemStatus = Field(default=AISystemStatus.registered, index=True)
    # Primary I/O modality — used to scope out modality-specific metrics (e.g.
    # video/audio robustness checks) for systems they don't apply to.
    modality: Modality = Field(default=Modality.text, index=True)
    selected_frameworks: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    model_provider: str = Field(default="azure_foundry", max_length=100)
    model_name: str | None = Field(default=None, max_length=200)
    model_version: str | None = Field(default=None, max_length=100)
    target_endpoint_ref: str | None = Field(default=None, max_length=500)
    metadata_json: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column("metadata_json", JSON, nullable=False),
    )


class ApplicationContextProfile(TimestampMixin, UUIDPrimaryKey, table=True):
    __tablename__ = "application_context_profiles"

    ai_system_id: UUID = Field(foreign_key="ai_systems.id", index=True, unique=True)
    identity_purpose: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False),
    )
    pre_model_controls: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False),
    )
    model_configuration: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False),
    )
    post_model_controls: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False),
    )
    integration_context: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False),
    )


class RetrievalContextDocument(TimestampMixin, UUIDPrimaryKey, table=True):
    """A reference document a RAG system draws answers from.

    Seeded per AI system so real evidence tools (e.g. ragas) have actual
    question/context/answer triples to score, instead of an approximation.
    """

    __tablename__ = "retrieval_context_documents"

    ai_system_id: UUID = Field(foreign_key="ai_systems.id", index=True)
    title: str = Field(min_length=1, max_length=300)
    content: str = Field(min_length=1, sa_column=Column(Text, nullable=False))
    source_uri: str | None = Field(default=None, max_length=500)
    tags: list[str] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))


class AISystemCapability(TimestampMixin, UUIDPrimaryKey, table=True):
    __tablename__ = "ai_system_capabilities"
    __table_args__ = (UniqueConstraint("ai_system_id", "name"),)

    ai_system_id: UUID = Field(foreign_key="ai_systems.id", index=True)
    name: str = Field(index=True, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    capability_type: CapabilityType = Field(default=CapabilityType.other, index=True)
    modality: Modality = Field(default=Modality.text, index=True)
    endpoint_ref: str = Field(min_length=1, max_length=500)
    http_method: str = Field(default="POST", max_length=10)
    input_schema: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False),
    )
    output_schema: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False),
    )
    permissions: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    side_effect_level: SideEffectLevel = Field(
        default=SideEffectLevel.none,
        index=True,
    )
    requires_human_review: bool = Field(default=False, index=True)
    enabled: bool = Field(default=True, index=True)
    metadata_json: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column("metadata_json", JSON, nullable=False),
    )


# ── Enhanced registration: normalized fact tables (Phase 1) ───────────────────
# Developers register factual system information here. Governance derivation
# (A–E rules, control mapping, required metrics/evidence) is done later by the
# backend from these facts — it is deliberately NOT captured on registration.


class AISystemOwner(TimestampMixin, UUIDPrimaryKey, table=True):
    """A named governance/ownership contact for an AI system (many per system)."""

    __tablename__ = "ai_system_owners"

    ai_system_id: UUID = Field(foreign_key="ai_systems.id", index=True)
    role: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=200)
    email: str | None = Field(default=None, max_length=320)
    is_primary: bool = Field(default=False, index=True)
    metadata_json: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column("metadata_json", JSON, nullable=False),
    )


class AISystemModel(TimestampMixin, UUIDPrimaryKey, table=True):
    """A model powering an AI system (many per system)."""

    __tablename__ = "ai_system_models"
    __table_args__ = (UniqueConstraint("ai_system_id", "name"),)

    ai_system_id: UUID = Field(foreign_key="ai_systems.id", index=True)
    name: str = Field(min_length=1, max_length=200)
    provider: str = Field(min_length=1, max_length=100)
    version: str | None = Field(default=None, max_length=100)
    deployment_name: str | None = Field(default=None, max_length=200)
    model_type: str | None = Field(default=None, max_length=100)
    purpose: str | None = Field(default=None, max_length=500)
    hosting_platform: str | None = Field(default=None, max_length=200)
    hosting_region: str | None = Field(default=None, max_length=100)
    base_model: str | None = Field(default=None, max_length=200)
    is_fine_tuned: bool = Field(default=False)
    is_open_source: bool = Field(default=False)
    is_third_party: bool = Field(default=True)
    input_modalities: list[str] = Field(
        default_factory=list,
        sa_column=Column("input_modalities", JSON, nullable=False),
    )
    output_modalities: list[str] = Field(
        default_factory=list,
        sa_column=Column("output_modalities", JSON, nullable=False),
    )
    safety_filters_enabled: bool = Field(default=True)
    fallback_model: str | None = Field(default=None, max_length=200)
    documentation_url: str | None = Field(default=None, max_length=1000)
    metadata_json: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column("metadata_json", JSON, nullable=False),
    )


class AISystemEndpoint(TimestampMixin, UUIDPrimaryKey, table=True):
    """A deployed target API endpoint for an AI system (many per system).

    Distinct from ``AISystemCapability`` (engine-facing, executable): this row
    captures the deployment/network surface — gateway, auth, exposure, limits,
    PII/retention posture — that governance later reasons about.
    """

    __tablename__ = "ai_system_endpoints"
    __table_args__ = (UniqueConstraint("ai_system_id", "name"),)

    ai_system_id: UUID = Field(foreign_key="ai_systems.id", index=True)
    model_id: UUID | None = Field(
        default=None, foreign_key="ai_system_models.id", index=True
    )
    name: str = Field(min_length=1, max_length=200)
    url: str = Field(min_length=1, max_length=1000)
    purpose: str | None = Field(default=None, max_length=500)
    http_method: str = Field(default="POST", max_length=10)
    environment: str = Field(default="development", max_length=100)
    gateway_type: str | None = Field(default=None, max_length=100)
    authentication_type: str | None = Field(default=None, max_length=100)
    exposure_type: str | None = Field(default=None, max_length=100)
    is_public: bool = Field(default=False, index=True)
    input_format: str | None = Field(default=None, max_length=100)
    output_format: str | None = Field(default=None, max_length=100)
    rate_limit: int | None = Field(default=None, ge=0)
    timeout_seconds: int | None = Field(default=None, ge=0)
    logging_enabled: bool = Field(default=True)
    monitoring_enabled: bool = Field(default=True)
    pii_allowed: bool = Field(default=False)
    retention_days: int | None = Field(default=None, ge=0)
    status: EndpointStatus = Field(default=EndpointStatus.active, index=True)
    metadata_json: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column("metadata_json", JSON, nullable=False),
    )


class AISystemFramework(TimestampMixin, UUIDPrimaryKey, table=True):
    """A framework a system is registered against, with applicability metadata.

    Normalized companion to the engine-facing JSON ``AISystem.selected_frameworks``;
    both are written in the same transaction so they never drift.
    """

    __tablename__ = "ai_system_frameworks"
    __table_args__ = (UniqueConstraint("ai_system_id", "framework_id"),)

    ai_system_id: UUID = Field(foreign_key="ai_systems.id", index=True)
    framework_id: str = Field(min_length=1, max_length=100, index=True)
    applicability_type: ApplicabilityType = Field(default=ApplicabilityType.unsure)
    applicability_note: str | None = Field(default=None, max_length=2000)


class AISystemUsageContext(TimestampMixin, UUIDPrimaryKey, table=True):
    """Usage/application context for an AI system (one per system).

    Scalar dropdowns are columns; small controlled-vocabulary selections
    (modalities / output types / self-declared capability tags) stay as JSON
    arrays, matching how the codebase stores other vocab lists.
    """

    __tablename__ = "ai_system_usage_contexts"

    ai_system_id: UUID = Field(foreign_key="ai_systems.id", index=True, unique=True)
    primary_use_case: str | None = Field(default=None, sa_column=Column(Text))
    intended_users: str | None = Field(default=None, max_length=500)
    internal_external_use: str | None = Field(default=None, max_length=100)
    output_usage: str | None = Field(default=None, max_length=100)
    human_oversight: str | None = Field(default=None, max_length=100)
    business_domain: str | None = Field(default=None, max_length=100)
    lifecycle_stage: str | None = Field(default=None, max_length=100)
    production_criticality: str | None = Field(default=None, max_length=100)
    input_modalities: list[str] = Field(
        default_factory=list,
        sa_column=Column("input_modalities", JSON, nullable=False),
    )
    output_types: list[str] = Field(
        default_factory=list,
        sa_column=Column("output_types", JSON, nullable=False),
    )
    capabilities: list[str] = Field(
        default_factory=list,
        sa_column=Column("capabilities", JSON, nullable=False),
    )
    metadata_json: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column("metadata_json", JSON, nullable=False),
    )


class AISystemRiskScreening(TimestampMixin, UUIDPrimaryKey, table=True):
    """Preliminary (non-final) risk screening derived from registration facts.

    ``preliminary_risk_tier`` uses the full scale (unassessed/low/medium/high/
    critical) as a plain string so it can hold values outside the 3-value
    ``RiskTier`` enum that the orchestrator consumes.
    """

    __tablename__ = "ai_system_risk_screenings"

    ai_system_id: UUID = Field(foreign_key="ai_systems.id", index=True, unique=True)
    answers: dict[str, str] = Field(
        default_factory=dict,
        sa_column=Column("answers", JSON, nullable=False),
    )
    preliminary_risk_score: int = Field(default=0)
    preliminary_risk_tier: str = Field(default="unassessed", max_length=20)
    triggered_risk_factors: list[str] = Field(
        default_factory=list,
        sa_column=Column("triggered_risk_factors", JSON, nullable=False),
    )
    risk_summary: str | None = Field(default=None, sa_column=Column(Text))
    metadata_json: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column("metadata_json", JSON, nullable=False),
    )


# ── Enhanced registration: Phase 2 fact tables ────────────────────────────────
# Data sources & privacy, RAG/agent configuration, security posture,
# dependencies, and document metadata. All optional at registration time.


class AISystemDataSource(TimestampMixin, UUIDPrimaryKey, table=True):
    """A data source an AI system draws on, plus privacy screening (many per system)."""

    __tablename__ = "ai_system_data_sources"

    ai_system_id: UUID = Field(foreign_key="ai_systems.id", index=True)
    name: str = Field(min_length=1, max_length=200)
    source_type: str | None = Field(default=None, max_length=100)
    classification: str | None = Field(default=None, max_length=100)
    usage_purpose: str | None = Field(default=None, max_length=100)
    data_owner: str | None = Field(default=None, max_length=200)
    source_location: str | None = Field(default=None, max_length=300)
    residency: str | None = Field(default=None, max_length=100)
    retention_days: int | None = Field(default=None, ge=0)
    used_for_training: bool = Field(default=False)
    used_for_fine_tuning: bool = Field(default=False)
    used_for_inference: bool = Field(default=False)
    used_for_rag: bool = Field(default=False, index=True)
    external_sharing: bool = Field(default=False)
    contains_personal_data: bool = Field(default=False)
    contains_sensitive_personal_data: bool = Field(default=False)
    contains_confidential_data: bool = Field(default=False)
    contains_health_data: bool = Field(default=False)
    contains_financial_data: bool = Field(default=False)
    contains_biometric_data: bool = Field(default=False)
    contains_minors_data: bool = Field(default=False)
    metadata_json: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column("metadata_json", JSON, nullable=False),
    )


class AISystemRAGConfig(TimestampMixin, UUIDPrimaryKey, table=True):
    """Retrieval-augmented-generation configuration (one per system, conditional)."""

    __tablename__ = "ai_system_rag_configs"

    ai_system_id: UUID = Field(foreign_key="ai_systems.id", index=True, unique=True)
    knowledge_base_name: str | None = Field(default=None, max_length=200)
    vector_database: str | None = Field(default=None, max_length=100)
    embedding_model: str | None = Field(default=None, max_length=200)
    reranking_model: str | None = Field(default=None, max_length=200)
    retrieval_strategy: str | None = Field(default=None, max_length=100)
    top_k: int | None = Field(default=None, ge=0)
    citations_enabled: bool = Field(default=False)
    access_control_applied: bool = Field(default=False)
    document_refresh_frequency: str | None = Field(default=None, max_length=100)
    metadata_json: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column("metadata_json", JSON, nullable=False),
    )


class AISystemAgentConfig(TimestampMixin, UUIDPrimaryKey, table=True):
    """Autonomous-agent configuration (one per system, conditional)."""

    __tablename__ = "ai_system_agent_configs"

    ai_system_id: UUID = Field(foreign_key="ai_systems.id", index=True, unique=True)
    agent_purpose: str | None = Field(default=None, sa_column=Column(Text))
    num_agents: int | None = Field(default=None, ge=0)
    tools_used: list[str] = Field(
        default_factory=list, sa_column=Column("tools_used", JSON, nullable=False)
    )
    external_systems: list[str] = Field(
        default_factory=list, sa_column=Column("external_systems", JSON, nullable=False)
    )
    read_access: bool = Field(default=False)
    write_access: bool = Field(default=False)
    can_send_messages: bool = Field(default=False)
    can_modify_files: bool = Field(default=False)
    can_write_database: bool = Field(default=False)
    can_execute_code: bool = Field(default=False)
    human_approval_required: bool = Field(default=False)
    max_steps: int | None = Field(default=None, ge=0)
    max_execution_seconds: int | None = Field(default=None, ge=0)
    persistent_memory_enabled: bool = Field(default=False)
    metadata_json: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column("metadata_json", JSON, nullable=False),
    )


class AISystemSecurityControlStatus(TimestampMixin, UUIDPrimaryKey, table=True):
    """Developer-reported implementation status of a security control (many per system)."""

    __tablename__ = "ai_system_security_controls"
    __table_args__ = (UniqueConstraint("ai_system_id", "control_key"),)

    ai_system_id: UUID = Field(foreign_key="ai_systems.id", index=True)
    control_key: str = Field(min_length=1, max_length=100)
    implementation_status: str = Field(default="unknown", max_length=50)
    notes: str | None = Field(default=None, max_length=2000)
    metadata_json: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column("metadata_json", JSON, nullable=False),
    )


class AISystemDependency(TimestampMixin, UUIDPrimaryKey, table=True):
    """A vendor/service the AI system depends on (many per system)."""

    __tablename__ = "ai_system_dependencies"

    ai_system_id: UUID = Field(foreign_key="ai_systems.id", index=True)
    name: str = Field(min_length=1, max_length=200)
    service_purpose: str | None = Field(default=None, max_length=500)
    dependency_type: str | None = Field(default=None, max_length=100)
    data_shared: str | None = Field(default=None, max_length=500)
    hosting_region: str | None = Field(default=None, max_length=100)
    is_critical: bool = Field(default=False)
    is_third_party_api: bool = Field(default=False)
    contract_sla_available: bool = Field(default=False)
    exit_option: str | None = Field(default=None, max_length=500)
    metadata_json: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column("metadata_json", JSON, nullable=False),
    )


class AISystemDocument(TimestampMixin, UUIDPrimaryKey, table=True):
    """Governance document metadata (many per system).

    Stores metadata + an optional storage reference only — never file bytes.
    """

    __tablename__ = "ai_system_documents"

    ai_system_id: UUID = Field(foreign_key="ai_systems.id", index=True)
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
    metadata_json: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column("metadata_json", JSON, nullable=False),
    )
