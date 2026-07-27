"""Persist generated-media artifacts (images/audio/video an audited system
produced during a probe), paired with the text response that came with them.

Two call sites feed this: ModelBackedAgent._probe_target (specialist-agent
probes against image/video/audio capabilities) and VisionEvaluator (its own
image-safety and video-temporal-consistency generation probes). Both already
receive TargetModelResponse.media — this is purely the persistence step nothing
here scores or judges anything.

Storage is base64 in Postgres, same pattern as everything else in this app
(no new infra). Fine for the probe images and short (few-second) probe videos
this system actually generates; swap for blob storage later without changing
the ExecutionArtifact shape or the API routes if volume grows.
"""

from __future__ import annotations

import base64
import logging
import urllib.request
from uuid import UUID

from sqlmodel import Session, select

from app.models.execution_artifact import ExecutionArtifact
from app.services.model_clients.base import MediaAsset

logger = logging.getLogger(__name__)

# Generous but bounded — a probe video is a few seconds at most (see
# VisionEvaluator's frame-sampling budget); this just guards against an
# unexpectedly huge response consuming excessive memory/DB space.
_MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024


def record_execution_artifacts(
    session: Session,
    *,
    run_id: UUID | None,
    agent_name: str,
    dimension: str | None,
    capability_name: str | None,
    endpoint_ref: str,
    prompt_text: str,
    response_text: str,
    media: list[MediaAsset],
) -> None:
    """Persist one ExecutionArtifact per media asset. No-op if run_id is None
    (an ad hoc probe outside any evaluation run) or media is empty.

    Commits immediately — callers include short-lived per-thread sessions
    (metric_execution.py's worker sessions) that close right after
    evaluate() returns, so deferring to a later caller-side commit would
    silently lose these rows.
    """
    if run_id is None or not media:
        return
    for asset in media:
        data_base64 = asset.data_base64
        if not data_base64 and asset.url:
            data_base64 = _try_download_as_base64(asset.url)
        if not data_base64 and not asset.url:
            continue
        session.add(
            ExecutionArtifact(
                run_id=run_id,
                agent_name=agent_name,
                dimension=dimension,
                capability_name=capability_name,
                endpoint_ref=endpoint_ref,
                prompt_text=prompt_text,
                response_text=response_text,
                media_kind=asset.kind,
                mime_type=asset.mime_type,
                data_base64=data_base64,
                source_url=asset.url,
            )
        )
    session.commit()


def _try_download_as_base64(url: str, *, timeout: float = 30.0) -> str | None:
    """Best-effort: embed the bytes so the artifact survives even if the
    target's URL is temporary. Returns None on any failure — the artifact
    still gets persisted with just source_url in that case, rather than
    being dropped entirely."""
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            data = resp.read(_MAX_DOWNLOAD_BYTES + 1)
    except Exception as exc:  # noqa: BLE001 - persisted artifact is best-effort
        logger.warning("execution_artifacts: could not download media from %s: %s", url, exc)
        return None
    if len(data) > _MAX_DOWNLOAD_BYTES:
        logger.warning(
            "execution_artifacts: media at %s exceeds %d bytes, storing URL only",
            url,
            _MAX_DOWNLOAD_BYTES,
        )
        return None
    return base64.b64encode(data).decode()


def list_execution_artifacts(session: Session, *, run_id: UUID) -> list[ExecutionArtifact]:
    return list(
        session.exec(
            select(ExecutionArtifact)
            .where(ExecutionArtifact.run_id == run_id)
            .order_by(ExecutionArtifact.created_at.asc())
        ).all()
    )


def get_execution_artifact(
    session: Session, *, run_id: UUID, artifact_id: UUID
) -> ExecutionArtifact | None:
    return session.exec(
        select(ExecutionArtifact).where(
            ExecutionArtifact.id == artifact_id, ExecutionArtifact.run_id == run_id
        )
    ).one_or_none()
