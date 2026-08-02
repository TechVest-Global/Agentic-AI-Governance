"""add phase to llm_call_logs

A run's captured LLM calls were one undifferentiated list: nothing recorded
which pipeline layer made a call, so an evaluator's probe during metric
execution was indistinguishable from a specialist agent's, and the UI had to
infer the owning layer from agent_name/task string shapes. The gateway now
stamps the phase from the capture buffer.

Revision ID: c9e4a2b81f36
Revises: f8b3c1d94e27
Create Date: 2026-08-01 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c9e4a2b81f36"
down_revision: str | None = "f8b3c1d94e27"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    cols = {c["name"] for c in sa.inspect(bind).get_columns("llm_call_logs")}
    if "phase" not in cols:
        op.add_column("llm_call_logs", sa.Column("phase", sa.String(length=50), nullable=True))
        op.create_index("ix_llm_call_logs_phase", "llm_call_logs", ["phase"])


def downgrade() -> None:
    op.drop_index("ix_llm_call_logs_phase", table_name="llm_call_logs")
    op.drop_column("llm_call_logs", "phase")
