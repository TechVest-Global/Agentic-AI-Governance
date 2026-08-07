"""Drive a governance graph by streaming it, rather than blocking on invoke().

``graph.invoke(...)`` returns only when the whole graph is done. For Layer 3
that is the slowest phase of an audit (real probes against a live target) and
for Layer 4 it can be three full council passes — so a caller that invokes gets
one result after several minutes of silence.

``run_graph`` runs the same graph to the same final state, but consumes it as a
stream and hands each node's completion to a listener as it happens. The
returned value is identical to what ``invoke`` would have returned; nothing
about the pipeline's results depends on which one is used.

Note what this does and does not change about the HTTP surface. The SSE
endpoint (``/runs/{id}/progress``) still reports from committed database state,
unchanged — it must, because a client may connect midway through a phase or
after a reconnect and has to see the real durable record, not a replay of
in-process events. This stream is the *in-process* progress signal: it is what
lets the phase log a node's completion at the moment it happens, and it is the
hook a future push-based transport would attach to.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

logger = logging.getLogger(__name__)

# node_name -> that node's state update
UpdateListener = Callable[[str, dict], None]


def run_graph(
    graph,
    initial_state: dict,
    config: dict,
    *,
    on_update: UpdateListener | None = None,
    label: str = "graph",
) -> dict:
    """Run ``graph`` to completion, streaming node updates, and return final state.

    Equivalent to ``graph.invoke(initial_state, config)`` in both effect and
    return value — LangGraph executes the same supersteps either way. Streaming
    only changes when the caller learns about them.

    A listener that raises must not take the run down with it: progress
    reporting is observability, and losing it is never worth abandoning a phase
    that has already made real calls against an audited system.
    """
    final_state: dict[str, Any] = dict(initial_state)
    for mode, chunk in graph.stream(
        initial_state, config, stream_mode=["updates", "values"]
    ):
        if mode == "values":
            # The merged state after that superstep. Kept so the last one is the
            # graph's final state, which is what invoke() would have returned.
            final_state = chunk
            continue
        for node_name, update in (chunk or {}).items():
            logger.debug("%s: node %s completed", label, node_name)
            if on_update is None:
                continue
            try:
                on_update(node_name, update or {})
            except Exception:  # noqa: BLE001 - see docstring
                logger.exception(
                    "%s: progress listener failed for node %s", label, node_name
                )
    return final_state
