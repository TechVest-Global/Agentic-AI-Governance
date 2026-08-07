"""LangGraph topologies for the governance pipeline's agentic layers.

Layer 3 (specialist agent fan-out) and Layer 4 (deliberation council loop) are
expressed as ``StateGraph``s here. Both modules own *topology only* — every node
body delegates to the pre-existing service functions, which are unchanged. The
externally observable behaviour of the pipeline (API responses, DB writes,
ledger events, run status transitions) is identical either way; what changed is
that the control flow is now declared as a graph instead of implied by a
ThreadPoolExecutor block and a ``while True``.

See ``runtime.py`` for why live objects travel on a RuntimeContext rather than
in graph state, and what the checkpointer is (and is not) responsible for.
"""

from app.services.graphs.council_graph import build_council_graph
from app.services.graphs.runtime import (
    RuntimeContext,
    build_checkpointer,
    context_from,
    invoke_config,
)
from app.services.graphs.specialist_graph import build_specialist_graph
from app.services.graphs.state import CouncilState, SpecialistState
from app.services.graphs.streaming import run_graph

__all__ = [
    "CouncilState",
    "RuntimeContext",
    "SpecialistState",
    "build_checkpointer",
    "build_council_graph",
    "build_specialist_graph",
    "context_from",
    "invoke_config",
    "run_graph",
]
