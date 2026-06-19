"""add metric and framework config tables

Revision ID: a4e9d2c8b731
Revises: f3d8e21c4b69
Create Date: 2026-06-16 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel
from alembic import op

revision: str = "a4e9d2c8b731"
down_revision: str | None = "f3d8e21c4b69"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "metric_configs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("metric_id", sqlmodel.sql.sqltypes.AutoString(length=100), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(length=200), nullable=False),
        sa.Column(
            "description",
            sqlmodel.sql.sqltypes.AutoString(length=2000),
            nullable=True,
        ),
        sa.Column("dimension", sqlmodel.sql.sqltypes.AutoString(length=200), nullable=False),
        sa.Column(
            "primary_agent",
            sqlmodel.sql.sqltypes.AutoString(length=100),
            nullable=True,
        ),
        sa.Column("tool_name", sqlmodel.sql.sqltypes.AutoString(length=100), nullable=True),
        sa.Column("framework_ids", sa.JSON(), nullable=False),
        sa.Column("modality", sqlmodel.sql.sqltypes.AutoString(length=100), nullable=True),
        sa.Column("threshold_rules", sa.JSON(), nullable=False),
        sa.Column("scoring_config", sa.JSON(), nullable=False),
        sa.Column("version", sqlmodel.sql.sqltypes.AutoString(length=50), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("metric_id", "version"),
    )
    op.create_index(op.f("ix_metric_configs_dimension"), "metric_configs", ["dimension"])
    op.create_index(op.f("ix_metric_configs_enabled"), "metric_configs", ["enabled"])
    op.create_index(op.f("ix_metric_configs_id"), "metric_configs", ["id"])
    op.create_index(op.f("ix_metric_configs_metric_id"), "metric_configs", ["metric_id"])
    op.create_index(op.f("ix_metric_configs_modality"), "metric_configs", ["modality"])
    op.create_index(
        op.f("ix_metric_configs_primary_agent"),
        "metric_configs",
        ["primary_agent"],
    )
    op.create_index(op.f("ix_metric_configs_tool_name"), "metric_configs", ["tool_name"])
    op.create_index(op.f("ix_metric_configs_version"), "metric_configs", ["version"])

    op.create_table(
        "framework_mappings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column(
            "framework_id",
            sqlmodel.sql.sqltypes.AutoString(length=100),
            nullable=False,
        ),
        sa.Column(
            "framework_name",
            sqlmodel.sql.sqltypes.AutoString(length=200),
            nullable=False,
        ),
        sa.Column(
            "framework_version",
            sqlmodel.sql.sqltypes.AutoString(length=50),
            nullable=False,
        ),
        sa.Column("control_ref", sqlmodel.sql.sqltypes.AutoString(length=100), nullable=False),
        sa.Column(
            "control_title",
            sqlmodel.sql.sqltypes.AutoString(length=300),
            nullable=True,
        ),
        sa.Column(
            "control_category",
            sqlmodel.sql.sqltypes.AutoString(length=150),
            nullable=True,
        ),
        sa.Column("jurisdiction", sqlmodel.sql.sqltypes.AutoString(length=100), nullable=True),
        sa.Column("requirement_text", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("metric_ids", sa.JSON(), nullable=False),
        sa.Column("agent_names", sa.JSON(), nullable=False),
        sa.Column("risk_tiers", sa.JSON(), nullable=False),
        sa.Column("evidence_requirements", sa.JSON(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("framework_id", "framework_version", "control_ref"),
    )
    op.create_index(
        op.f("ix_framework_mappings_control_category"),
        "framework_mappings",
        ["control_category"],
    )
    op.create_index(
        op.f("ix_framework_mappings_control_ref"),
        "framework_mappings",
        ["control_ref"],
    )
    op.create_index(
        op.f("ix_framework_mappings_enabled"),
        "framework_mappings",
        ["enabled"],
    )
    op.create_index(
        op.f("ix_framework_mappings_framework_id"),
        "framework_mappings",
        ["framework_id"],
    )
    op.create_index(
        op.f("ix_framework_mappings_framework_version"),
        "framework_mappings",
        ["framework_version"],
    )
    op.create_index(op.f("ix_framework_mappings_id"), "framework_mappings", ["id"])
    op.create_index(
        op.f("ix_framework_mappings_jurisdiction"),
        "framework_mappings",
        ["jurisdiction"],
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_framework_mappings_jurisdiction"), "framework_mappings")
    op.drop_index(op.f("ix_framework_mappings_id"), "framework_mappings")
    op.drop_index(op.f("ix_framework_mappings_framework_version"), "framework_mappings")
    op.drop_index(op.f("ix_framework_mappings_framework_id"), "framework_mappings")
    op.drop_index(op.f("ix_framework_mappings_enabled"), "framework_mappings")
    op.drop_index(op.f("ix_framework_mappings_control_ref"), "framework_mappings")
    op.drop_index(op.f("ix_framework_mappings_control_category"), "framework_mappings")
    op.drop_table("framework_mappings")

    op.drop_index(op.f("ix_metric_configs_version"), "metric_configs")
    op.drop_index(op.f("ix_metric_configs_tool_name"), "metric_configs")
    op.drop_index(op.f("ix_metric_configs_primary_agent"), "metric_configs")
    op.drop_index(op.f("ix_metric_configs_modality"), "metric_configs")
    op.drop_index(op.f("ix_metric_configs_metric_id"), "metric_configs")
    op.drop_index(op.f("ix_metric_configs_id"), "metric_configs")
    op.drop_index(op.f("ix_metric_configs_enabled"), "metric_configs")
    op.drop_index(op.f("ix_metric_configs_dimension"), "metric_configs")
    op.drop_table("metric_configs")
