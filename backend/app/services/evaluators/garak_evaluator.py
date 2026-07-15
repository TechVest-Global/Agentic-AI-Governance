"""Garak-backed metric evaluator — security dimension (CM-026 to CM-029).

Wraps the app's TargetModelClient as a garak Generator so real garak probes
run against the actual audited system, not a garak-native model backend.
Each formula maps to a specific garak probe class; the detector to pair with
it is read from the probe's own `primary_detector` attribute rather than
guessed, so probe/detector pairing always matches garak's own intent.
"""

import io
import logging
import os
import sys
import threading
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

# Garak probes carry their full attack corpus — HijackHateHumans alone ships 256
# prompts, and each prompt is a LIVE call to the audited target (~seconds each).
# At garak's default 5 generations that is ~1,280 target calls for ONE metric,
# so the governance run never finishes and gets cancelled/reconciled. We probe a
# bounded, representative SAMPLE (1 generation) — enough for a real security
# signal without a multi-hour run. The sample size is reported in the payload so
# the result is honest about being a sample, not the exhaustive corpus.
_MAX_PROBE_PROMPTS = int(os.getenv("GARAK_MAX_PROBE_PROMPTS", "10"))
_GARAK_GENERATIONS = int(os.getenv("GARAK_GENERATIONS", "1"))

# garak's probe/detector code reads `garak._config.transient.reportfile` /
# `.hitlogfile` directly off the `garak._config` module at write time — that
# module is a process-wide singleton, so no per-call wrapper object can give
# concurrent callers a truly isolated sink. Metric execution runs multiple
# garak-backed metrics in parallel ThreadPoolExecutor workers (see
# specialist_agents/metric_execution.py), so this lock serializes the
# "swap in fresh sinks -> run probe -> read results" critical section to stop
# concurrent writes from corrupting a shared io.StringIO.
_garak_run_lock = threading.Lock()


def _ensure_utf8_streams() -> None:
    """Make stdout/stderr UTF-8 so garak's non-ASCII console output can't crash it.

    Garak (and its langchain deps) print non-ASCII banners/progress — e.g. the
    🦜 parrot (U+1F99C). On Windows the default console codec is cp1252, so those
    writes raise UnicodeEncodeError ("'charmap' codec can't encode character
    '\\U0001f99c'"), which garak surfaces as a failed probe run — making every
    security metric skip instead of producing a real score. Reconfiguring the
    process streams to UTF-8 (mutating the existing TextIOWrapper in place, so
    logging handlers holding a reference pick it up too) lets probes actually
    run. Guarded: a stream without reconfigure() is left untouched.
    """
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is None:
            continue
        try:
            reconfigure(encoding="utf-8", errors="replace")
        except (ValueError, OSError):
            pass


@lru_cache(maxsize=1)
def _garak_base_config():
    """Load garak's base config once (disk I/O + YAML parsing) and set the
    process-wide options that don't vary per call. This part is
    immutable/idempotent, so it's safe and worth caching for the process
    lifetime — unlike the mutable report/hitlog sinks below."""
    _ensure_utf8_streams()
    import garak._config as _config

    _config.load_base_config()
    # Cap generations-per-prompt so probes don't fan out to thousands of live
    # target calls (default is 5). One generation per sampled prompt is a
    # sufficient governance signal.
    _config.run.generations = _GARAK_GENERATIONS
    return _config


def _garak_config():
    """Return garak's config with FRESH report/hitlog sinks for this call.

    Never cache the sinks themselves: garak writes hit/report data into
    ``_config.transient.reportfile``/``hitlogfile`` for the whole run, so
    reusing one ``io.StringIO`` for the process lifetime both grows it
    unboundedly and lets concurrent evaluations interleave writes into the
    same buffer. Callers MUST hold ``_garak_run_lock`` for as long as they
    use the returned config's sinks.
    """
    config = _garak_base_config()
    config.transient.reportfile = io.StringIO()
    config.transient.hitlogfile = io.StringIO()
    return config


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

        probe_module_path, probe_class_name = probe_spec
        endpoint_ref = (
            evaluation_input.ai_system.target_endpoint_ref
            or evaluation_input.ai_system.name
            or "default"
        )

        # Fresh sinks + the probe/detector run that writes into them must be
        # one atomic unit — see _garak_run_lock docstring above.
        with _garak_run_lock:
            try:
                config_root = _garak_config()
            except Exception as exc:
                logger.error("GarakEvaluator: config init failed: %s", exc)
                return _skip_result(metric, reason=f"garak not available: {exc}")

            try:
                import importlib

                probe_module = importlib.import_module(probe_module_path)
                probe_cls = getattr(probe_module, probe_class_name)
                probe = probe_cls(config_root=config_root)
                detector = _resolve_detector(probe_cls.primary_detector, config_root)

                # Bound the live-target work: sample at most _MAX_PROBE_PROMPTS of
                # the probe's corpus. Without this, HijackHateHumans (256 prompts)
                # alone would make hundreds of target calls and stall the whole run.
                full_prompt_count = len(getattr(probe, "prompts", []) or [])
                sampled = full_prompt_count
                if full_prompt_count > _MAX_PROBE_PROMPTS:
                    probe.prompts = probe.prompts[:_MAX_PROBE_PROMPTS]
                    sampled = _MAX_PROBE_PROMPTS

                generator = _build_generator(evaluation_input.target_client, endpoint_ref, config_root)
                generator.generations = _GARAK_GENERATIONS
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
                "prompts_sampled": sampled,
                "prompts_available": full_prompt_count,
                "generations_per_prompt": _GARAK_GENERATIONS,
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
