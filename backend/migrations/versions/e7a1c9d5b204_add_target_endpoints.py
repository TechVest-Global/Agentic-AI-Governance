"""add target_endpoints table and evaluation_runs.target_endpoint_id

Applications can register multiple callable HTTP target endpoints (prod, staging,
regional instances). Each endpoint stores its own auth config and an encrypted
API key. A run probes the default endpoint unless it names an explicit override
via evaluation_runs.target_endpoint_id.

Backfill: every existing AI system whose legacy ``target_endpoint_ref`` is an
http(s) URL gets one default endpoint row so existing systems keep probing the
same URL. The legacy column is retained (deprecated) for backward compatibility.

Revision ID: e7a1c9d5b204
Revises: b1c2d3e4f5a6
Create Date: 2026-07-01 00:00:00.000000
"""

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
import sqlmodel
from alembic import op

revision: str = "e7a1c9d5b204"
down_revision: str | None = "b1c2d3e4f5a6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "target_endpoints",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("ai_system_id", sa.Uuid(), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(length=200), nullable=False),
        sa.Column("description", sqlmodel.sql.sqltypes.AutoString(length=2000), nullable=True),
        sa.Column("environment", sqlmodel.sql.sqltypes.AutoString(length=100), nullable=False),
        sa.Column("url", sqlmodel.sql.sqltypes.AutoString(length=1000), nullable=False),
        sa.Column("http_method", sqlmodel.sql.sqltypes.AutoString(length=10), nullable=False),
        sa.Column("auth_header", sqlmodel.sql.sqltypes.AutoString(length=200), nullable=False),
        sa.Column("auth_scheme", sqlmodel.sql.sqltypes.AutoString(length=100), nullable=False),
        sa.Column("request_field", sqlmodel.sql.sqltypes.AutoString(length=200), nullable=False),
        sa.Column("response_field", sqlmodel.sql.sqltypes.AutoString(length=200), nullable=False),
        sa.Column("timeout_seconds", sa.Integer(), nullable=False),
        sa.Column(
            "secret_ciphertext", sqlmodel.sql.sqltypes.AutoString(length=2000), nullable=True
        ),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["ai_system_id"], ["ai_systems.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("ai_system_id", "name"),
    )
    op.create_index(
        op.f("ix_target_endpoints_ai_system_id"), "target_endpoints", ["ai_system_id"]
    )
    op.create_index(op.f("ix_target_endpoints_id"), "target_endpoints", ["id"])
    op.create_index(op.f("ix_target_endpoints_name"), "target_endpoints", ["name"])
    op.create_index(
        op.f("ix_target_endpoints_environment"), "target_endpoints", ["environment"]
    )
    op.create_index(op.f("ix_target_endpoints_enabled"), "target_endpoints", ["enabled"])
    op.create_index(
        op.f("ix_target_endpoints_is_default"), "target_endpoints", ["is_default"]
    )

    op.add_column(
        "evaluation_runs",
        sa.Column("target_endpoint_id", sa.Uuid(), nullable=True),
    )
    op.create_index(
        op.f("ix_evaluation_runs_target_endpoint_id"),
        "evaluation_runs",
        ["target_endpoint_id"],
    )
    op.create_foreign_key(
        "fk_evaluation_runs_target_endpoint_id",
        "evaluation_runs",
        "target_endpoints",
        ["target_endpoint_id"],
        ["id"],
    )

    _backfill_from_legacy_refs()


def _backfill_from_legacy_refs() -> None:
    """Create one default endpoint per system that has a legacy URL ref."""
    bind = op.get_bind()
    systems = bind.execute(
        sa.text(
            "SELECT id, target_endpoint_ref FROM ai_systems "
            "WHERE target_endpoint_ref IS NOT NULL "
            "AND (lower(target_endpoint_ref) LIKE 'http://%' "
            "OR lower(target_endpoint_ref) LIKE 'https://%')"
        )
    ).fetchall()

    insert = sa.text(
        "INSERT INTO target_endpoints "
        "(id, created_at, ai_system_id, name, environment, url, http_method, "
        "auth_header, auth_scheme, request_field, response_field, timeout_seconds, "
        "enabled, is_default, metadata_json) "
        "VALUES (:id, :created_at, :ai_system_id, :name, :environment, :url, "
        "'POST', 'Authorization', 'Bearer', 'message', 'response', 60, "
        ":enabled, :is_default, :metadata_json)"
    )
    now = datetime.now(UTC)
    for row in systems:
        bind.execute(
            insert,
            {
                "id": uuid.uuid4(),
                "created_at": now,
                "ai_system_id": row.id,
                "name": "Default",
                "environment": "production",
                "url": row.target_endpoint_ref,
                "enabled": True,
                "is_default": True,
                "metadata_json": "{}",
            },
        )


def downgrade() -> None:
    op.drop_constraint(
        "fk_evaluation_runs_target_endpoint_id", "evaluation_runs", type_="foreignkey"
    )
    op.drop_index(
        op.f("ix_evaluation_runs_target_endpoint_id"), table_name="evaluation_runs"
    )
    op.drop_column("evaluation_runs", "target_endpoint_id")

    op.drop_index(op.f("ix_target_endpoints_is_default"), table_name="target_endpoints")
    op.drop_index(op.f("ix_target_endpoints_enabled"), table_name="target_endpoints")
    op.drop_index(op.f("ix_target_endpoints_environment"), table_name="target_endpoints")
    op.drop_index(op.f("ix_target_endpoints_name"), table_name="target_endpoints")
    op.drop_index(op.f("ix_target_endpoints_id"), table_name="target_endpoints")
    op.drop_index(op.f("ix_target_endpoints_ai_system_id"), table_name="target_endpoints")
    op.drop_table("target_endpoints")
