"""rename context profile sections

Revision ID: c7f4f2c6b7aa
Revises: 8db69212f62c
Create Date: 2026-06-15 15:35:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c7f4f2c6b7aa"
down_revision: str | None = "8db69212f62c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "application_context_profiles",
        "section_a",
        new_column_name="identity_purpose",
        existing_type=sa.JSON(),
        existing_nullable=False,
    )
    op.alter_column(
        "application_context_profiles",
        "section_b",
        new_column_name="pre_model_controls",
        existing_type=sa.JSON(),
        existing_nullable=False,
    )
    op.alter_column(
        "application_context_profiles",
        "section_c",
        new_column_name="model_configuration",
        existing_type=sa.JSON(),
        existing_nullable=False,
    )
    op.alter_column(
        "application_context_profiles",
        "section_d",
        new_column_name="post_model_controls",
        existing_type=sa.JSON(),
        existing_nullable=False,
    )
    op.alter_column(
        "application_context_profiles",
        "section_e",
        new_column_name="integration_context",
        existing_type=sa.JSON(),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "application_context_profiles",
        "identity_purpose",
        new_column_name="section_a",
        existing_type=sa.JSON(),
        existing_nullable=False,
    )
    op.alter_column(
        "application_context_profiles",
        "pre_model_controls",
        new_column_name="section_b",
        existing_type=sa.JSON(),
        existing_nullable=False,
    )
    op.alter_column(
        "application_context_profiles",
        "model_configuration",
        new_column_name="section_c",
        existing_type=sa.JSON(),
        existing_nullable=False,
    )
    op.alter_column(
        "application_context_profiles",
        "post_model_controls",
        new_column_name="section_d",
        existing_type=sa.JSON(),
        existing_nullable=False,
    )
    op.alter_column(
        "application_context_profiles",
        "integration_context",
        new_column_name="section_e",
        existing_type=sa.JSON(),
        existing_nullable=False,
    )
