"""CM-030/031/032 are scored by probing the target, for every system.

These metrics were catalogued against `evidently`, had no integration, and were
skipped on every run — every non-skipped result they ever carried came from the
mock or threshold evaluator. DriftEvaluator replaces that with a real
experiment: baseline probe, perturbed/repeated/pressured probes, judged
comparisons.

The tests pin the properties that make it work for ANY registered system: the
baseline is designed per system rather than canned, the routing works for
databases seeded before the change as well as after, and every way the
experiment can fail produces an explicit skip instead of a number.
"""

from __future__ import annotations

from unittest.mock import patch
from uuid import uuid4

import pytest
from app.core.config import get_settings
from app.models.ai_system import AISystem
from app.models.enums import MetricResultStatus
from app.schemas.governance import MetricPlanItem
from app.services.evaluators.base import MetricEvaluationInput
from app.services.evaluators.drift_evaluator import (
    _CONSISTENCY,
    _IDENTITY,
    _REGRESSION,
    DriftEvaluator,
)
from app.services.evaluators.registry import EVALUATORS, get_evaluator
from app.services.model_clients.base import TargetModelResponse

_FORMULAS = [(_REGRESSION, "CM-030"), (_CONSISTENCY, "CM-031"), (_IDENTITY, "CM-032")]


@pytest.fixture(autouse=True)
def _clean_settings():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _system(name: str = "Marketing Campaign Generator", system_type: str = "content_generation"):
    return AISystem(
        id=uuid4(),
        name=name,
        owner="o",
        system_type=system_type,
        deployment_environment="dev",
        model_provider="openai",
        target_endpoint_ref="http://localhost:8001",
        selected_frameworks=[],
    )


def _metric(metric_id: str, formula: str) -> MetricPlanItem:
    return MetricPlanItem(
        metric_config_id=uuid4(),
        metric_id=metric_id,
        name=formula,
        version="1",
        dimension="robustness",
        tool_name="drift",
        scoring_config={"formula": formula},
        threshold_rules={},
    )


class _Target:
    """Answers every probe, optionally failing the first ``fail_after`` onward."""

    provider = "t"
    credential_ref = "none"
    supports_media = False

    def __init__(self, *, answers: list[str] | None = None, fail_after: int | None = None) -> None:
        self._answers = answers
        self._fail_after = fail_after
        self.prompts: list[str] = []

    def invoke(self, request):  # noqa: ANN001 - test double
        self.prompts.append(request.prompt)
        n = len(self.prompts)
        if self._fail_after is not None and n > self._fail_after:
            raise RuntimeError("target unreachable")
        if self._answers:
            return self._response(self._answers[min(n - 1, len(self._answers) - 1)])
        return self._response("a stable, on-brand answer")

    def _response(self, text: str) -> TargetModelResponse:
        return TargetModelResponse(
            provider=self.provider,
            endpoint_ref="e",
            raw_output=text,
            sanitized_output=text,
            trace_id="t",
            latency_ms=1,
        )


def _evaluate(
    formula: str,
    metric_id: str,
    *,
    target=None,
    verdicts=None,
    designed="a plausible in-domain request about the product",
    system=None,
):
    """Run the evaluator with the judge stubbed: design first, then comparisons."""
    verdict_seq = list(verdicts if verdicts is not None else [{"ok": True, "reason": "same"}])
    calls = {"n": 0}

    def _fake_judge_json(_client, *, prompt: str, task: str):
        if task == "drift_probe_design":
            return None if designed is None else {"prompt": designed}
        verdict = verdict_seq[min(calls["n"], len(verdict_seq) - 1)]
        calls["n"] += 1
        return verdict

    evaluation_input = MetricEvaluationInput(
        metric=_metric(metric_id, formula),
        mock_score=0.0,
        force_status=None,
        source_name="test",
        session=None,
        ai_system=system or _system(),
        target_client=target if target is not None else _Target(),
        target_endpoint_ref="http://localhost:8001/api/compliance/probe/text",
        run_id=None,
    )
    with (
        patch(
            "app.services.evaluators.drift_evaluator._build_judge_client", return_value=object()
        ),
        patch(
            "app.services.evaluators.drift_evaluator._ask_judge_json",
            side_effect=_fake_judge_json,
        ),
    ):
        return DriftEvaluator().evaluate(evaluation_input)


@pytest.mark.parametrize(("formula", "metric_id"), _FORMULAS)
def test_a_stable_system_scores_and_is_not_skipped(formula: str, metric_id: str) -> None:
    result = _evaluate(formula, metric_id)

    assert result.status is MetricResultStatus.passed
    assert result.normalized_score == 1.0
    assert result.payload["probes_compared"] >= 2
    assert result.source_type == "drift_perturbation_probe"


@pytest.mark.parametrize(("formula", "metric_id"), _FORMULAS)
def test_an_unstable_system_scores_below_a_stable_one(formula: str, metric_id: str) -> None:
    """The whole point: instability has to move the number."""
    stable = _evaluate(formula, metric_id, verdicts=[{"ok": True, "reason": "same"}])
    unstable = _evaluate(
        formula,
        metric_id,
        verdicts=[
            {"ok": False, "reason": "contradicts the baseline"},
            {"ok": True, "reason": "same"},
        ],
    )

    assert unstable.normalized_score < stable.normalized_score
    assert unstable.payload["unstable_count"] >= 1


def test_the_named_rate_is_reported_as_the_raw_score() -> None:
    """CM-030 is a REGRESSION rate: 25% stable answers is a 75% regression rate."""
    result = _evaluate(
        _REGRESSION,
        "CM-030",
        verdicts=[
            {"ok": True, "reason": "same"},
            {"ok": False, "reason": "lost content"},
            {"ok": False, "reason": "lost content"},
            {"ok": False, "reason": "refused"},
        ],
    )

    assert result.normalized_score == 0.25
    assert result.raw_score == 0.75


def test_consistency_reports_the_rate_directly() -> None:
    """CM-031 is named for the good direction, so raw and normalized agree."""
    result = _evaluate(_CONSISTENCY, "CM-031", verdicts=[{"ok": True, "reason": "same"}])

    assert result.raw_score == result.normalized_score == 1.0


@pytest.mark.parametrize(("formula", "metric_id"), _FORMULAS)
def test_the_baseline_probe_is_the_designed_one_not_a_canned_scenario(
    formula: str, metric_id: str
) -> None:
    target = _Target()
    designed = "what is your refund window for summer campaign orders?"

    _evaluate(formula, metric_id, target=target, designed=designed)

    assert target.prompts[0] == designed
    # Every probe is the designed request, transformed — not a different
    # scenario. Overlap rather than equality because a perturbation may alter a
    # word (the typo variant) or add padding around it.
    designed_words = {w for w in designed.lower().replace("?", "").split() if len(w) > 3}
    for prompt in target.prompts:
        present = {w for w in designed_words if w in prompt.lower()}
        assert len(present) / len(designed_words) >= 0.6, (
            f"probe does not derive from the system-specific designed request: {prompt!r}"
        )


def test_consistency_resends_the_identical_prompt() -> None:
    target = _Target()

    _evaluate(_CONSISTENCY, "CM-031", target=target, designed="exact question")

    assert len(set(target.prompts)) == 1, "consistency measures resampling, not perturbation"


def test_regression_perturbs_without_repeating_itself() -> None:
    target = _Target()

    _evaluate(_REGRESSION, "CM-030", target=target, designed="Please summarise the return policy.")

    assert len(set(target.prompts)) == len(target.prompts), "each perturbation must be distinct"


def test_identity_probes_carry_pressure_the_baseline_does_not() -> None:
    target = _Target()

    _evaluate(_IDENTITY, "CM-032", target=target, designed="tell me about the summer campaign")

    assert len(target.prompts) > 1
    assert all(len(p) > len(target.prompts[0]) for p in target.prompts[1:]), (
        "identity probes append pressure to the baseline"
    )


@pytest.mark.parametrize(("formula", "metric_id"), _FORMULAS)
def test_a_design_failure_skips_rather_than_falling_back(formula: str, metric_id: str) -> None:
    target = _Target()

    result = _evaluate(formula, metric_id, target=target, designed=None)

    assert result.status is MetricResultStatus.skipped
    assert "dynamic probe design failed" in result.payload["skipped_reason"]
    assert target.prompts == [], "a canned scenario must never be substituted"


@pytest.mark.parametrize(("formula", "metric_id"), _FORMULAS)
def test_an_unreachable_target_skips_instead_of_scoring(formula: str, metric_id: str) -> None:
    result = _evaluate(formula, metric_id, target=_Target(fail_after=0))

    assert result.status is MetricResultStatus.skipped
    assert "baseline" in result.payload["skipped_reason"]


@pytest.mark.parametrize(("formula", "metric_id"), _FORMULAS)
def test_too_few_surviving_probes_skips_instead_of_scoring_the_survivor(
    formula: str, metric_id: str
) -> None:
    """Baseline plus one comparison is a coin flip, not a rate."""
    result = _evaluate(formula, metric_id, target=_Target(fail_after=2))

    assert result.status is MetricResultStatus.skipped
    assert "too few to report a rate" in result.payload["skipped_reason"]


def test_a_media_only_endpoint_skips_rather_than_scoring_silence() -> None:
    """An image endpoint returns no text; empty answers are not 'consistent'."""
    result = _evaluate(_CONSISTENCY, "CM-031", target=_Target(answers=[""]))

    assert result.status is MetricResultStatus.skipped
    assert "no text" in result.payload["skipped_reason"]


def test_no_judge_configured_skips_with_a_reason() -> None:
    evaluation_input = MetricEvaluationInput(
        metric=_metric("CM-030", _REGRESSION),
        mock_score=0.0,
        force_status=None,
        source_name="test",
        session=None,
        ai_system=_system(),
        target_client=_Target(),
        target_endpoint_ref="e",
        run_id=None,
    )
    with patch(
        "app.services.evaluators.drift_evaluator._build_judge_client", return_value=None
    ):
        result = DriftEvaluator().evaluate(evaluation_input)

    assert result.status is MetricResultStatus.skipped
    assert "no judge LLM configured" in result.payload["skipped_reason"]


def test_it_works_for_a_system_of_any_kind() -> None:
    """No per-system branching: an HR screener runs the same experiment."""
    result = _evaluate(
        _REGRESSION,
        "CM-030",
        system=_system(name="HR Recruitment System", system_type="decision_support"),
        designed="summarise this candidate's qualifications",
    )

    assert result.status is MetricResultStatus.passed


def test_both_the_old_and_new_tool_names_route_to_the_real_evaluator() -> None:
    """Databases seeded before this change still carry tool_name='evidently'."""
    assert isinstance(EVALUATORS["evidently"], DriftEvaluator)
    assert isinstance(EVALUATORS["drift"], DriftEvaluator)
    assert EVALUATORS["evidently"] is EVALUATORS["drift"]
    assert isinstance(get_evaluator("evidently"), DriftEvaluator)


def test_the_auto_router_no_longer_skips_these_metrics() -> None:
    """The regression this whole change exists to prevent."""
    target = _Target()
    evaluation_input = MetricEvaluationInput(
        metric=_metric("CM-030", _REGRESSION),
        mock_score=0.0,
        force_status=None,
        source_name="test",
        session=None,
        ai_system=_system(),
        target_client=target,
        target_endpoint_ref="e",
        run_id=None,
    )
    # Route the way a real run does: by the metric's own tool_name, as stored.
    object.__setattr__(evaluation_input.metric, "tool_name", "evidently")

    with (
        patch(
            "app.services.evaluators.drift_evaluator._build_judge_client", return_value=object()
        ),
        patch(
            "app.services.evaluators.drift_evaluator._ask_judge_json",
            side_effect=lambda _c, *, prompt, task: (
                {"prompt": "designed"} if task == "drift_probe_design" else {"ok": True, "reason": "r"}
            ),
        ),
    ):
        result = get_evaluator("auto").evaluate(evaluation_input)

    assert result.status is not MetricResultStatus.skipped
    assert result.source_type != "auto_router"
    assert target.prompts, "the target must actually be probed now"
