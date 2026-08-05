from dataclasses import dataclass, field
from typing import Protocol


@dataclass(frozen=True)
class MediaAsset:
    """A non-text payload attached to a target request or response.

    Carries either an inline base64 blob or a URL (exactly one is expected).
    ``kind`` is one of the Modality values (image/audio/video); ``mime_type``
    is the concrete content type (e.g. image/png, audio/wav). Text-only clients
    ignore media; multimodal evaluators/clients populate and read it.
    """

    kind: str
    mime_type: str
    data_base64: str | None = None
    url: str | None = None
    # Optional ground-truth for reference-based scoring (e.g. the expected
    # transcript for an audio ASR-robustness probe).
    reference_text: str | None = None


@dataclass(frozen=True)
class TargetModelRequest:
    endpoint_ref: str
    prompt: str
    capability_name: str | None = None
    # Non-text inputs sent to the audited system (empty for text-only probes).
    media: list[MediaAsset] = field(default_factory=list)
    metadata: dict[str, object] = field(default_factory=dict)
    # Per-probe override of the client's configured HTTP timeout. None keeps the
    # client default. Needed because one timeout cannot serve every capability: a
    # text completion answers in seconds, while a video generation (Sora) runs for
    # minutes, so the shared 60s LLM_CALL_TIMEOUT_SECONDS guaranteed that every
    # video probe timed out before the target could possibly answer.
    timeout_seconds: float | None = None


@dataclass(frozen=True)
class TargetModelResponse:
    provider: str
    endpoint_ref: str
    raw_output: str
    sanitized_output: str
    trace_id: str
    latency_ms: int
    # Non-text outputs returned by the audited system (e.g. a generated image).
    media: list[MediaAsset] = field(default_factory=list)
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class GovernanceModelRequest:
    task: str
    prompt: str
    context: dict[str, object] = field(default_factory=dict)
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class GovernanceModelResponse:
    provider: str
    deployment_name: str | None
    content: str
    trace_id: str
    latency_ms: int
    metadata: dict[str, object] = field(default_factory=dict)


class TargetModelClient(Protocol):
    provider: str
    credential_ref: str | None
    # Whether this client actually attaches TargetModelRequest.media to the
    # outbound call and populates TargetModelResponse.media from what the
    # target returns. Clients that don't (most real text-only production
    # APIs) silently drop media — multimodal evaluators (vision/audio) MUST
    # check this flag before scoring, or they end up fabricating a result
    # against media that was never actually transmitted. Default False;
    # concrete clients override to True once they genuinely wire media I/O.
    supports_media: bool

    def invoke(self, request: TargetModelRequest) -> TargetModelResponse:
        """Call the audited application or model through an isolated target boundary."""


class GovernanceModelClient(Protocol):
    provider: str
    credential_ref: str | None

    def complete(self, request: GovernanceModelRequest) -> GovernanceModelResponse:
        """Call the approved governance reasoning model."""

