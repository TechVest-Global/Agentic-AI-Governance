"""add enhanced registration phase 1 tables

Adds the normalized fact tables that back the production "Register AI System"
flow: owners, models, endpoints, framework applicability, usage context, and
preliminary risk screening. All additive — no existing table or column is
altered — so existing records and the orchestration engine are unaffected.

Revision ID: b1a2c3d4e5f6
Revises: ec74b9db49f0
Create Date: 2026-07-02 00:00:01.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b1a2c3d4e5f6"
down_revision: str | None = "ec74b9db49f0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Each enum is referenced by exactly one table below, so the type is created
    # once by that table's create_table() (create_type defaults to True). The
    # matching DROP TYPE lives in downgrade() since DROP TABLE leaves the type.
    applicability_enum = sa.Enum(
        "mandatory", "voluntary", "unsure", name="applicabilitytype"
    )
    endpoint_status_enum = sa.Enum(
        "draft", "active", "disabled", "deprecated", name="endpointstatus"
    )

    op.create_table(
        "ai_system_owners",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("ai_system_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(length=100), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("metadata_json", sa.JSON(), nullable=False, server_default="{}"),
        sa.ForeignKeyConstraint(["ai_system_id"], ["ai_systems.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_ai_system_owners_id"), "ai_system_owners", ["id"])
    op.create_index(
        op.f("ix_ai_system_owners_ai_system_id"), "ai_system_owners", ["ai_system_id"]
    )
    op.create_index(
        op.f("ix_ai_system_owners_is_primary"), "ai_system_owners", ["is_primary"]
    )

    op.create_table(
        "ai_system_models",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("ai_system_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("provider", sa.String(length=100), nullable=False),
        sa.Column("version", sa.String(length=100), nullable=True),
        sa.Column("deployment_name", sa.String(length=200), nullable=True),
        sa.Column("model_type", sa.String(length=100), nullable=True),
        sa.Column("purpose", sa.String(length=500), nullable=True),
        sa.Column("hosting_platform", sa.String(length=200), nullable=True),
        sa.Column("hosting_region", sa.String(length=100), nullable=True),
        sa.Column("base_model", sa.String(length=200), nullable=True),
        sa.Column("is_fine_tuned", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_open_source", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_third_party", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("input_modalities", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("output_modalities", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column(
            "safety_filters_enabled", sa.Boolean(), nullable=False, server_default=sa.true()
        ),
        sa.Column("fallback_model", sa.String(length=200), nullable=True),
        sa.Column("documentation_url", sa.String(length=1000), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False, server_default="{}"),
        sa.ForeignKeyConstraint(["ai_system_id"], ["ai_systems.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("ai_system_id", "name"),
    )
    op.create_index(op.f("ix_ai_system_models_id"), "ai_system_models", ["id"])
    op.create_index(
        op.f("ix_ai_system_models_ai_system_id"), "ai_system_models", ["ai_system_id"]
    )

    op.create_table(
        "ai_system_endpoints",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("ai_system_id", sa.Uuid(), nullable=False),
        sa.Column("model_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("url", sa.String(length=1000), nullable=False),
        sa.Column("purpose", sa.String(length=500), nullable=True),
        sa.Column("http_method", sa.String(length=10), nullable=False, server_default="POST"),
        sa.Column(
            "environment", sa.String(length=100), nullable=False, server_default="development"
        ),
        sa.Column("gateway_type", sa.String(length=100), nullable=True),
        sa.Column("authentication_type", sa.String(length=100), nullable=True),
        sa.Column("exposure_type", sa.String(length=100), nullable=True),
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("input_format", sa.String(length=100), nullable=True),
        sa.Column("output_format", sa.String(length=100), nullable=True),
        sa.Column("rate_limit", sa.Integer(), nullable=True),
        sa.Column("timeout_seconds", sa.Integer(), nullable=True),
        sa.Column("logging_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("monitoring_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("pii_allowed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("retention_days", sa.Integer(), nullable=True),
        sa.Column(
            "status",
            endpoint_status_enum,
            nullable=False,
            server_default="active",
        ),
        sa.Column("metadata_json", sa.JSON(), nullable=False, server_default="{}"),
        sa.ForeignKeyConstraint(["ai_system_id"], ["ai_systems.id"]),
        sa.ForeignKeyConstraint(["model_id"], ["ai_system_models.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("ai_system_id", "name"),
    )
    op.create_index(op.f("ix_ai_system_endpoints_id"), "ai_system_endpoints", ["id"])
    op.create_index(
        op.f("ix_ai_system_endpoints_ai_system_id"), "ai_system_endpoints", ["ai_system_id"]
    )
    op.create_index(
        op.f("ix_ai_system_endpoints_model_id"), "ai_system_endpoints", ["model_id"]
    )
    op.create_index(
        op.f("ix_ai_system_endpoints_is_public"), "ai_system_endpoints", ["is_public"]
    )

    op.create_table(
        "ai_system_frameworks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("ai_system_id", sa.Uuid(), nullable=False),
        sa.Column("framework_id", sa.String(length=100), nullable=False),
        sa.Column(
            "applicability_type",
            applicability_enum,
            nullable=False,
            server_default="unsure",
        ),
        sa.Column("applicability_note", sa.String(length=2000), nullable=True),
        sa.ForeignKeyConstraint(["ai_system_id"], ["ai_systems.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("ai_system_id", "framework_id"),
    )
    op.create_index(op.f("ix_ai_system_frameworks_id"), "ai_system_frameworks", ["id"])
    op.create_index(
        op.f("ix_ai_system_frameworks_ai_system_id"), "ai_system_frameworks", ["ai_system_id"]
    )
    op.create_index(
        op.f("ix_ai_system_frameworks_framework_id"), "ai_system_frameworks", ["framework_id"]
    )

    op.create_table(
        "ai_system_usage_contexts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("ai_system_id", sa.Uuid(), nullable=False),
        sa.Column("primary_use_case", sa.Text(), nullable=True),
        sa.Column("intended_users", sa.String(length=500), nullable=True),
        sa.Column("internal_external_use", sa.String(length=100), nullable=True),
        sa.Column("output_usage", sa.String(length=100), nullable=True),
        sa.Column("human_oversight", sa.String(length=100), nullable=True),
        sa.Column("business_domain", sa.String(length=100), nullable=True),
        sa.Column("lifecycle_stage", sa.String(length=100), nullable=True),
        sa.Column("production_criticality", sa.String(length=100), nullable=True),
        sa.Column("input_modalities", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("output_types", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("capabilities", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("metadata_json", sa.JSON(), nullable=False, server_default="{}"),
        sa.ForeignKeyConstraint(["ai_system_id"], ["ai_systems.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_ai_system_usage_contexts_id"), "ai_system_usage_contexts", ["id"]
    )
    op.create_index(
        op.f("ix_ai_system_usage_contexts_ai_system_id"),
        "ai_system_usage_contexts",
        ["ai_system_id"],
        unique=True,
    )

    op.create_table(
        "ai_system_risk_screenings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("ai_system_id", sa.Uuid(), nullable=False),
        sa.Column("answers", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("preliminary_risk_score", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "preliminary_risk_tier",
            sa.String(length=20),
            nullable=False,
            server_default="unassessed",
        ),
        sa.Column("triggered_risk_factors", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("risk_summary", sa.Text(), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False, server_default="{}"),
        sa.ForeignKeyConstraint(["ai_system_id"], ["ai_systems.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_ai_system_risk_screenings_id"), "ai_system_risk_screenings", ["id"]
    )
    op.create_index(
        op.f("ix_ai_system_risk_screenings_ai_system_id"),
        "ai_system_risk_screenings",
        ["ai_system_id"],
        unique=True,
    )


def downgrade() -> None:
    bind = op.get_bind()
    op.drop_table("ai_system_risk_screenings")
    op.drop_table("ai_system_usage_contexts")
    op.drop_table("ai_system_frameworks")
    op.drop_table("ai_system_endpoints")
    op.drop_table("ai_system_models")
    op.drop_table("ai_system_owners")
    sa.Enum(name="endpointstatus").drop(bind, checkfirst=True)
    sa.Enum(name="applicabilitytype").drop(bind, checkfirst=True)
