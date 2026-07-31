# Agent Service Boundary

This package contains the specialist-agent integration point for the governance
backend.

## Stable Contract

Every agent should implement the `GovernanceAgent` protocol from `base.py`:

```python
def evaluate(self, context: AgentContext) -> list[FindingCreate]:
    ...
```

The backend runner in `../agent_execution.py` is responsible for:

- loading the evaluation run context,
- creating `AgentExecution` records,
- calling each registered agent,
- storing returned findings,
- recording failed agent attempts,
- updating the run summary.

Agent implementations should return structured `FindingCreate` objects and
should not create database rows directly.

## Current Agents

`model_backed/` contains the seven real specialist agents (quality, bias,
misuse, drift, compliance mapper, risk scorer, explainability), each probing
the audited system and reasoning over evidence with the governance LLM. Each
agent falls back to a small built-in deterministic check (see
`_deterministic_fallback` in each module) when the governance model is
unavailable or returns non-JSON — there is no separate placeholder-agent
package anymore.

When adding or replacing an agent, update `registry.py` so the runner selects
the desired implementation while the API, database, findings, verdicts, and
reports stay consistent.
