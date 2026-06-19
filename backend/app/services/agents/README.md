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

`deterministic/` contains rule-based placeholder agents. They keep the backend
pipeline runnable while model-backed or tool-backed agents are designed.

## Future Agents

Real agents can be added behind the same contract, for example:

```text
agents/
  model_backed/
    compliance_agent.py
    explainability_agent.py
  deterministic/
    compliance_agent.py
```

When replacing an agent, update `registry.py` so the runner selects the desired
implementation while the API, database, findings, verdicts, and reports stay
consistent.
