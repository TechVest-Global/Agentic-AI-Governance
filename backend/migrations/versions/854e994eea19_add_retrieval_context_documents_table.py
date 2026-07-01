"""add retrieval_context_documents table

Adds a reference-document corpus per AI system so real RAG evidence tools
(e.g. ragas) have actual question/context/answer triples to score against,
instead of an approximation derived from agent probe transcripts.

Revision ID: 854e994eea19
Revises: d4b2c8f1e9a0
Create Date: 2026-07-01 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "854e994eea19"
down_revision: str | None = "d4b2c8f1e9a0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "retrieval_context_documents",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("ai_system_id", sa.UUID(), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("source_uri", sa.String(length=500), nullable=True),
        sa.Column("tags", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["ai_system_id"], ["ai_systems.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_retrieval_context_documents_id"), "retrieval_context_documents", ["id"]
    )
    op.create_index(
        op.f("ix_retrieval_context_documents_ai_system_id"),
        "retrieval_context_documents",
        ["ai_system_id"],
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_retrieval_context_documents_ai_system_id"), "retrieval_context_documents"
    )
    op.drop_index(op.f("ix_retrieval_context_documents_id"), "retrieval_context_documents")
    op.drop_table("retrieval_context_documents")
