"""add ai_system_capability modality

Capabilities had no modality of their own — only the parent AISystem did, as a
single value for the whole system. That's wrong the moment a system has more
than one capability of different modalities (e.g. an image-generation endpoint
and a text-copywriting endpoint on the same system): a probe meant for a text
endpoint could be sent to an image endpoint with nothing to catch it. This adds
a per-capability modality so probe selection can gate on it.

Backfills existing rows from their parent AISystem.modality — correct for every
system that only has one real modality across all its capabilities, but a
system with genuinely mixed-modality capabilities will still need a one-off
correction after this migration (via the new capability PATCH route) for the
capabilities that don't match their parent's modality.

Revision ID: 56c708830b47
Revises: b7f2a9d3c1e4
Create Date: 2026-07-23 00:47:56.163845
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "56c708830b47"
down_revision: str | None = "b7f2a9d3c1e4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    modality_enum = sa.Enum("text", "audio", "video", "image", name="modality")
    modality_enum.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "ai_system_capabilities",
        sa.Column("modality", modality_enum, nullable=True),
    )
    op.execute(
        """
        UPDATE ai_system_capabilities AS a
        SET modality = s.modality
        FROM ai_systems AS s
        WHERE a.ai_system_id = s.id
        """
    )
    op.alter_column("ai_system_capabilities", "modality", nullable=False)
    op.create_index(
        op.f("ix_ai_system_capabilities_modality"),
        "ai_system_capabilities",
        ["modality"],
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_ai_system_capabilities_modality"), table_name="ai_system_capabilities"
    )
    op.drop_column("ai_system_capabilities", "modality")
    # The shared "modality" enum type is still used by ai_systems.modality —
    # do not drop it here.
