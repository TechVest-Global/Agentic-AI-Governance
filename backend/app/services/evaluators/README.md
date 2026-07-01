# Metric Evaluator Boundary

This package contains metric evaluator adapters for the governance backend.

## Stable Contract

Metric execution should call an adapter through `MetricEvaluator` from
`base.py`.

Evaluator adapters receive one planned metric plus execution options and return
normalized evidence/result data. The storage service remains responsible for
creating `EvidenceRecord` and `MetricResult` rows.

## Current Evaluator

`mock.py` is the local deterministic evaluator used for tests, demos, and
frontend/backend integration before real tools are connected.

## Future Evaluators

Real adapters can be added here without changing API/database contracts, for
example:

```text
evaluators/
  promptfoo.py
  deepeval.py
  ragas.py
  garak.py
  presidio.py
  evidently.py
  azure_foundry.py
```

Register a new adapter in `registry.py`, then call it by passing
`evaluator_name` to the metric execution request.
