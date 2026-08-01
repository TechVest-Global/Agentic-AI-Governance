"""add error_text to llm_call_logs

A failed LLM call previously recorded only a status string ("error" /
"rate_limited") and dropped both the prompt that was sent and any explanation
of what went wrong. On a live run where most probes were rate limited, the
calls with the most diagnostic value were the ones with no transcript at all.
The gateway now keeps the prompt on failure and writes the reason here.

Revision ID: f8b3c1d94e27
Revises: 65e671d8f0b0
Create Date: 2026-08-01 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f8b3c1d94e27"
down_revision: str | None = "65e671d8f0b0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    cols = {c["name"] for c in sa.inspect(bind).get_columns("llm_call_logs")}
    if "error_text" not in cols:
        op.add_column("llm_call_logs", sa.Column("error_text", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("llm_call_logs", "error_text")
