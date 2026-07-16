"""add assessment_requests table

Adds the auditor -> developer "request re-assessment" workflow. An auditor
creates a request against an AI system (status: pending); the developer
acknowledges it (in_progress) and marks it resolved or dismissed, optionally
linking the evaluation run that fulfilled it. Auditors never trigger runs
directly, so this table is the structured ask that stands in for that (see
docs/AUDITOR_MASTER_SPEC.md §5).

Revision ID: b7f2a9d3c1e4
Revises: a7c1d2e3f4b5
Create Date: 2026-07-15 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b7f2a9d3c1e4"
down_revision: str | None = "a7c1d2e3f4b5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "assessment_requests",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("ai_system_id", sa.UUID(), nullable=False),
        sa.Column("note", sa.String(length=2000), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("requested_by_name", sa.String(length=200), nullable=False),
        sa.Column("requested_by_email", sa.String(length=254), nullable=False),
        sa.Column("requested_by_role", sa.String(length=100), nullable=False),
        sa.Column("resolved_run_id", sa.UUID(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["ai_system_id"], ["ai_systems.id"]),
        sa.ForeignKeyConstraint(["resolved_run_id"], ["evaluation_runs.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_assessment_requests_id"), "assessment_requests", ["id"])
    op.create_index(op.f("ix_assessment_requests_ai_system_id"), "assessment_requests", ["ai_system_id"])
    op.create_index(op.f("ix_assessment_requests_status"), "assessment_requests", ["status"])


def downgrade() -> None:
    op.drop_index(op.f("ix_assessment_requests_status"), "assessment_requests")
    op.drop_index(op.f("ix_assessment_requests_ai_system_id"), "assessment_requests")
    op.drop_index(op.f("ix_assessment_requests_id"), "assessment_requests")
    op.drop_table("assessment_requests")
