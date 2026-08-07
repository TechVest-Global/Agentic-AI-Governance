"""Shared LangGraph plumbing: runtime context, checkpointing, invoke config.

**Why a runtime context at all.** LangGraph state is checkpointed, so it must be
serializable. But a governance node needs a live ``Session``, the constructed
agent objects, a ThreadPoolExecutor and its in-flight ``Future``s — none of
which can be pickled, and none of which mean anything after a process restart.
LangGraph's supported answer is ``config["configurable"]``: values passed there
reach every node untouched and are never handed to the serializer. That is what
``RuntimeContext`` is, and why the state TypedDicts hold only scalars.

**What the checkpointer is and is not for here.** It records each superstep so
the graph can be streamed and inspected mid-run. It is deliberately NOT the
crash-resume mechanism: this pipeline already resumes durably from the database
(``reconcile_interrupted_runs`` plus ``agent_execution``'s scan for
already-``completed`` AgentExecution rows, which is what stops a resumed run
re-probing a live target). Introducing a second, disagreeing source of truth
about what completed would be a governance defect, not a feature — so the
default saver is in-memory and scoped to one pipeline process.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import InMemorySaver

# Key under which the RuntimeContext travels in config["configurable"].
CONTEXT_KEY = "governance_runtime"


class RuntimeContext:
    """Per-invocation, non-serializable dependencies for a graph's nodes.

    Deliberately a plain mutable object rather than a frozen dataclass: nodes
    accumulate into it (outcomes, futures, the council's latest memo/verdict)
    exactly as the previous straight-line code accumulated into local variables.
    """

    __slots__ = ("_values",)

    def __init__(self, **values: Any) -> None:
        self._values: dict[str, Any] = dict(values)

    def __getattr__(self, name: str) -> Any:
        try:
            return self._values[name]
        except KeyError as exc:  # pragma: no cover - programming error
            raise AttributeError(name) from exc

    def __setattr__(self, name: str, value: Any) -> None:
        if name == "_values":
            object.__setattr__(self, name, value)
        else:
            self._values[name] = value

    def get(self, name: str, default: Any = None) -> Any:
        return self._values.get(name, default)


def context_from(config: dict | None) -> RuntimeContext:
    """Pull the RuntimeContext out of a node's config.

    Raises rather than returning None: a node that reached this without a
    context was invoked wrong, and silently proceeding would write a partial
    audit record.
    """
    configurable = (config or {}).get("configurable") or {}
    context = configurable.get(CONTEXT_KEY)
    if context is None:  # pragma: no cover - programming error
        raise RuntimeError(
            "Graph node invoked without a RuntimeContext; pass one via "
            f"config['configurable']['{CONTEXT_KEY}']."
        )
    return context


def build_checkpointer() -> BaseCheckpointSaver:
    """Checkpointer for a pipeline graph.

    In-memory by design — see this module's docstring. Factored out so a
    deployment that wants durable checkpoints can swap it without touching
    either graph, and so tests can assert on checkpoint contents.
    """
    return InMemorySaver()


def invoke_config(
    *,
    run_id: UUID,
    context: RuntimeContext,
    thread_suffix: str,
    recursion_limit: int,
    max_concurrency: int | None = None,
) -> dict[str, Any]:
    """Build the config for one graph invocation.

    ``thread_id`` is the run id plus a per-graph suffix, so Layer 3's and Layer
    4's checkpoints for the same run stay in separate threads instead of
    overwriting each other.

    ``max_concurrency`` must be at least the width of the widest parallel
    superstep. The specialist fan-out relies on this: its evaluator nodes each
    block on their own agent's future against a shared deadline, so a node that
    LangGraph queued behind another would burn its budget waiting to start and
    report a timeout it never actually hit.
    """
    config: dict[str, Any] = {
        "configurable": {
            CONTEXT_KEY: context,
            "thread_id": f"{run_id}:{thread_suffix}",
        },
        "recursion_limit": recursion_limit,
    }
    if max_concurrency is not None:
        config["max_concurrency"] = max_concurrency
    return config
