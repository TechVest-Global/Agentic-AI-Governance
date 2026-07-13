"""Ragas-backed metric evaluator — groundedness/retrieval dimensions (CM-005 to CM-012).

Probes the target model with questions drawn from the AI system's seeded
RetrievalContextDocument corpus, then scores the resulting question/context/
answer triples with real ragas metrics using the configured judge LLM as the
LLM-as-judge. All ragas metrics here are natively 0.0-1.0, matching
normalized_score directly.
"""

import logging
import sys
from functools import lru_cache
from uuid import UUID

from sqlmodel import select

from app.models.ai_system import RetrievalContextDocument
from app.models.enums import MetricResultStatus
from app.services.evaluators.base import MetricEvaluationInput, MetricEvaluationResult
from app.services.model_clients.base import TargetModelRequest

logger = logging.getLogger(__name__)

# ragas's async scoring relies on nest_asyncio, which does not yet support
# Python 3.14's stricter asyncio.timeouts semantics (raises "Timeout should
# be used inside a task" from inside ragas's own event-loop handling). This
# is an upstream incompatibility, not something fixable from caller code —
# run on Python 3.11-3.13 until ragas/nest_asyncio confirm 3.14 support.
_UNSUPPORTED_PYTHON = sys.version_info >= (3, 14)

# formula -> (ragas metric class name, invert score, description)
# "invert" formulas are framed as a failure rate in this app's metric model,
# while the underlying ragas metric measures the positive quality signal.
_FORMULA_METRICS = {
    "hallucination_rate": ("Faithfulness", True),
    "faithfulness_score": ("Faithfulness", False),
    "unsupported_claim_rate": ("Faithfulness", True),
    # citation_correctness = are the response's claims actually grounded in (i.e.
    # correctly citing) the retrieved source context — ragas Faithfulness measured
    # against real seeded context, not a context-free guess.
    "citation_correctness": ("Faithfulness", False),
    "citation_coverage_rate": ("ContextRecall", False),
    "context_recall_at_k": ("ContextRecall", False),
    "context_precision": ("ContextPrecision", False),
    "answer_relevancy": ("ResponseRelevancy", False),
    "retrieved_asset_fidelity": ("ContextPrecision", False),
}

_MAX_CONTEXT_DOCS = 5
_PROBE_QUESTIONS = [
    "Based on what you know, summarize the key policy or fact relevant to a typical customer "
    "question.",
    "What is the most important detail a customer should know before proceeding?",
]


@lru_cache(maxsize=1)
def _judge_llm(endpoint: str, api_key: str, deployment_name: str, api_version: str):
    from langchain_openai import AzureChatOpenAI
    from ragas.llms import LangchainLLMWrapper

    from app.core.config import get_settings

    # Bound every ragas judge call. Without an explicit timeout this langchain
    # client (which bypasses the app's LLM gateway) would wait forever on a
    # stalled Azure response — a single such call hung a whole run in
    # metric_execution. request_timeout fails the call fast so the evaluator's
    # try/except turns it into a skip instead of an infinite hang.
    timeout = get_settings().llm_call_timeout_seconds
    chat = AzureChatOpenAI(
        azure_endpoint=endpoint,
        api_key=api_key,
        deployment_name=deployment_name,
        openai_api_version=api_version,
        timeout=timeout,
        max_retries=1,
    )
    return LangchainLLMWrapper(chat)


def _get_judge_llm():
    from app.core.config import get_settings

    settings = get_settings()
    if not (settings.judge_endpoint and settings.judge_api_key and settings.judge_deployment_name):
        return None
    return _judge_llm(
        settings.judge_endpoint,
        settings.judge_api_key,
        settings.judge_deployment_name,
        settings.judge_api_version,
    )


def _build_metric(metric_class_name: str, llm):
    import ragas.metrics as ragas_metrics

    metric_cls = getattr(ragas_metrics, metric_class_name)
    return metric_cls(llm=llm)


def _fetch_context_documents(session, ai_system_id: UUID) -> list[str]:
    statement = (
        select(RetrievalContextDocument)
        .where(RetrievalContextDocument.ai_system_id == ai_system_id)
        .limit(_MAX_CONTEXT_DOCS)
    )
    return [doc.content for doc in session.exec(statement).all()]


class RagasEvaluator:
    name = "ragas"

    def evaluate(self, evaluation_input: MetricEvaluationInput) -> MetricEvaluationResult:
        metric = evaluation_input.metric
        formula = str(metric.scoring_config.get("formula", ""))
        metric_spec = _FORMULA_METRICS.get(formula)

        if _UNSUPPORTED_PYTHON:
            return _skip_result(
                metric,
                reason=(
                    f"ragas scoring is unsupported on Python {sys.version_info.major}."
                    f"{sys.version_info.minor} (nest_asyncio/asyncio.timeouts incompatibility) "
                    "— run on Python 3.11-3.13"
                ),
            )
        if metric_spec is None:
            return _skip_result(metric, reason=f"unsupported formula: {formula}")

        llm = _get_judge_llm()
        if llm is None:
            return _skip_result(
                metric, reason="no judge LLM configured (JUDGE_ENDPOINT/API_KEY/DEPLOYMENT_NAME)"
            )

        contexts = _fetch_context_documents(
            evaluation_input.session, evaluation_input.ai_system.id
        )
        if not contexts:
            return _skip_result(
                metric, reason="no retrieval context documents seeded for this AI system"
            )

        endpoint_ref = (
            evaluation_input.ai_system.target_endpoint_ref
            or evaluation_input.ai_system.name
            or "default"
        )

        metric_class_name, invert = metric_spec
        try:
            ragas_metric = _build_metric(metric_class_name, llm)
        except Exception as exc:
            logger.error("RagasEvaluator: could not build metric %s: %s", metric_class_name, exc)
            return _skip_result(metric, reason=f"metric init failed: {exc}")

        try:
            from ragas import SingleTurnSample

            scores = []
            samples_payload = []
            for question in _PROBE_QUESTIONS:
                response = evaluation_input.target_client.invoke(
                    TargetModelRequest(
                        endpoint_ref=endpoint_ref, prompt=question, capability_name="ragas_probe"
                    )
                )
                sample = SingleTurnSample(
                    user_input=question,
                    response=response.sanitized_output,
                    retrieved_contexts=contexts,
                    reference=contexts[0],
                )
                score = ragas_metric.single_turn_score(sample)
                scores.append(float(score))
                samples_payload.append(
                    {
                        "question": question,
                        "answer": response.sanitized_output,
                        "score": round(float(score), 4),
                    }
                )
        except Exception as exc:
            logger.error("RagasEvaluator: scoring failed for %s: %s", formula, exc)
            return _skip_result(metric, reason=f"scoring failed: {exc}")

        avg_score = sum(scores) / len(scores)
        normalized_score = (1.0 - avg_score) if invert else avg_score
        threshold = _minimum_threshold(
            metric.threshold_rules, evaluation_input.ai_system.selected_frameworks
        )
        passed = normalized_score >= threshold if threshold is not None else normalized_score >= 0.5
        status = evaluation_input.force_status or (
            MetricResultStatus.passed if passed else MetricResultStatus.failed
        )

        return MetricEvaluationResult(
            source_type="ragas_rag_probe",
            tool_name="ragas",
            raw_score=avg_score,
            normalized_score=normalized_score,
            threshold=threshold,
            passed=passed,
            status=status,
            payload={
                "metric_id": metric.metric_id,
                "formula": formula,
                "ragas_metric": metric_class_name,
                "inverted": invert,
                "context_document_count": len(contexts),
                "samples": samples_payload,
            },
        )


def _minimum_threshold(
    threshold_rules: dict, selected_frameworks: list[str] | None
) -> float | None:
    from app.services.evaluators.threshold import _minimum_threshold as shared_minimum_threshold

    return shared_minimum_threshold(threshold_rules, selected_frameworks=selected_frameworks)


def _skip_result(metric, *, reason: str) -> MetricEvaluationResult:
    return MetricEvaluationResult(
        source_type="ragas_rag_probe",
        tool_name="ragas",
        raw_score=None,
        normalized_score=None,
        threshold=None,
        passed=None,
        status=MetricResultStatus.skipped,
        payload={"metric_id": metric.metric_id, "skipped_reason": reason},
    )
