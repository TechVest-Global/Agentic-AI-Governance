"""Covers the pure filesystem logic in scripts/backup_database.py.

The pg_dump/docker-exec parts are exercised manually against the real
Postgres container (see docs/RUNBOOK.md) rather than in the suite — this
only locks in the retention pruning, which is safe to test without Docker.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.backup_database import _prune_old_backups  # noqa: E402


def test_prune_old_backups_keeps_only_the_newest_n(tmp_path: Path) -> None:
    names = [
        "agentic_ai_governance_20260701T000000Z.sql",
        "agentic_ai_governance_20260702T000000Z.sql",
        "agentic_ai_governance_20260703T000000Z.sql",
        "agentic_ai_governance_20260704T000000Z.sql",
    ]
    for name in names:
        (tmp_path / name).write_text("dump contents")

    pruned = _prune_old_backups(tmp_path, keep=2)

    remaining = sorted(p.name for p in tmp_path.glob("*.sql"))
    assert remaining == names[2:]
    assert {p.name for p in pruned} == set(names[:2])


def test_prune_old_backups_is_a_no_op_when_under_the_limit(tmp_path: Path) -> None:
    (tmp_path / "agentic_ai_governance_20260701T000000Z.sql").write_text("dump contents")

    pruned = _prune_old_backups(tmp_path, keep=30)

    assert pruned == []
    assert len(list(tmp_path.glob("*.sql"))) == 1
