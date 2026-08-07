"""add endpoint_ref, error_type, error_detail and attempts to llm_call_logs

Two gaps, one table, so one migration.

endpoint_ref — a multi-endpoint system is several independent audit surfaces,
but the call log recorded only WHAT was asked, never WHICH surface was asked.
The endpoint was known when the probe was planned and then discarded on the way
to storage; the only trace was a "probe_name@endpoint" suffix stuffed into
`task`, present only when the system had more than one endpoint and existing to
keep dict keys unique rather than to attribute anything. Without a real column
no per-endpoint coverage claim can be made or verified.

error_type / error_detail — `status` said only "error", so a 502 from the
audited app, an expired credential and a connection refusal were
indistinguishable in the audit record. The reason usually existed in the
response body and was never read.

attempts — the Gateway retries transient failures, so one logical probe can
cost several HTTP requests. Recording it keeps "probes sent" and "requests
made" from being conflated in either direction.

All nullable / defaulted, so existing rows stay valid and read back as
"unknown" rather than being back-filled with a guess.

Revision ID: a1b2c3d4e5f6
Revises: c9e4a2b81f36
Create Date: 2026-07-31 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: str | None = "c9e4a2b81f36"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Guarded per column, matching the sibling llm_call_logs migrations. This
    # revision originally sat directly on 65e671d8f0b0, alongside the error_text
    # and phase revisions rather than after them; a database stamped under that
    # earlier ordering already has these columns but not those. Re-running from
    # 65e671d8f0b0 is how such a database is brought onto the linear chain, so
    # every step in it has to tolerate work that is already done.
    bind = op.get_bind()
    cols = {c["name"] for c in sa.inspect(bind).get_columns("llm_call_logs")}

    if "endpoint_ref" not in cols:
        op.add_column(
            "llm_call_logs", sa.Column("endpoint_ref", sa.String(length=500), nullable=True)
        )
        op.create_index(
            "ix_llm_call_logs_endpoint_ref", "llm_call_logs", ["endpoint_ref"], unique=False
        )
    if "error_type" not in cols:
        op.add_column(
            "llm_call_logs", sa.Column("error_type", sa.String(length=100), nullable=True)
        )
    if "error_detail" not in cols:
        op.add_column("llm_call_logs", sa.Column("error_detail", sa.Text(), nullable=True))
    if "attempts" not in cols:
        op.add_column(
            "llm_call_logs",
            sa.Column("attempts", sa.Integer(), nullable=False, server_default=sa.text("1")),
        )
        # Drop the server default so the model's own default owns the value from here.
        op.alter_column("llm_call_logs", "attempts", server_default=None)


def downgrade() -> None:
    op.drop_column("llm_call_logs", "attempts")
    op.drop_column("llm_call_logs", "error_detail")
    op.drop_column("llm_call_logs", "error_type")
    op.drop_index("ix_llm_call_logs_endpoint_ref", table_name="llm_call_logs")
    op.drop_column("llm_call_logs", "endpoint_ref")
