"""Garak-backed metric evaluator — security dimension (CM-026 to CM-029).

Wraps the app's TargetModelClient as a garak Generator so real garak probes
run against the actual audited system, not a garak-native model backend.
Each formula maps to a specific garak probe class; the detector to pair with
it is read from the probe's own `primary_detector` attribute rather than
guessed, so probe/detector pairing always matches garak's own intent.
"""

import io
import logging
from functools import lru_cache

from app.models.enums import MetricResultStatus
from app.services.evaluators.base import MetricEvaluationInput, MetricEvaluationResult
from app.services.model_clients.base import TargetModelRequest

logger = logging.getLogger(__name__)

# formula -> (probe module, probe class name)
_FORMULA_PROBES = {
    "jailbreak_success_rate": ("garak.probes.dan", "Dan_11_0"),
    "prompt_injection_success_rate": ("garak.probes.promptinject", "HijackHateHumans"),
    "data_exfiltration_success_rate": ("garak.probes.leakreplay", "GuardianComplete"),
    "unsafe_tool_call_rate": ("garak.probes.malwaregen", "TopLevel"),
}


@lru_cache(maxsize=1)
def _garak_config():
    """Load garak's base config once and stub the transient report sinks it
    expects (normally opened by garak's own CLI harness)."""
    import garak._config as _config

    _config.load_base_config()
    _config.transient.reportfile = io.StringIO()
    _config.transient.hitlogfile = io.StringIO()
    return _config


def _build_generator(target_client, endpoint_ref: str, config_root):
    from garak.attempt import Message
    from garak.generators.base import Generator

    class _TargetGenerator(Generator):
        """GovernAI audited-system adapter."""

        generator_family_name = "govai_target"

        def __init__(self, name: str = "govai_target"):
            super().__init__(name, config_root=config_root)

        def _call_model(self, prompt, generations_this_call=1):
            prompt_text = prompt.text if hasattr(prompt, "text") else str(prompt)
            response = target_client.invoke(
                TargetModelRequest(
                    endpoint_ref=endpoint_ref, prompt=prompt_text, capability_name="garak_probe"
                )
            )
            return [Message(response.sanitized_output)] * generations_this_call

    return _TargetGenerator()


def _resolve_detector(primary_detector: str, config_root):
    import importlib

    module_suffix, class_name = primary_detector.rsplit(".", 1)
    module = importlib.import_module(f"garak.detectors.{module_suffix}")
    detector_cls = getattr(module, class_name)
    return detector_cls(config_root=config_root)


class GarakEvaluator:
    name = "garak"

    def evaluate(self, evaluation_input: MetricEvaluationInput) -> MetricEvaluationResult:
        metric = evaluation_input.metric
        formula = str(metric.scoring_config.get("formula", ""))
        probe_spec = _FORMULA_PROBES.get(formula)

        if probe_spec is None:
            return _skip_result(metric, reason=f"unsupported formula: {formula}")

        try:
            config_root = _garak_config()
        except Exception as exc:
            logger.error("GarakEvaluator: config init failed: %s", exc)
            return _skip_result(metric, reason=f"garak not available: {exc}")

        probe_module_path, probe_class_name = probe_spec
        endpoint_ref = (
            evaluation_input.ai_system.target_endpoint_ref
            or evaluation_input.ai_system.name
            or "default"
        )

        try:
            import importlib

            probe_module = importlib.import_module(probe_module_path)
            probe_cls = getattr(probe_module, probe_class_name)
            probe = probe_cls(config_root=config_root)
            detector = _resolve_detector(probe_cls.primary_detector, config_root)

            generator = _build_generator(evaluation_input.target_client, endpoint_ref, config_root)
            attempts = list(probe.probe(generator))

            all_scores: list[float] = []
            for attempt in attempts:
                for score in detector.detect(attempt):
                    if score is not None:
                        all_scores.append(float(score))
        except Exception as exc:
            logger.error("GarakEvaluator: probe run failed for %s: %s", formula, exc)
            return _skip_result(metric, reason=f"probe run failed: {exc}")

        if not all_scores:
            return _skip_result(metric, reason="no probe attempts produced results")

        # Garak detector scores are 0.0-1.0 "hit" likelihood (1.0 = attack succeeded).
        # The metric's direction is the inverse: normalized_score is the resistance rate.
        attack_success_rate = sum(all_scores) / len(all_scores)
        normalized_score = 1.0 - attack_success_rate
        threshold = _minimum_threshold(
            metric.threshold_rules, evaluation_input.ai_system.selected_frameworks
        )
        passed = (
            normalized_score >= threshold if threshold is not None else attack_success_rate == 0.0
        )
        status = evaluation_input.force_status or (
            MetricResultStatus.passed if passed else MetricResultStatus.failed
        )

        return MetricEvaluationResult(
            source_type="garak_security_probe",
            tool_name="garak",
            raw_score=normalized_score,
            normalized_score=normalized_score,
            threshold=threshold,
            passed=passed,
            status=status,
            payload={
                "metric_id": metric.metric_id,
                "formula": formula,
                "probe_class": f"{probe_module_path}.{probe_class_name}",
                "primary_detector": probe_cls.primary_detector,
                "attempt_count": len(attempts),
                "generation_count": len(all_scores),
                "attack_success_rate": attack_success_rate,
            },
        )


def _minimum_threshold(
    threshold_rules: dict, selected_frameworks: list[str] | None
) -> float | None:
    from app.services.evaluators.threshold import _minimum_threshold as shared_minimum_threshold

    return shared_minimum_threshold(threshold_rules, selected_frameworks=selected_frameworks)


def _skip_result(metric, *, reason: str) -> MetricEvaluationResult:
    return MetricEvaluationResult(
        source_type="garak_security_probe",
        tool_name="garak",
        raw_score=None,
        normalized_score=None,
        threshold=None,
        passed=None,
        status=MetricResultStatus.skipped,
        payload={"metric_id": metric.metric_id, "skipped_reason": reason},
    )
