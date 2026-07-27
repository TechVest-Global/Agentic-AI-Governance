"""Audio modality evaluator — ASR robustness via jiwer word-error-rate.

Sends audio probes (each carrying a ground-truth ``reference_text``) to the
audited system, reads the transcription it returns, and scores robustness as
``1 - WER`` (word error rate) using jiwer. Higher = closer to the reference =
more robust, matching the app's higher-is-better convention.

The audio probes must be supplied as ``MediaAsset`` inputs the target actually
transcribes. Against a text-only target (which cannot transcribe audio) the
evaluator degrades to SKIPPED with a clear reason rather than scoring noise —
the same defensive pattern the garak/pyrit evaluators use.
"""

import logging

from app.models.enums import MetricResultStatus
from app.services.evaluators.base import MetricEvaluationInput, MetricEvaluationResult
from app.services.evaluators.probe_log import build_probe_log_entry
from app.services.execution_artifacts import record_execution_artifacts
from app.services.model_clients.base import MediaAsset, TargetModelRequest

logger = logging.getLogger(__name__)

_SUPPORTED_FORMULAS = {"asr_robustness", "word_error_rate", "transcription_accuracy"}

_METHOD_BLURB = (
    "The system is asked to transcribe a spoken audio clip with a known, correct wording. "
    "An automated speech-accuracy scorer compares its transcription word-for-word against "
    "that correct reference text."
)


def _normalize(text: str) -> str:
    import re

    text = (text or "").lower()
    text = re.sub(r"[^\w\s]", " ", text)  # strip punctuation
    return re.sub(r"\s+", " ", text).strip()


def score_wer(reference: str, hypothesis: str) -> float:
    """Robustness score = 1 - WER, clamped to [0, 1]. Pure / testable.

    Text is lower-cased and stripped of punctuation before scoring so casing
    and punctuation differences don't inflate the error rate. Uses jiwer's
    default word-level WER (version-stable across jiwer 2.x-4.x).
    """
    import jiwer

    reference_norm = _normalize(reference)
    if not reference_norm:
        return 0.0
    wer = jiwer.wer(reference_norm, _normalize(hypothesis))
    return max(0.0, min(1.0, 1.0 - wer))


def _audio_probes(ai_system) -> list[MediaAsset]:
    """Audio probes for the system. Seeded audio assets carrying reference
    transcripts would live on the system's context; none are configured yet, so
    this returns the (currently empty) list and the evaluator skips cleanly."""
    metadata = getattr(ai_system, "metadata_json", None) or {}
    raw = metadata.get("audio_probes") or []
    probes: list[MediaAsset] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        probes.append(
            MediaAsset(
                kind="audio",
                mime_type=item.get("mime_type", "audio/wav"),
                data_base64=item.get("data_base64"),
                url=item.get("url"),
                reference_text=item.get("reference_text"),
            )
        )
    return probes


class AudioEvaluator:
    name = "asr"

    def evaluate(self, evaluation_input: MetricEvaluationInput) -> MetricEvaluationResult:
        metric = evaluation_input.metric
        formula = str(metric.scoring_config.get("formula", ""))

        if formula not in _SUPPORTED_FORMULAS:
            return _skip_result(metric, reason=f"unsupported formula: {formula}")

        probes = [p for p in _audio_probes(evaluation_input.ai_system) if p.reference_text]
        if not probes:
            return _skip_result(
                metric,
                reason=(
                    "no audio probes with reference transcripts configured for this "
                    "system (seed metadata_json.audio_probes, and use an ASR-capable target)"
                ),
            )

        if not getattr(evaluation_input.target_client, "supports_media", False):
            return _skip_result(
                metric,
                reason=(
                    "target client does not support media (supports_media=False) — the "
                    "audio probes would be silently dropped and only the bare text prompt "
                    "sent, so this metric is skipped rather than scoring a transcription "
                    "the target never actually received"
                ),
            )

        endpoint_ref = (
            evaluation_input.ai_system.target_endpoint_ref
            or evaluation_input.ai_system.name
            or "default"
        )

        scored = []
        probe_log = []
        total = 0.0
        for index, probe in enumerate(probes):
            try:
                response = evaluation_input.target_client.invoke(
                    TargetModelRequest(
                        endpoint_ref=endpoint_ref,
                        prompt="Transcribe the attached audio verbatim.",
                        capability_name=f"asr_{formula}",
                        media=[probe],
                    )
                )
                if response.media and evaluation_input.run_id is not None:
                    try:
                        record_execution_artifacts(
                            evaluation_input.session,
                            run_id=evaluation_input.run_id,
                            agent_name="asr",
                            dimension=evaluation_input.metric.dimension,
                            capability_name=f"asr_{formula}",
                            endpoint_ref=endpoint_ref,
                            prompt_text="Transcribe the attached audio verbatim.",
                            response_text=response.raw_output,
                            media=response.media,
                        )
                    except Exception:  # noqa: BLE001 - evidence capture must never fail scoring
                        logger.warning("AudioEvaluator: failed to persist execution artifact", exc_info=True)
                hypothesis = response.raw_output or ""
            except Exception as exc:  # noqa: BLE001
                logger.warning("AudioEvaluator: transcription probe %d failed: %s", index, exc)
                continue
            robustness = score_wer(probe.reference_text or "", hypothesis)
            total += robustness
            scored.append(
                {
                    "probe_index": index,
                    "reference_excerpt": (probe.reference_text or "")[:80],
                    "robustness": round(robustness, 4),
                }
            )
            probe_log.append(
                build_probe_log_entry(
                    name=f"{formula}_{index + 1}",
                    what_we_asked=f"Transcribe an audio clip that correctly says: \"{probe.reference_text}\"",
                    what_happened=f"The system transcribed it as: \"{hypothesis}\"",
                    method=_METHOD_BLURB,
                    outcome="pass" if robustness >= 0.9 else "fail",
                    why=f"The transcription matched about {round(robustness * 100)}% of the correct wording.",
                )
            )

        if not scored:
            return _skip_result(metric, reason="no audio probe produced a transcription")

        normalized_score = total / len(scored)
        threshold = _minimum_threshold(
            metric.threshold_rules, evaluation_input.ai_system.selected_frameworks
        )
        passed = normalized_score >= threshold if threshold is not None else normalized_score >= 0.99
        status = evaluation_input.force_status or (
            MetricResultStatus.passed if passed else MetricResultStatus.failed
        )

        return MetricEvaluationResult(
            source_type="asr_robustness_probe",
            tool_name="asr",
            raw_score=normalized_score,
            normalized_score=normalized_score,
            threshold=threshold,
            passed=passed,
            status=status,
            payload={
                "metric_id": metric.metric_id,
                "formula": formula,
                "probe_count": len(scored),
                "mean_robustness": round(normalized_score, 4),
                "scorer": "jiwer_wer",
                "probes": scored,
                "probe_log": probe_log,
            },
        )


def _minimum_threshold(threshold_rules: dict, selected_frameworks: list[str] | None) -> float | None:
    from app.services.evaluators.threshold import _minimum_threshold as shared_minimum_threshold

    return shared_minimum_threshold(threshold_rules, selected_frameworks=selected_frameworks)


def _skip_result(metric, *, reason: str) -> MetricEvaluationResult:
    return MetricEvaluationResult(
        source_type="asr_robustness_probe",
        tool_name="asr",
        raw_score=None,
        normalized_score=None,
        threshold=None,
        passed=None,
        status=MetricResultStatus.skipped,
        payload={"metric_id": metric.metric_id, "skipped_reason": reason},
    )
