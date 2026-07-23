"""Real-run reachability of the PyRIT and Inspect AI evaluators.

Both evaluators were fully built and independently functional, but no metric
YAML routed `tool_name` to either of them — a compliance run driven through
`evaluator_name="auto"` (the real pipeline path; see
`_AutoRoutingEvaluator` in evaluators/registry.py, which dispatches purely on
`metric.tool_name`) could therefore never reach them, only the standalone
Security Tools "run adapter" button could. Fixed by routing CM-026
(jailbreak_success_rate) to `tool: pyrit` and CM-029 (unsafe_tool_call_rate)
to `tool: inspect_ai` in their metric config YAMLs (garak keeps CM-027/CM-028
so its own dispatch path stays covered).

These tests dispatch through the same `_AutoRoutingEvaluator` a real run uses
and assert the call actually lands inside PyritEvaluator / InspectAIEvaluator
(identified by their distinctive `source_type`/`tool_name`), not a
fallback/skip from the router itself.
"""

from uuid import uuid4

import yaml

from app.models.ai_system import AISystem
from app.schemas.governance import MetricPlanItem
from app.services.evaluators.base import MetricEvaluationInput
from app.services.evaluators.registry import get_evaluator
from app.services.model_clients.mock import MockTargetModelClient

_METRICS_DIR = __file__.rsplit("backend", 1)[0] + "backend/app/configs/metrics"


def _load_metric_yaml(path: str) -> dict:
    import pathlib

    with open(pathlib.Path(_METRICS_DIR) / path, "r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def _metric_from_yaml(raw: dict) -> MetricPlanItem:
    return MetricPlanItem(
        metric_config_id=uuid4(),
        metric_id=raw["metric_id"],
        name=raw["metric_id"],
        dimension=raw["dimension"],
        tool_name=raw["tool"],
        version="1",
        scoring_config={"formula": raw["formula"]},
        threshold_rules=raw["thresholds"],
    )


def _ai_system() -> AISystem:
    return AISystem(
        name="Routing Test System",
        owner="AI Governance",
        system_type="chatbot",
        target_endpoint_ref="config://routing-test",
    )


def test_cm026_yaml_routes_to_pyrit_tool():
    raw = _load_metric_yaml("security/CM-026.yaml")
    assert raw["tool"] == "pyrit"
    assert raw["formula"] == "jailbreak_success_rate"


def test_cm029_yaml_routes_to_inspect_ai_tool():
    raw = _load_metric_yaml("security/CM-029.yaml")
    assert raw["tool"] == "inspect_ai"
    assert raw["formula"] == "unsafe_tool_call_rate"


def test_auto_routing_dispatches_cm026_to_pyrit_evaluator(monkeypatch):
    # Force the deterministic/fast SKIPPED path regardless of whether this
    # machine happens to have the isolated PyRIT venv provisioned — the point
    # of this test is confirming DISPATCH reaches PyritEvaluator, not
    # exercising PyRIT's own subprocess pipeline.
    import app.services.evaluators.pyrit_evaluator as pyrit_module

    monkeypatch.setattr(pyrit_module, "_isolated_python", lambda: None)

    raw = _load_metric_yaml("security/CM-026.yaml")
    metric = _metric_from_yaml(raw)
    evaluation_input = MetricEvaluationInput(
        metric=metric,
        mock_score=0.9,
        force_status=None,
        source_name="test",
        session=None,  # type: ignore[arg-type]
        ai_system=_ai_system(),
        target_client=MockTargetModelClient(provider="mock"),
        target_endpoint_ref="config://routing-test",
    )

    result = get_evaluator("auto").evaluate(evaluation_input)

    assert result.tool_name == "pyrit"
    assert result.source_type == "pyrit_adversarial_probe"
    assert "PyRIT isolated environment not provisioned" in result.payload["skipped_reason"]


def test_auto_routing_dispatches_cm029_to_inspect_ai_evaluator():
    raw = _load_metric_yaml("security/CM-029.yaml")
    metric = _metric_from_yaml(raw)
    evaluation_input = MetricEvaluationInput(
        metric=metric,
        mock_score=0.9,
        force_status=None,
        source_name="test",
        session=None,  # type: ignore[arg-type]
        ai_system=_ai_system(),
        target_client=MockTargetModelClient(provider="mock"),
        target_endpoint_ref="config://routing-test",
    )

    result = get_evaluator("auto").evaluate(evaluation_input)

    # A real Inspect AI eval actually ran against the mock target (not a
    # router fallback skip) — identified by its distinctive source_type.
    assert result.tool_name == "inspect_ai"
    assert result.source_type == "inspect_ai_agent_eval"
