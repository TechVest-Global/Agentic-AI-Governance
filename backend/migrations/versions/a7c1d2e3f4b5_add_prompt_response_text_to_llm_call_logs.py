"""add prompt_text/response_text to llm_call_logs

These two columns backed app/models/llm_call_log.py's prompt_text/
response_text fields but were previously added by an ad-hoc ALTER TABLE run
at app startup (app/main.py) instead of a tracked migration — meaning
`alembic upgrade head` alone did not produce a schema matching the models,
and two app instances starting concurrently could race on the unguarded
ALTER TABLE. Guarded with a column-existence check so this is a safe no-op
against a database that already has them (e.g. from that old startup hook).

Revision ID: a7c1d2e3f4b5
Revises: f5a6b7c8d9e0
Create Date: 2026-07-15 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a7c1d2e3f4b5"
down_revision: str | None = "f5a6b7c8d9e0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    cols = {c["name"] for c in sa.inspect(bind).get_columns("llm_call_logs")}
    if "prompt_text" not in cols:
        op.add_column("llm_call_logs", sa.Column("prompt_text", sa.Text(), nullable=True))
    if "response_text" not in cols:
        op.add_column("llm_call_logs", sa.Column("response_text", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("llm_call_logs", "response_text")
    op.drop_column("llm_call_logs", "prompt_text")
