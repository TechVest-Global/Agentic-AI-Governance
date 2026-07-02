"""add llm_call_logs.tier column

Records the model tier used for each governance LLM call — "premium" (main judge
model) or "cheap" (reserved for future lightweight helper tasks). Nullable: all
existing rows and target-model calls (which are not tiered) remain NULL, so this
migration is safe to apply to a populated table with no backfill required.

Revision ID: b1c2d3e4f5a6
Revises: d4b2c8f1e9a0
Create Date: 2026-06-30 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b1c2d3e4f5a6"
down_revision: str | None = "d4b2c8f1e9a0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "llm_call_logs",
        sa.Column("tier", sa.String(length=20), nullable=True),
    )
    op.create_index(op.f("ix_llm_call_logs_tier"), "llm_call_logs", ["tier"])


def downgrade() -> None:
    op.drop_index(op.f("ix_llm_call_logs_tier"), "llm_call_logs")
    op.drop_column("llm_call_logs", "tier")
