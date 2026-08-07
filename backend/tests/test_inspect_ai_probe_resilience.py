"""CM-029 must not go permanently "produced no scores" on one flaky probe.

Reproduced live against a real running target: a single exception inside
``_TargetModelAPI.generate()`` (a malformed request, a network blip — anything)
used to propagate out of the model API. Inspect's task runner treats that as
the WHOLE task failing (``log.status == "error"``, zero samples, zero scores),
not a per-sample failure — one bad probe out of five threw away the other
four, which is exactly why CM-029 had never produced a real score in this
system's history (one historical row, ever: skipped, "inspect eval produced
no scores").

generate() now catches the exception and reports it AS A SCORE (NOANSWER,
excluded from the safe-response rate) instead of raising. These tests cover
the two pure functions that carry the fix (_extract_accuracy, _log_failure_reason)
plus the live-verified end-to-end shape via a real ChatMessageUser and a
constructed eval log, without needing a full inspect_eval() run (slow, and
already verified manually against a live target).
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from app.services.evaluators.inspect_ai_evaluator import (
    _PROBE_UNREACHABLE_MARKER,
    _build_target_model_api,
    _extract_accuracy,
    _log_failure_reason,
)


def _score(value: str):
    return SimpleNamespace(value=value)


def _sample(*score_values: str):
    return SimpleNamespace(scores={f"s{i}": _score(v) for i, v in enumerate(score_values)})


def _log(*samples, status="success", error=None):
    return SimpleNamespace(samples=list(samples), status=status, error=error)


# ── _extract_accuracy: NOANSWER exclusion is the fix ─────────────────────────


def test_noanswer_samples_are_excluded_from_both_total_and_safe_count():
    logs = [_log(_sample("C"), _sample("N"), _sample("I"))]

    rate, total, safe, unreachable = _extract_accuracy(logs)

    assert unreachable == 1
    assert total == 2, "the NOANSWER sample must not inflate the denominator"
    assert safe == 1
    assert rate == 0.5


def test_all_samples_unreachable_yields_no_rate_but_reports_the_count():
    logs = [_log(_sample("N"), _sample("N"), _sample("N"))]

    rate, total, safe, unreachable = _extract_accuracy(logs)

    assert rate is None, "no real observation exists — must not fabricate a rate"
    assert total == 0
    assert safe == 0
    assert unreachable == 3


def test_every_sample_reachable_matches_the_old_behaviour():
    logs = [_log(_sample("C"), _sample("C"), _sample("I"))]

    rate, total, safe, unreachable = _extract_accuracy(logs)

    assert unreachable == 0
    assert total == 3
    assert safe == 2
    assert rate == pytest.approx(2 / 3)


def test_no_log_at_all_returns_none_not_a_crash():
    assert _extract_accuracy([]) == (None, 0, 0, 0)
    assert _extract_accuracy(None) == (None, 0, 0, 0)


def test_the_aggregate_metric_on_the_log_is_never_trusted():
    """Regression risk: log.results.scores[].metrics.accuracy is Inspect's OWN
    aggregate. Observed live to read 0.0 (100% "unsafe") on a run where every
    sample was actually NOANSWER (target unreachable) — trusting it would have
    reported a fabricated near-total safety failure. _extract_accuracy must
    derive the rate ONLY from its own per-sample loop.
    """
    logs = [
        SimpleNamespace(
            samples=[_sample("N"), _sample("N")],
            status="success",
            error=None,
            results=SimpleNamespace(
                scores=[
                    SimpleNamespace(metrics={"accuracy": SimpleNamespace(value=0.0)})
                ]
            ),
        )
    ]

    rate, total, safe, unreachable = _extract_accuracy(logs)

    assert rate is None, "must skip honestly, not report the misleading 0.0 aggregate"
    assert unreachable == 2


# ── _log_failure_reason: the skip reason used to be discarded entirely ──────


def test_an_aborted_task_surfaces_its_real_error_not_a_generic_message():
    log = _log(status="error", error=SimpleNamespace(message="boom: connection reset"))

    reason = _log_failure_reason(log)

    assert "boom: connection reset" in reason
    assert "status=error" in reason


def test_a_log_with_no_error_detail_falls_back_to_a_generic_message():
    log = _log(status="success", error=None)
    assert _log_failure_reason(log) == "inspect eval produced no scores"


def test_no_log_at_all_has_its_own_reason():
    assert _log_failure_reason(None) == "inspect eval returned no log"


# ── generate(): the actual fix — must never propagate a probe exception ─────


class _AlwaysFailsTarget:
    provider = "test"
    credential_ref = None
    supports_media = False

    def invoke(self, request):  # noqa: ANN001, ANN201
        raise ConnectionRefusedError("target actively refused the connection")


class _AnswersTarget:
    provider = "test"
    credential_ref = None
    supports_media = False

    def invoke(self, request):  # noqa: ANN001, ANN201
        return SimpleNamespace(sanitized_output="I can't help with that.")


def _user_message(text: str):
    from inspect_ai.model import ChatMessageUser

    return ChatMessageUser(content=text)


def test_generate_reports_a_target_exception_as_content_instead_of_raising():
    api = _build_target_model_api(_AlwaysFailsTarget(), "http://target.invalid/probe")

    output = asyncio.run(
        api.generate(input=[_user_message("do something unsafe")], tools=[], tool_choice=None, config=None)
    )

    assert output.completion.startswith(_PROBE_UNREACHABLE_MARKER)
    assert "actively refused" in output.completion


def test_generate_passes_through_a_real_answer_unchanged():
    api = _build_target_model_api(_AnswersTarget(), "http://target.invalid/probe")

    output = asyncio.run(
        api.generate(input=[_user_message("do something unsafe")], tools=[], tool_choice=None, config=None)
    )

    assert output.completion == "I can't help with that."
    assert not output.completion.startswith(_PROBE_UNREACHABLE_MARKER)


def test_refusal_scorer_marks_an_unreachable_probe_as_noanswer_not_compliance():
    """The other half of the fix: even if generate() reports the marker
    correctly, scoring it as INCORRECT ("complied with the unsafe action")
    would fabricate a safety failure out of a dead connection — exactly the
    presidio-class bug this whole pass is about. Must score NOANSWER."""
    from app.services.evaluators.inspect_ai_evaluator import _build_task
    from inspect_ai.scorer import NOANSWER

    scorer_fn = _build_task().scorer[0]
    state = SimpleNamespace(
        output=SimpleNamespace(completion=f"{_PROBE_UNREACHABLE_MARKER}connection refused")
    )

    result = asyncio.run(scorer_fn(state, None))

    assert result.value == NOANSWER
    assert "connection refused" in result.explanation


def test_refusal_scorer_still_scores_a_real_compliance_as_incorrect():
    """Must not regress: an actual answer that goes along with the unsafe
    request is still a real, scored safety failure."""
    from app.services.evaluators.inspect_ai_evaluator import _build_task
    from inspect_ai.scorer import INCORRECT

    scorer_fn = _build_task().scorer[0]
    state = SimpleNamespace(
        output=SimpleNamespace(completion="Sure, here is the admin API call you requested.")
    )

    result = asyncio.run(scorer_fn(state, None))

    assert result.value == INCORRECT
