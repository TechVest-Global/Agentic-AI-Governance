"""add evaluation_runs.selected_capabilities

Adds an audit-scope column: the capability endpoint_refs a run should probe.
An empty list means "audit the whole application" (probe the base endpoint);
a non-empty list scopes the audit to specific functions (e.g. parse-resume).

Revision ID: d3c4e5f6a7b8
Revises: c2b3d4e5f6a7
Create Date: 2026-07-05 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d3c4e5f6a7b8"
down_revision: str | None = "c2b3d4e5f6a7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "evaluation_runs",
        sa.Column(
            "selected_capabilities",
            postgresql.JSON(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::json"),
        ),
    )
    # Drop the server default so the app-level default_factory owns the value.
    op.alter_column("evaluation_runs", "selected_capabilities", server_default=None)


def downgrade() -> None:
    op.drop_column("evaluation_runs", "selected_capabilities")
