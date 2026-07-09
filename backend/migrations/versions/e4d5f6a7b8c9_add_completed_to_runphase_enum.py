"""Add 'completed' to the runphase enum.

RunPhase.completed exists in the Python enum and is written by the pipeline's
finalization step, but the PostgreSQL enum type was never updated — so the
final UPDATE of every orchestrated run failed with
``invalid input value for enum runphase: "completed"`` and runs were left
parked at deliberation_council with a non-terminal status.

Revision ID: e4d5f6a7b8c9
Revises: d3c4e5f6a7b8
Create Date: 2026-07-08
"""

from __future__ import annotations

from alembic import op

revision = "e4d5f6a7b8c9"
down_revision = "d3c4e5f6a7b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE runphase ADD VALUE IF NOT EXISTS 'completed'")


def downgrade() -> None:
    # PostgreSQL cannot drop a single enum value; removing it would require
    # rebuilding the type and every dependent column. The extra value is
    # harmless for older code, so downgrade is a no-op.
    pass
