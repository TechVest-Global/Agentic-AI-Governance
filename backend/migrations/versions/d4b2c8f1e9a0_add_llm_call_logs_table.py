"""add llm_call_logs table

Adds the llm_call_logs audit table. Every LLM API call made through
the governance pipeline is recorded here with run_id linkage, token
counts, latency, estimated cost, and call status.

Revision ID: d4b2c8f1e9a0
Revises: c5a9e1b3f7d2
Create Date: 2026-06-25 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d4b2c8f1e9a0"
down_revision: str | None = "c5a9e1b3f7d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "llm_call_logs",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("run_id", sa.UUID(), nullable=True),
        sa.Column("agent_name", sa.String(length=100), nullable=True),
        sa.Column("task", sa.String(length=200), nullable=False),
        sa.Column("call_type", sa.String(length=20), nullable=False, server_default="governance"),
        sa.Column("model", sa.String(length=100), nullable=False),
        sa.Column("deployment_name", sa.String(length=100), nullable=True),
        sa.Column("client_mode", sa.String(length=20), nullable=False, server_default="mock"),
        sa.Column("routed_via", sa.String(length=50), nullable=True),
        sa.Column("prompt_tokens", sa.Integer(), nullable=True),
        sa.Column("completion_tokens", sa.Integer(), nullable=True),
        sa.Column("total_tokens", sa.Integer(), nullable=True),
        sa.Column("estimated_cost_usd", sa.Float(), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=50), nullable=False, server_default="success"),
        sa.Column("request_chars", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("response_chars", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("trace_id", sa.String(length=100), nullable=True),
        sa.Column("policy_flags", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["run_id"], ["evaluation_runs.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_llm_call_logs_id"), "llm_call_logs", ["id"])
    op.create_index(op.f("ix_llm_call_logs_run_id"), "llm_call_logs", ["run_id"])
    op.create_index(op.f("ix_llm_call_logs_agent_name"), "llm_call_logs", ["agent_name"])


def downgrade() -> None:
    op.drop_index(op.f("ix_llm_call_logs_agent_name"), "llm_call_logs")
    op.drop_index(op.f("ix_llm_call_logs_run_id"), "llm_call_logs")
    op.drop_index(op.f("ix_llm_call_logs_id"), "llm_call_logs")
    op.drop_table("llm_call_logs")
