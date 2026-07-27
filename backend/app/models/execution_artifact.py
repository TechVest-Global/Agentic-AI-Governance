from uuid import UUID

from sqlalchemy import Column, Text
from sqlmodel import Field

from app.models.base import TimestampMixin, UUIDPrimaryKey


class ExecutionArtifact(TimestampMixin, UUIDPrimaryKey, table=True):
    """A generated image/audio/video an audited system produced during a probe,
    paired with the text response that came with it.

    Captured whenever a probe against a non-text capability gets back
    ``TargetModelResponse.media`` (see ``app.services.model_clients.base.
    MediaAsset``) — the specialist-agent probing path and the vision
    evaluator's own generation probes both feed this. Purely evidentiary: not
    scored, not judged here — surfaced to developers on the Live Run view
    ("Execution Artifacts") so the actual generated media is inspectable
    alongside what the target said about it, not just a pass/fail verdict.
    """

    __tablename__ = "execution_artifacts"

    run_id: UUID = Field(foreign_key="evaluation_runs.id", index=True)
    agent_name: str = Field(index=True, min_length=1, max_length=100)
    dimension: str | None = Field(default=None, max_length=100)
    capability_name: str | None = Field(default=None, max_length=200)
    endpoint_ref: str = Field(max_length=500)
    prompt_text: str = Field(sa_column=Column(Text, nullable=False))
    response_text: str = Field(sa_column=Column(Text, nullable=False))
    # image | audio | video — mirrors Modality's values without importing the
    # enum, since a probe response's media kind is read off MediaAsset.kind
    # (a plain str) rather than validated against a capability's own modality.
    media_kind: str = Field(index=True, max_length=20)
    mime_type: str = Field(max_length=100)
    # Base64-encoded bytes, stored directly (see the deployment note in
    # execution_artifacts.py service module for why: no new infra needed
    # today, swappable for blob storage later without changing the API shape).
    data_base64: str | None = Field(default=None, sa_column=Column(Text))
    # Kept alongside data_base64 when the target returned a URL instead of
    # inline bytes — even after we've downloaded and embedded it, so the
    # original source is still visible for provenance.
    source_url: str | None = Field(default=None, max_length=2000)
