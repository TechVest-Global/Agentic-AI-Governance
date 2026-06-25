"""add agent execution records

Revision ID: 61db0fdf6c9a
Revises: a4e9d2c8b731
Create Date: 2026-06-18 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel
from alembic import op

revision: str = "61db0fdf6c9a"
down_revision: str | None = "a4e9d2c8b731"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "agent_executions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("agent_name", sqlmodel.sql.sqltypes.AutoString(length=100), nullable=False),
        sa.Column("status", sqlmodel.sql.sqltypes.AutoString(length=20), nullable=False),
        sa.Column("finding_count", sa.Integer(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("error_summary", sa.JSON(), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["evaluation_runs.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_agent_executions_agent_name"), "agent_executions", ["agent_name"])
    op.create_index(op.f("ix_agent_executions_completed_at"), "agent_executions", ["completed_at"])
    op.create_index(op.f("ix_agent_executions_id"), "agent_executions", ["id"])
    op.create_index(op.f("ix_agent_executions_run_id"), "agent_executions", ["run_id"])
    op.create_index(op.f("ix_agent_executions_started_at"), "agent_executions", ["started_at"])
    op.create_index(op.f("ix_agent_executions_status"), "agent_executions", ["status"])


def downgrade() -> None:
    op.drop_index(op.f("ix_agent_executions_status"), "agent_executions")
    op.drop_index(op.f("ix_agent_executions_started_at"), "agent_executions")
    op.drop_index(op.f("ix_agent_executions_run_id"), "agent_executions")
    op.drop_index(op.f("ix_agent_executions_id"), "agent_executions")
    op.drop_index(op.f("ix_agent_executions_completed_at"), "agent_executions")
    op.drop_index(op.f("ix_agent_executions_agent_name"), "agent_executions")
    op.drop_table("agent_executions")
