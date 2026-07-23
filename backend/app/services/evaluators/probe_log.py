"""Plain-English probe log — a model/system-agnostic contract every evaluator
writes into ``EvidenceRecord.payload["probe_log"]``.

Auditors using this platform are not expected to know what "hallucination
rate" or "GEval" mean. Each evaluator already sends real probes to the
audited system and already knows, in its own vocabulary, what it asked, what
came back, and why it judged the result the way it did — this module gives
that a single plain-English shape so the frontend can render "what was
tested / how it was judged / why this result" identically regardless of
which tool (presidio, deepeval, garak, ...) or which audited system produced
it.

Additive only: evaluators keep writing their existing tool-specific payload
keys (``probes``, ``samples``, ``attempts``, ...) as before. ``probe_log`` is
a new key alongside them, so no schema/API/migration change is needed —
``EvidenceRecord.payload`` is already a free-form JSON column that already
flows to the frontend unchanged.
"""

from __future__ import annotations

from typing import Literal, TypedDict

ProbeOutcome = Literal["pass", "fail", "flag"]

_MAX_FIELD_CHARS = 600


class ProbeLogEntry(TypedDict):
    name: str
    what_we_asked: str
    what_happened: str
    method: str
    outcome: ProbeOutcome
    why: str


def _truncate(text: str, *, limit: int = _MAX_FIELD_CHARS) -> str:
    text = text.strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def build_probe_log_entry(
    *,
    name: str,
    what_we_asked: str,
    what_happened: str,
    method: str,
    outcome: ProbeOutcome,
    why: str,
) -> ProbeLogEntry:
    """Build one probe-log entry with consistent truncation/whitespace handling.

    Every field is plain English, safe to render directly to a non-technical
    auditor — callers are responsible for not passing raw secrets through
    ``what_happened``/``why`` (see each evaluator's own redaction handling).
    """
    return ProbeLogEntry(
        name=name,
        what_we_asked=_truncate(what_we_asked),
        what_happened=_truncate(what_happened),
        method=method.strip(),
        outcome=outcome,
        why=_truncate(why),
    )
