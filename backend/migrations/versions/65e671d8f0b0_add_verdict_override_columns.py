"""add human-override columns to verdicts

Calibration plumbing (capture only, no scoring model): records that a human
disagreed with a Verdict, without mutating the original verdict fields — a
future calibration pass can compare confidence_score/label against these, and
a report that already showed the original verdict stays immutable.

  - human_override_label / human_override_reason: the human's own label and
    why they disagreed.
  - overridden_by / overridden_at: who recorded the override and when (also
    written to the audit ledger; these columns are the queryable source of
    truth, same pattern as EvaluationRun.plan_approved_by/plan_approved_at).

All four are nullable — no enum changes — so this is a low-risk additive
migration, same style as f5a6b7c8d9e0_add_plan_approval_to_runs.

Revision ID: 65e671d8f0b0
Revises: 9d4f1a2b7c30
Create Date: 2026-07-29 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "65e671d8f0b0"
down_revision: str | None = "9d4f1a2b7c30"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "verdicts",
        sa.Column("human_override_label", sa.String(length=100), nullable=True),
    )
    op.add_column(
        "verdicts",
        sa.Column("human_override_reason", sa.Text(), nullable=True),
    )
    op.add_column(
        "verdicts",
        sa.Column("overridden_by", sa.String(length=200), nullable=True),
    )
    op.add_column(
        "verdicts",
        sa.Column("overridden_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("verdicts", "overridden_at")
    op.drop_column("verdicts", "overridden_by")
    op.drop_column("verdicts", "human_override_reason")
    op.drop_column("verdicts", "human_override_label")
