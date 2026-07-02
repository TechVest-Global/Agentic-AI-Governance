from typing import Any

from sqlalchemy import JSON, Column, UniqueConstraint
from sqlmodel import Field

from app.models.base import TimestampMixin, UUIDPrimaryKey


class MetricConfig(TimestampMixin, UUIDPrimaryKey, table=True):
    __tablename__ = "metric_configs"
    __table_args__ = (UniqueConstraint("metric_id", "version"),)

    metric_id: str = Field(index=True, min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    dimension: str = Field(index=True, min_length=1, max_length=200)
    primary_agent: str | None = Field(default=None, index=True, max_length=100)
    tool_name: str | None = Field(default=None, index=True, max_length=100)
    framework_ids: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    modality: str | None = Field(default=None, index=True, max_length=100)
    # Empty means universally applicable. Non-empty restricts this metric to
    # AI systems that have at least one capability of that type / that
    # modality — see services.specialist_agents.metric_plans for the filter.
    applicable_capability_types: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    applicable_modalities: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    threshold_rules: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False),
    )
    scoring_config: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False),
    )
    version: str = Field(default="v1", index=True, max_length=50)
    enabled: bool = Field(default=True, index=True)
    metadata_json: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column("metadata_json", JSON, nullable=False),
    )


class FrameworkMapping(TimestampMixin, UUIDPrimaryKey, table=True):
    __tablename__ = "framework_mappings"
    __table_args__ = (
        UniqueConstraint("framework_id", "framework_version", "control_ref"),
    )

    framework_id: str = Field(index=True, min_length=1, max_length=100)
    framework_name: str = Field(min_length=1, max_length=200)
    framework_version: str = Field(default="v1", index=True, max_length=50)
    control_ref: str = Field(index=True, min_length=1, max_length=100)
    control_title: str | None = Field(default=None, max_length=300)
    control_category: str | None = Field(default=None, index=True, max_length=150)
    jurisdiction: str | None = Field(default=None, index=True, max_length=100)
    requirement_text: str | None = None
    metric_ids: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    agent_names: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    risk_tiers: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    evidence_requirements: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    enabled: bool = Field(default=True, index=True)
    metadata_json: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column("metadata_json", JSON, nullable=False),
    )
