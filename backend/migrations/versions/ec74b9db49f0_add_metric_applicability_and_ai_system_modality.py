"""add metric applicability rules and ai_system modality

Adds applicable_capability_types/applicable_modalities to metric_configs so
the orchestrator can select only the metrics that structurally apply to a
given AI system (e.g. retrieval-quality metrics only for systems with a
retrieval capability), instead of planning every enabled metric for every
system regardless of its actual use case. Adds AISystem.modality so
modality-specific metrics (e.g. ASR/video robustness checks) can be scoped
the same way.

Revision ID: ec74b9db49f0
Revises: 854e994eea19
Create Date: 2026-07-02 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "ec74b9db49f0"
down_revision: str | None = "854e994eea19"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "metric_configs",
        sa.Column(
            "applicable_capability_types", sa.JSON(), nullable=False, server_default="[]"
        ),
    )
    op.add_column(
        "metric_configs",
        sa.Column("applicable_modalities", sa.JSON(), nullable=False, server_default="[]"),
    )
    modality_enum = sa.Enum("text", "audio", "video", "image", name="modality")
    modality_enum.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "ai_systems",
        sa.Column("modality", modality_enum, nullable=False, server_default="text"),
    )
    op.create_index(op.f("ix_ai_systems_modality"), "ai_systems", ["modality"])


def downgrade() -> None:
    op.drop_index(op.f("ix_ai_systems_modality"), table_name="ai_systems")
    op.drop_column("ai_systems", "modality")
    sa.Enum(name="modality").drop(op.get_bind(), checkfirst=True)
    op.drop_column("metric_configs", "applicable_modalities")
    op.drop_column("metric_configs", "applicable_capability_types")
