"""add plan-approval columns to evaluation_runs

Adds the human-in-the-loop metric-plan approval gate. When a run is orchestrated
with require_plan_approval, the pipeline pauses after the adaptive orchestrator
builds the plan (the run parks at the existing 'planned' status) until a reviewer
approves it. These columns record the approval decision and the pipeline options
to replay when the run resumes:

  - plan_approved_at / plan_approved_by: who approved the plan and when (also
    written to the audit ledger; these columns are the queryable source of truth).
  - pipeline_payload: the GovernancePipelineRunCreate options captured at
    orchestrate time, so the resume step runs exactly what was approved.

All three are nullable — no enum changes — so this is a low-risk additive migration.

Revision ID: f5a6b7c8d9e0
Revises: e4d5f6a7b8c9
Create Date: 2026-07-10 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f5a6b7c8d9e0"
down_revision: str | None = "e4d5f6a7b8c9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "evaluation_runs",
        sa.Column("plan_approved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "evaluation_runs",
        sa.Column("plan_approved_by", sa.String(length=200), nullable=True),
    )
    op.add_column(
        "evaluation_runs",
        sa.Column(
            "pipeline_payload",
            postgresql.JSON(astext_type=sa.Text()),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("evaluation_runs", "pipeline_payload")
    op.drop_column("evaluation_runs", "plan_approved_by")
    op.drop_column("evaluation_runs", "plan_approved_at")
