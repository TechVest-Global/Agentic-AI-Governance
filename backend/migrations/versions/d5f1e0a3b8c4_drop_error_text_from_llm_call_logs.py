"""drop error_text from llm_call_logs

Two columns ended up holding the same fact. `error_text` (one joined
"Type: detail" string) and `error_type` + `error_detail` were added
independently for the same reason — a failed call recorded only a status and no
explanation — and both survived the merge. The visible symptom was the probe
transcript rendering the failure reason twice: once in the collapsed row header
from error_type/error_detail, and again inside the expanded body from
error_text.

error_type + error_detail is kept because it is the better shape: the type is
groupable (action_reporting/endpoint_coverage.py counts errors by type) and the
detail carries the audited system's own response body. error_text could only
ever be reconstructed from those two, never the reverse.

Revision ID: d5f1e0a3b8c4
Revises: a1b2c3d4e5f6
Create Date: 2026-08-04 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d5f1e0a3b8c4"
down_revision: str | None = "a1b2c3d4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    cols = {c["name"] for c in sa.inspect(bind).get_columns("llm_call_logs")}
    if "error_text" in cols:
        op.drop_column("llm_call_logs", "error_text")


def downgrade() -> None:
    bind = op.get_bind()
    cols = {c["name"] for c in sa.inspect(bind).get_columns("llm_call_logs")}
    if "error_text" not in cols:
        op.add_column("llm_call_logs", sa.Column("error_text", sa.Text(), nullable=True))
