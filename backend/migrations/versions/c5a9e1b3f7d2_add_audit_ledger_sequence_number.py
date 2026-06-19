"""add audit ledger sequence number

Gives the audit ledger a monotonic per-run sequence so entries have a
deterministic order independent of created_at (which can collide under coarse
clock resolution), mirroring governance_state_entries.

Revision ID: c5a9e1b3f7d2
Revises: 61db0fdf6c9a
Create Date: 2026-06-18 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c5a9e1b3f7d2"
down_revision: str | None = "61db0fdf6c9a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "audit_ledger_entries",
        sa.Column("sequence_number", sa.Integer(), nullable=True),
    )
    # Backfill existing rows with a per-run sequence ordered by insertion time.
    op.execute(
        """
        UPDATE audit_ledger_entries AS a
        SET sequence_number = s.rn
        FROM (
            SELECT id, ROW_NUMBER() OVER (
                PARTITION BY run_id ORDER BY created_at, id
            ) AS rn
            FROM audit_ledger_entries
        ) AS s
        WHERE a.id = s.id
        """
    )
    op.alter_column("audit_ledger_entries", "sequence_number", nullable=False)
    op.create_index(
        op.f("ix_audit_ledger_entries_sequence_number"),
        "audit_ledger_entries",
        ["sequence_number"],
    )
    op.create_unique_constraint(
        "uq_audit_ledger_entries_run_sequence",
        "audit_ledger_entries",
        ["run_id", "sequence_number"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_audit_ledger_entries_run_sequence",
        "audit_ledger_entries",
        type_="unique",
    )
    op.drop_index(
        op.f("ix_audit_ledger_entries_sequence_number"),
        "audit_ledger_entries",
    )
    op.drop_column("audit_ledger_entries", "sequence_number")
