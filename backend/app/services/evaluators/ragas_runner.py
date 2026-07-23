"""Standalone ragas scoring runner.

Runs INSIDE the isolated ``.venv-ragas`` interpreter (Python 3.11-3.13), NOT
the main backend venv: ragas's scoring relies on nest_asyncio, which does not
support Python 3.14's stricter asyncio.timeouts semantics. This script is
executed as a subprocess by ``ragas_evaluator.py``; it must depend only on the
standard library, ``ragas``, and ``langchain_openai`` (never on ``app.*``).

Protocol — one JSON object on stdin, one JSON object on stdout:

    in:  {"judge": {"endpoint": str, "api_key": str, "deployment": str, "api_version": str},
          "metric_class_name": str,
          "samples": [{"question": str, "answer": str, "contexts": [str, ...],
                       "reference": str}, ...]}
    out: {"scores": [float, ...], "error": str|null}

The parent process fetches retrieval context, invokes the audited target, and
interprets the returned scores (inversion, threshold, probe-log framing) —
this runner only does the ragas scoring itself, the piece Python 3.14 can't run.
"""

import json
import sys


def _run(job: dict) -> dict:
    from langchain_openai import AzureChatOpenAI
    from ragas import SingleTurnSample
    from ragas.llms import LangchainLLMWrapper
    import ragas.metrics as ragas_metrics

    judge = job.get("judge") or {}
    chat = AzureChatOpenAI(
        azure_endpoint=judge["endpoint"],
        api_key=judge["api_key"],
        deployment_name=judge["deployment"],
        openai_api_version=judge["api_version"],
        timeout=60,
        max_retries=1,
    )
    llm = LangchainLLMWrapper(chat)

    metric_cls = getattr(ragas_metrics, job["metric_class_name"])
    ragas_metric = metric_cls(llm=llm)

    scores = []
    for sample in job.get("samples", []):
        single_turn = SingleTurnSample(
            user_input=sample["question"],
            response=sample["answer"],
            retrieved_contexts=sample["contexts"],
            reference=sample["reference"],
        )
        scores.append(float(ragas_metric.single_turn_score(single_turn)))
    return {"scores": scores, "error": None}


def main():
    try:
        job = json.load(sys.stdin)
    except Exception as exc:  # noqa: BLE001
        json.dump({"scores": [], "error": f"invalid job json: {exc}"}, sys.stdout)
        return
    try:
        result = _run(job)
    except Exception as exc:  # noqa: BLE001
        json.dump({"scores": [], "error": f"ragas run failed: {exc}"}, sys.stdout)
        return
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
