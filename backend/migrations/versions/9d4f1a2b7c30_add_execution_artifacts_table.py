"""add execution_artifacts table

Generated images/audio/video that an audited system produced during a probe
were never persisted anywhere — the vision evaluator already downloads and
judges them, and the specialist-agent probing path already receives them on
TargetModelResponse.media, but both discarded the actual bytes after use.
This adds a table to keep the media itself (base64) alongside the prompt and
text response that came with it, so developers can inspect the real
generated artifact under "Execution Artifacts" instead of only a pass/fail
verdict.

Revision ID: 9d4f1a2b7c30
Revises: 56c708830b47
Create Date: 2026-07-23 08:10:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "9d4f1a2b7c30"
down_revision: str | None = "56c708830b47"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "execution_artifacts",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("run_id", sa.UUID(), nullable=False),
        sa.Column("agent_name", sa.String(length=100), nullable=False),
        sa.Column("dimension", sa.String(length=100), nullable=True),
        sa.Column("capability_name", sa.String(length=200), nullable=True),
        sa.Column("endpoint_ref", sa.String(length=500), nullable=False),
        sa.Column("prompt_text", sa.Text(), nullable=False),
        sa.Column("response_text", sa.Text(), nullable=False),
        sa.Column("media_kind", sa.String(length=20), nullable=False),
        sa.Column("mime_type", sa.String(length=100), nullable=False),
        sa.Column("data_base64", sa.Text(), nullable=True),
        sa.Column("source_url", sa.String(length=2000), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["run_id"], ["evaluation_runs.id"]),
    )
    op.create_index(
        op.f("ix_execution_artifacts_run_id"), "execution_artifacts", ["run_id"]
    )
    op.create_index(
        op.f("ix_execution_artifacts_agent_name"), "execution_artifacts", ["agent_name"]
    )
    op.create_index(
        op.f("ix_execution_artifacts_media_kind"), "execution_artifacts", ["media_kind"]
    )
    op.create_index(op.f("ix_execution_artifacts_id"), "execution_artifacts", ["id"])


def downgrade() -> None:
    op.drop_table("execution_artifacts")
