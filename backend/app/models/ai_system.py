from typing import Any
from uuid import UUID

from sqlalchemy import JSON, Column, UniqueConstraint
from sqlmodel import Field

from app.models.base import TimestampMixin, UUIDPrimaryKey
from app.models.enums import (
    AISystemStatus,
    CapabilityType,
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


class AISystemCapability(TimestampMixin, UUIDPrimaryKey, table=True):
    __tablename__ = "ai_system_capabilities"
    __table_args__ = (UniqueConstraint("ai_system_id", "name"),)

    ai_system_id: UUID = Field(foreign_key="ai_systems.id", index=True)
    name: str = Field(index=True, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    capability_type: CapabilityType = Field(default=CapabilityType.other, index=True)
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
