"""A system's registered capabilities decide which modality metrics apply.

The system-level ``modality`` field holds ONE value, so a multi-modal
application has to pick a headline. A FLUX+Sora+GPT-4o generator registers as
``image`` while carrying image, text and video capabilities — and filtering on
that field alone silently dropped the video metric from a system with a working
video endpoint. The audit said nothing about video, and nothing said why.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from app.configs.config_loader import load_metric_configs_from_dir
from app.models.ai_system import AISystem
from app.models.config import MetricConfig
from app.models.enums import Modality
from app.services.specialist_agents.metric_plans import _metric_applies_to_system


def _system(modality: Modality | None) -> AISystem:
    return AISystem(
        id=uuid4(),
        name="Marketing Campaign Generator",
        owner="o",
        system_type="content_generation",
        deployment_environment="dev",
        model_provider="openai",
        modality=modality,
    )


def _metric(modalities: list[str]) -> MetricConfig:
    return MetricConfig(
        id=uuid4(),
        metric_id="CM-TEST",
        name="test",
        dimension="robustness",
        scoring_config={"formula": "temporal_consistency"},
        applicable_modalities=modalities,
    )


def _applies(metric, system, *, cap_modalities: set[str], cap_types: set[str] | None = None) -> bool:
    return _metric_applies_to_system(
        metric,
        ai_system=system,
        capability_types=cap_types or set(),
        capability_modalities=cap_modalities,
    )


def test_a_capability_modality_makes_the_metric_apply() -> None:
    """The exact case that was broken: video capability, image headline."""
    assert _applies(
        _metric(["video"]),
        _system(Modality.image),
        cap_modalities={"image", "text", "video"},
    )


def test_the_system_level_modality_still_counts_on_its_own() -> None:
    """Single-endpoint systems often register no capabilities at all."""
    assert _applies(_metric(["image"]), _system(Modality.image), cap_modalities=set())


def test_a_modality_the_system_cannot_produce_does_not_apply() -> None:
    """The filter must still exclude — otherwise every metric applies to everything."""
    assert not _applies(
        _metric(["audio"]),
        _system(Modality.image),
        cap_modalities={"image", "text", "video"},
    )


def test_a_metric_with_no_declared_modality_applies_to_anything() -> None:
    assert _applies(_metric([]), _system(Modality.text), cap_modalities={"text"})


def test_a_system_with_no_modality_information_is_not_filtered_out() -> None:
    """Absence of registration detail must not silently narrow an audit."""
    assert _applies(_metric(["video"]), _system(None), cap_modalities=set())


# ---------------------------------------------------------------------------
# Catalog coverage: every modality the evaluators can judge needs a metric that
# names its formula, or the code path is unreachable from any config.
# ---------------------------------------------------------------------------

_EXPECTED = {
    "image": "visual_content_safety_rate",
    "video": "temporal_consistency",
    "audio": "asr_robustness",
}


@pytest.mark.parametrize(("modality", "formula"), sorted(_EXPECTED.items()))
def test_each_media_modality_has_a_metric_that_can_reach_its_evaluator(
    modality: str, formula: str
) -> None:
    """Guards the gap this change closed.

    The vision evaluator has judged images since it was written, but no metric
    declared visual_content_safety_rate, so nothing could ever route to it —
    a whole capability sitting behind a config vocabulary that never named it.
    """
    metrics = load_metric_configs_from_dir()
    matching = [
        m
        for m in metrics
        if m.formula == formula and modality in (m.applicable_modalities or [])
    ]
    assert matching, (
        f"no metric config declares formula={formula} for modality={modality}; "
        "the evaluator supporting it cannot be reached from any config"
    )


def test_the_media_metrics_route_to_a_registered_evaluator() -> None:
    """A metric whose tool names no evaluator is skipped by the auto router."""
    from app.services.evaluators.registry import EVALUATORS

    metrics = {m.metric_id: m for m in load_metric_configs_from_dir()}
    for metric_id in ("CM-033", "CM-034", "CM-045"):
        metric = metrics[metric_id]
        assert metric.tool in EVALUATORS, (
            f"{metric_id} declares tool={metric.tool!r}, which is not a registered "
            f"evaluator — it would be silently skipped. Known: {sorted(EVALUATORS)}"
        )
