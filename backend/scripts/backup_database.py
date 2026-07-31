"""Back up the governance Postgres database and anchor the audit ledger.

The database (registered systems, runs, findings, the audit ledger) lives
only in the Docker volume the compose stack mounts — there is no other copy.
That volume was lost once already (2026-07-08, Docker Desktop WSL rebuild)
with no way to recover it. This script:

  1. Shells out to `docker exec` + `pg_dump` inside the running Postgres
     container (no local `pg_dump` binary required) and writes a timestamped
     `.sql` dump to a host directory OUTSIDE the Docker volume.
  2. Prunes dumps beyond a retention count.
  3. Appends one line per completed run to a separate, append-only anchor
     log recording that run's current audit-ledger `entry_hash`/
     `entry_count` — an external checkpoint. The ledger's own hash chain
     (see app.services.audit_ledger.verify_ledger_chain) proves interior
     rows weren't altered/deleted, but nothing stops someone from deleting
     the CURRENT TAIL of the chain — which would still verify as "valid"
     since there's nothing left to contradict it. A backup taken before that
     happened, kept outside the database itself, is what lets an auditor
     later notice a run's ledger is shorter than it used to be.

Usage:
    python -m scripts.backup_database
    python -m scripts.backup_database --keep 30 --backup-dir ./backups

Intended to run unattended (see docs/RUNBOOK.md for the Windows Scheduled
Task registration command) — every failure mode here raises with a message
useful in a scheduler's log, never silently no-ops.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_BACKUP_DIR = _REPO_ROOT / "backups"
_DEFAULT_CONTAINER = "agentic-ai-governance-postgres"
_DEFAULT_RETENTION = 30


def _run_pg_dump(*, container: str, db_user: str, db_name: str, output_path: Path) -> None:
    with output_path.open("wb") as dump_file:
        result = subprocess.run(
            ["docker", "exec", container, "pg_dump", "-U", db_user, db_name],
            stdout=dump_file,
            stderr=subprocess.PIPE,
            check=False,
        )
    if result.returncode != 0:
        output_path.unlink(missing_ok=True)
        raise RuntimeError(
            f"pg_dump failed (exit {result.returncode}): "
            f"{result.stderr.decode('utf-8', errors='replace')}"
        )
    if output_path.stat().st_size == 0:
        output_path.unlink(missing_ok=True)
        raise RuntimeError("pg_dump produced an empty file — treating as a failed backup")


def _prune_old_backups(backup_dir: Path, *, keep: int) -> list[Path]:
    dumps = sorted(backup_dir.glob("agentic_ai_governance_*.sql"), reverse=True)
    stale = dumps[keep:]
    for path in stale:
        path.unlink()
    return stale


def _fetch_ledger_anchors(db_user: str, db_name: str) -> list[dict[str, object]]:
    """Query each run's latest audit_ledger row directly via psql inside the
    container — no app/session dependency, so this script has no import-time
    coupling to the FastAPI app and works even if the app itself won't start.
    """
    query = (
        "SELECT DISTINCT ON (run_id) run_id, sequence_number, entry_hash "
        "FROM audit_ledger_entries ORDER BY run_id, sequence_number DESC;"
    )
    result = subprocess.run(
        [
            "docker", "exec", _DEFAULT_CONTAINER, "psql",
            "-U", db_user, "-d", db_name, "-t", "-A", "-F", ",", "-c", query,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ledger anchor query failed: {result.stderr.strip()}")
    anchors = []
    for line in result.stdout.strip().splitlines():
        if not line.strip():
            continue
        run_id, sequence_number, entry_hash = line.split(",", 2)
        anchors.append(
            {"run_id": run_id, "entry_count": int(sequence_number), "entry_hash": entry_hash}
        )
    return anchors


def _append_anchor_log(backup_dir: Path, *, timestamp: str, anchors: list[dict[str, object]]) -> Path:
    anchor_log_path = backup_dir / "ledger_anchors.log"
    with anchor_log_path.open("a", encoding="utf-8") as log_file:
        log_file.write(json.dumps({"timestamp": timestamp, "anchors": anchors}) + "\n")
    return anchor_log_path


def backup(
    *,
    backup_dir: Path = _DEFAULT_BACKUP_DIR,
    container: str = _DEFAULT_CONTAINER,
    db_user: str | None = None,
    db_name: str | None = None,
    keep: int = _DEFAULT_RETENTION,
) -> Path:
    db_user = db_user or os.getenv("POSTGRES_USER", "postgres")
    db_name = db_name or os.getenv("POSTGRES_DB", "agentic_ai_governance")
    backup_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    dump_path = backup_dir / f"agentic_ai_governance_{timestamp}.sql"

    _run_pg_dump(container=container, db_user=db_user, db_name=db_name, output_path=dump_path)
    pruned = _prune_old_backups(backup_dir, keep=keep)

    try:
        anchors = _fetch_ledger_anchors(db_user, db_name)
        _append_anchor_log(backup_dir, timestamp=timestamp, anchors=anchors)
    except Exception as exc:  # noqa: BLE001 — the dump itself already succeeded
        print(f"warning: dump succeeded but ledger anchoring failed: {exc}", file=sys.stderr)

    print(f"Backed up to {dump_path} ({dump_path.stat().st_size} bytes)")
    if pruned:
        print(f"Pruned {len(pruned)} backup(s) older than the last {keep}")
    return dump_path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backup-dir", type=Path, default=_DEFAULT_BACKUP_DIR)
    parser.add_argument("--container", default=_DEFAULT_CONTAINER)
    parser.add_argument("--keep", type=int, default=_DEFAULT_RETENTION)
    args = parser.parse_args()

    backup(backup_dir=args.backup_dir, container=args.container, keep=args.keep)


if __name__ == "__main__":
    main()
