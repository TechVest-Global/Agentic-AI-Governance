"""add enhanced registration phase 2 tables

Adds the optional Phase-2 fact tables: data sources & privacy screening, RAG
configuration, agent configuration, security control status, dependencies, and
document metadata. Fully additive — no existing table or column is altered.

Revision ID: c2b3d4e5f6a7
Revises: b1a2c3d4e5f6
Create Date: 2026-07-03 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c2b3d4e5f6a7"
down_revision: str | None = "b1a2c3d4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _base_columns() -> list[sa.Column]:
    return [
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("ai_system_id", sa.Uuid(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "ai_system_data_sources",
        *_base_columns(),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("source_type", sa.String(length=100), nullable=True),
        sa.Column("classification", sa.String(length=100), nullable=True),
        sa.Column("usage_purpose", sa.String(length=100), nullable=True),
        sa.Column("data_owner", sa.String(length=200), nullable=True),
        sa.Column("source_location", sa.String(length=300), nullable=True),
        sa.Column("residency", sa.String(length=100), nullable=True),
        sa.Column("retention_days", sa.Integer(), nullable=True),
        sa.Column("used_for_training", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("used_for_fine_tuning", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("used_for_inference", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("used_for_rag", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("external_sharing", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("contains_personal_data", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("contains_sensitive_personal_data", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("contains_confidential_data", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("contains_health_data", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("contains_financial_data", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("contains_biometric_data", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("contains_minors_data", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("metadata_json", sa.JSON(), nullable=False, server_default="{}"),
        sa.ForeignKeyConstraint(["ai_system_id"], ["ai_systems.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_ai_system_data_sources_id"), "ai_system_data_sources", ["id"])
    op.create_index(op.f("ix_ai_system_data_sources_ai_system_id"), "ai_system_data_sources", ["ai_system_id"])
    op.create_index(op.f("ix_ai_system_data_sources_used_for_rag"), "ai_system_data_sources", ["used_for_rag"])

    op.create_table(
        "ai_system_rag_configs",
        *_base_columns(),
        sa.Column("knowledge_base_name", sa.String(length=200), nullable=True),
        sa.Column("vector_database", sa.String(length=100), nullable=True),
        sa.Column("embedding_model", sa.String(length=200), nullable=True),
        sa.Column("reranking_model", sa.String(length=200), nullable=True),
        sa.Column("retrieval_strategy", sa.String(length=100), nullable=True),
        sa.Column("top_k", sa.Integer(), nullable=True),
        sa.Column("citations_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("access_control_applied", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("document_refresh_frequency", sa.String(length=100), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False, server_default="{}"),
        sa.ForeignKeyConstraint(["ai_system_id"], ["ai_systems.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_ai_system_rag_configs_id"), "ai_system_rag_configs", ["id"])
    op.create_index(op.f("ix_ai_system_rag_configs_ai_system_id"), "ai_system_rag_configs", ["ai_system_id"], unique=True)

    op.create_table(
        "ai_system_agent_configs",
        *_base_columns(),
        sa.Column("agent_purpose", sa.Text(), nullable=True),
        sa.Column("num_agents", sa.Integer(), nullable=True),
        sa.Column("tools_used", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("external_systems", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("read_access", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("write_access", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("can_send_messages", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("can_modify_files", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("can_write_database", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("can_execute_code", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("human_approval_required", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("max_steps", sa.Integer(), nullable=True),
        sa.Column("max_execution_seconds", sa.Integer(), nullable=True),
        sa.Column("persistent_memory_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("metadata_json", sa.JSON(), nullable=False, server_default="{}"),
        sa.ForeignKeyConstraint(["ai_system_id"], ["ai_systems.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_ai_system_agent_configs_id"), "ai_system_agent_configs", ["id"])
    op.create_index(op.f("ix_ai_system_agent_configs_ai_system_id"), "ai_system_agent_configs", ["ai_system_id"], unique=True)

    op.create_table(
        "ai_system_security_controls",
        *_base_columns(),
        sa.Column("control_key", sa.String(length=100), nullable=False),
        sa.Column("implementation_status", sa.String(length=50), nullable=False, server_default="unknown"),
        sa.Column("notes", sa.String(length=2000), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False, server_default="{}"),
        sa.ForeignKeyConstraint(["ai_system_id"], ["ai_systems.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("ai_system_id", "control_key"),
    )
    op.create_index(op.f("ix_ai_system_security_controls_id"), "ai_system_security_controls", ["id"])
    op.create_index(op.f("ix_ai_system_security_controls_ai_system_id"), "ai_system_security_controls", ["ai_system_id"])

    op.create_table(
        "ai_system_dependencies",
        *_base_columns(),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("service_purpose", sa.String(length=500), nullable=True),
        sa.Column("dependency_type", sa.String(length=100), nullable=True),
        sa.Column("data_shared", sa.String(length=500), nullable=True),
        sa.Column("hosting_region", sa.String(length=100), nullable=True),
        sa.Column("is_critical", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_third_party_api", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("contract_sla_available", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("exit_option", sa.String(length=500), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False, server_default="{}"),
        sa.ForeignKeyConstraint(["ai_system_id"], ["ai_systems.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_ai_system_dependencies_id"), "ai_system_dependencies", ["id"])
    op.create_index(op.f("ix_ai_system_dependencies_ai_system_id"), "ai_system_dependencies", ["ai_system_id"])

    op.create_table(
        "ai_system_documents",
        *_base_columns(),
        sa.Column("name", sa.String(length=300), nullable=False),
        sa.Column("document_type", sa.String(length=100), nullable=True),
        sa.Column("version", sa.String(length=100), nullable=True),
        sa.Column("document_owner", sa.String(length=200), nullable=True),
        sa.Column("related_framework", sa.String(length=100), nullable=True),
        sa.Column("confidentiality_level", sa.String(length=100), nullable=True),
        sa.Column("storage_ref", sa.String(length=1000), nullable=True),
        sa.Column("content_type", sa.String(length=200), nullable=True),
        sa.Column("file_size", sa.Integer(), nullable=True),
        sa.Column("notes", sa.String(length=2000), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False, server_default="{}"),
        sa.ForeignKeyConstraint(["ai_system_id"], ["ai_systems.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_ai_system_documents_id"), "ai_system_documents", ["id"])
    op.create_index(op.f("ix_ai_system_documents_ai_system_id"), "ai_system_documents", ["ai_system_id"])


def downgrade() -> None:
    op.drop_table("ai_system_documents")
    op.drop_table("ai_system_dependencies")
    op.drop_table("ai_system_security_controls")
    op.drop_table("ai_system_agent_configs")
    op.drop_table("ai_system_rag_configs")
    op.drop_table("ai_system_data_sources")
