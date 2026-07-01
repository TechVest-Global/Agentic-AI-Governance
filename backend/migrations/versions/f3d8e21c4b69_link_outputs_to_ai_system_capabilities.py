"""link outputs to ai system capabilities

Revision ID: f3d8e21c4b69
Revises: c7f4f2c6b7aa
Create Date: 2026-06-16 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f3d8e21c4b69"
down_revision: str | None = "c7f4f2c6b7aa"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    foreign_key_names = {
        "evidence_records": "fk_evidence_records_capability",
        "metric_results": "fk_metric_results_capability",
        "findings": "fk_findings_capability",
    }
    for table_name, foreign_key_name in foreign_key_names.items():
        op.add_column(
            table_name,
            sa.Column("ai_system_capability_id", sa.Uuid(), nullable=True),
        )
        op.create_index(
            op.f(f"ix_{table_name}_ai_system_capability_id"),
            table_name,
            ["ai_system_capability_id"],
            unique=False,
        )
        op.create_foreign_key(
            foreign_key_name,
            table_name,
            "ai_system_capabilities",
            ["ai_system_capability_id"],
            ["id"],
        )


def downgrade() -> None:
    foreign_key_names = {
        "findings": "fk_findings_capability",
        "metric_results": "fk_metric_results_capability",
        "evidence_records": "fk_evidence_records_capability",
    }
    for table_name, foreign_key_name in foreign_key_names.items():
        op.drop_constraint(
            foreign_key_name,
            table_name,
            type_="foreignkey",
        )
        op.drop_index(
            op.f(f"ix_{table_name}_ai_system_capability_id"),
            table_name=table_name,
        )
        op.drop_column(table_name, "ai_system_capability_id")
