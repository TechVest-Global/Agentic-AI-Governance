"""Ragas-backed metric evaluator — groundedness/retrieval dimensions (CM-005 to CM-012).

Probes the target model with questions drawn from the AI system's seeded
RetrievalContextDocument corpus, then scores the resulting question/context/
answer triples with real ragas metrics using the configured judge LLM as the
LLM-as-judge. All ragas metrics here are natively 0.0-1.0, matching
normalized_score directly.
"""

import json
import logging
import os
import subprocess
import sys
from functools import lru_cache
from pathlib import Path
from uuid import UUID

from sqlmodel import select

from app.models.ai_system import RetrievalContextDocument
from app.models.enums import MetricResultStatus
from app.services.evaluators.base import MetricEvaluationInput, MetricEvaluationResult
from app.services.evaluators.probe_log import build_probe_log_entry
from app.services.model_clients.base import TargetModelRequest

logger = logging.getLogger(__name__)

_METHOD_BLURB = (
    "The system is asked a question it should answer using its own approved source material. "
    "An automated groundedness checker then compares the reply against that source material "
    "and scores how well the reply is actually backed up by it."
)

# formula -> plain-English explanation of the ragas score (0.0-1.0, ragas's own
# positive-quality direction, not this app's inverted "rate" framing).
_RAGAS_EXPLAIN = {
    "hallucination_rate": lambda s: f"About {round((1 - s) * 100)}% of the claims in the reply were not backed by the source material it was given.",
    "faithfulness_score": lambda s: f"About {round(s * 100)}% of the claims in the reply were backed by the source material it was given.",
    "unsupported_claim_rate": lambda s: f"About {round((1 - s) * 100)}% of the claims in the reply had no support in the source material.",
    "citation_correctness": lambda s: f"About {round(s * 100)}% of the reply's claims were correctly grounded in the cited source material.",
    "citation_coverage_rate": lambda s: f"The retrieved material covered about {round(s * 100)}% of what was needed to answer the question fully.",
    "context_recall_at_k": lambda s: f"The retrieved material covered about {round(s * 100)}% of what was needed to answer the question fully.",
    "context_precision": lambda s: f"About {round(s * 100)}% of the material the system retrieved was actually relevant to the question.",
    "answer_relevancy": lambda s: f"The reply was judged about {round(s * 100)}% relevant to the question that was asked.",
    "retrieved_asset_fidelity": lambda s: f"About {round(s * 100)}% of the material the system retrieved was actually relevant to the question.",
}


def _ragas_why(formula: str, score: float) -> str:
    explain = _RAGAS_EXPLAIN.get(formula)
    return explain(score) if explain else f"The automated groundedness checker scored this reply {round(score * 100)}/100."

# ragas's async scoring relies on nest_asyncio, which does not yet support
# Python 3.14's stricter asyncio.timeouts semantics (raises "Timeout should
# be used inside a task" from inside ragas's own event-loop handling). This
# is an upstream incompatibility, not something fixable from caller code.
# On an unsupported interpreter we shell out to the isolated .venv-ragas
# interpreter (Python 3.11-3.13) for the scoring step only — same pattern as
# pyrit_evaluator.py's .venv-pyrit split, just for a Python-version conflict
# instead of a package-version conflict.
_UNSUPPORTED_PYTHON = sys.version_info >= (3, 14)


def _isolated_python() -> Path | None:
    """Locate the isolated ragas interpreter (Python 3.11-3.13, walled off
    from the main venv's unsupported 3.14). Overridable via RAGAS_PYTHON for
    non-default layouts."""
    override = os.getenv("RAGAS_PYTHON")
    if override:
        candidate = Path(override)
        return candidate if candidate.exists() else None

    repo_root = Path(__file__).resolve().parents[4]
    rel = "Scripts/python.exe" if sys.platform.startswith("win") else "bin/python"
    candidate = repo_root / ".venv-ragas" / rel
    return candidate if candidate.exists() else None


def _score_via_isolated_runner(
    python: Path,
    judge: dict,
    metric_class_name: str,
    samples: list[dict],
    *,
    timeout: float,
) -> list[float] | None:
    """Invoke the isolated ragas runner to score prepared samples. Returns
    None if the runner is missing, fails to launch, or errors."""
    runner = Path(__file__).with_name("ragas_runner.py")
    if not runner.exists():
        return None

    job = json.dumps({"judge": judge, "metric_class_name": metric_class_name, "samples": samples})
    try:
        proc = subprocess.run(
            [str(python), str(runner)],
            input=job,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except (subprocess.TimeoutExpired, OSError) as exc:
        logger.error("RagasEvaluator: isolated runner failed to launch: %s", exc)
        return None

    if proc.returncode != 0:
        logger.error("RagasEvaluator: runner exited %s: %s", proc.returncode, proc.stderr[-500:])
        return None
    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        logger.error("RagasEvaluator: runner returned non-JSON: %s", exc)
        return None
    if payload.get("error"):
        logger.error("RagasEvaluator: runner error: %s", payload["error"])
        return None
    scores = payload.get("scores")
    if not isinstance(scores, list) or len(scores) != len(samples):
        return None
    return [float(s) for s in scores]

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

# ragas metric classes that need an embeddings model, not just a judge LLM.
# _build_metric passes `llm=` only, and Settings has no embeddings deployment,
# so these cannot be scored here yet — see the guard in evaluate().
_METRICS_NEEDING_EMBEDDINGS = frozenset({"ResponseRelevancy"})


def _build_probe_questions(contexts: list[str]) -> list[str]:
    """Grounding-oriented probes anchored to the system's own seeded corpus.

    Faithfulness measures whether the answer's claims are supported by the
    retrieved context. Generic "based on what you know" prompts invite
    general-knowledge answers that are ungrounded by construction, so they
    fail faithfulness regardless of the chatbot's quality. These probes instead
    (a) instruct the assistant to answer ONLY from its documented sources and
    (b) anchor the question to the actual seeded context, so the score reflects
    real grounding rather than a question/corpus mismatch.
    """
    grounding = (
        "Answer using ONLY your official, approved knowledge sources. Be specific and factual. "
        "If the information is not in your documented sources, say you do not have it — do not speculate."
    )
    topic = (contexts[0][:200].strip() + "…") if contexts else ""
    questions = [
        f"{grounding}\n\nQuestion: What are the key facts a customer should know about the "
        "topic covered in your documentation?",
    ]
    if topic:
        questions.append(
            f"{grounding}\n\nBased strictly on your source material, summarize what your "
            f'documentation states about: "{topic}"'
        )
    return questions


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


def _judge_settings_dict() -> dict | None:
    """Same judge-configured check as _get_judge_llm, but as plain values —
    used to hand the judge config to the isolated runner subprocess instead
    of building an in-process LLM client that won't be used."""
    from app.core.config import get_settings

    settings = get_settings()
    if not (settings.judge_endpoint and settings.judge_api_key and settings.judge_deployment_name):
        return None
    return {
        "endpoint": settings.judge_endpoint,
        "api_key": settings.judge_api_key,
        "deployment": settings.judge_deployment_name,
        "api_version": settings.judge_api_version,
    }


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

        if metric_spec is None:
            return _skip_result(metric, reason=f"unsupported formula: {formula}")

        # A few ragas metrics score by embedding similarity, not by asking the
        # judge — and _build_metric only ever passes `llm=`. ResponseRelevancy
        # therefore raised ragas's own "'answer_relevancy' requires embeddings to
        # be set" deep inside scoring, which surfaced as an opaque
        # "scoring failed: ..." on the metric result. There is no embeddings
        # deployment in Settings at all, so this is unscoreable by construction:
        # say so up front, the way the missing-interpreter and missing-judge
        # branches below already do, instead of failing mid-score.
        if metric_spec[0] in _METRICS_NEEDING_EMBEDDINGS:
            return _skip_result(
                metric,
                reason=(
                    f"ragas {metric_spec[0]} scores by embedding similarity and no embeddings "
                    "model is configured — add an Azure OpenAI embeddings deployment and wire "
                    "it into _build_metric before selecting this metric"
                ),
            )

        # On an unsupported interpreter, score via the isolated .venv-ragas
        # runner instead of skipping outright — falls back to a real skip
        # (with setup instructions) only if that interpreter isn't provisioned.
        isolated_python = _isolated_python() if _UNSUPPORTED_PYTHON else None
        if _UNSUPPORTED_PYTHON and isolated_python is None:
            return _skip_result(
                metric,
                reason=(
                    f"ragas scoring is unsupported on Python {sys.version_info.major}."
                    f"{sys.version_info.minor} (nest_asyncio/asyncio.timeouts incompatibility) "
                    "and no isolated interpreter is provisioned — create one with "
                    "`py -3.12 -m venv .venv-ragas && .venv-ragas/Scripts/python -m pip install "
                    'ragas==0.3.2 langchain-openai==0.3.27 langchain-community==0.3.27 '
                    'langchain-core==0.3.86 "openai<2.0.0"` or set RAGAS_PYTHON.'
                ),
            )

        judge_settings = _judge_settings_dict()
        if judge_settings is None:
            return _skip_result(
                metric, reason="no judge LLM configured (JUDGE_ENDPOINT/API_KEY/DEPLOYMENT_NAME)"
            )

        ragas_metric = None
        if isolated_python is None:
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

        endpoint_ref = evaluation_input.target_endpoint_ref

        metric_class_name, invert = metric_spec
        if isolated_python is None:
            try:
                ragas_metric = _build_metric(metric_class_name, llm)
            except Exception as exc:
                logger.error("RagasEvaluator: could not build metric %s: %s", metric_class_name, exc)
                return _skip_result(metric, reason=f"metric init failed: {exc}")

        try:
            samples_payload = []
            for question in _build_probe_questions(contexts):
                response = evaluation_input.target_client.invoke(
                    TargetModelRequest(
                        endpoint_ref=endpoint_ref, prompt=question, capability_name="ragas_probe"
                    )
                )
                answer = response.sanitized_output
                score = None
                if isolated_python is None:
                    from ragas import SingleTurnSample

                    sample = SingleTurnSample(
                        user_input=question,
                        response=answer,
                        retrieved_contexts=contexts,
                        reference=contexts[0],
                    )
                    score = round(float(ragas_metric.single_turn_score(sample)), 4)
                samples_payload.append({"question": question, "answer": answer, "score": score})
        except Exception as exc:
            logger.error("RagasEvaluator: scoring failed for %s: %s", formula, exc)
            return _skip_result(metric, reason=f"scoring failed: {exc}")

        if isolated_python is not None:
            job_samples = [
                {
                    "question": s["question"],
                    "answer": s["answer"],
                    "contexts": contexts,
                    "reference": contexts[0],
                }
                for s in samples_payload
            ]
            isolated_scores = _score_via_isolated_runner(
                isolated_python, judge_settings, metric_class_name, job_samples, timeout=90.0
            )
            if isolated_scores is None:
                return _skip_result(
                    metric,
                    reason="ragas isolated runner failed — check RAGAS_PYTHON / .venv-ragas installation",
                )
            for sample, score in zip(samples_payload, isolated_scores, strict=True):
                sample["score"] = round(float(score), 4)

        scores = [s["score"] for s in samples_payload]
        avg_score = sum(scores) / len(scores)
        # ragas Faithfulness / ContextRecall / ContextPrecision are ALL "higher = better",
        # so the normalized (higher = better) score is the ragas score directly — for
        # every formula. `invert` only changes the human-readable RAW value: for formulas
        # phrased as a bad-thing rate (hallucination_rate, unsupported_claim_rate) the raw
        # is reported as that rate (= 1 - faithfulness, so 0 = good). It must NOT flip the
        # normalized score — doing so made a fully ungrounded answer (faithfulness 0.0)
        # wrongly report normalized 1.0 / PASS.
        normalized_score = avg_score
        raw_score = (1.0 - avg_score) if invert else avg_score
        threshold = _minimum_threshold(
            metric.threshold_rules, evaluation_input.ai_system.selected_frameworks
        )
        # threshold_rules are authored as a minimum quality bar (e.g. "must be at
        # least 95% faithful"), which is avg_score's own higher-is-better polarity
        # regardless of "invert" — normalized_score flips polarity for "_rate"
        # formulas (hallucination_rate, unsupported_claim_rate, ...) so the UI
        # reads as a failure rate, but comparing THAT against a high threshold
        # would mean "100% hallucinated" passes a ">=0.95" bar. Compare the
        # threshold against avg_score (the real quality signal) instead.
        passed = avg_score >= threshold if threshold is not None else avg_score >= 0.5
        status = evaluation_input.force_status or (
            MetricResultStatus.passed if passed else MetricResultStatus.failed
        )

        probe_log = [
            build_probe_log_entry(
                name=f"{formula}_{index + 1}",
                what_we_asked=sample["question"],
                what_happened=sample["answer"],
                method=_METHOD_BLURB,
                outcome="pass" if passed else "fail",
                why=_ragas_why(formula, sample["score"]),
            )
            for index, sample in enumerate(samples_payload)
        ]

        return MetricEvaluationResult(
            source_type="ragas_rag_probe",
            tool_name="ragas",
            raw_score=raw_score,
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
                # The source documents each answer's claims were checked against —
                # persisted so a reviewer can see WHY a claim was judged (un)supported.
                "context_documents": [c[:800] for c in contexts],
                "samples": samples_payload,
                "probe_log": probe_log,
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
