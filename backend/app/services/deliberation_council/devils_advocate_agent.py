"""Devil's Advocate Agent — Layer 4, second pass.

Reads the Synthesis Agent's memo and raises at least one substantive
objection on every iteration. Forced-dissent is mandatory: if the LLM
returns nothing, the agent retries once, then injects a default objection
so the Verdict Agent always has something to weigh.

Structured output contract (JSON array):
  Each element:
    objection_id    str   — stable slug, e.g. "da-001"
    target_agent    str   — which specialist agent's finding is challenged
                           (null for metric-level objections)
    category        str   — "sample_adequacy" | "conflicting_evidence" |
                           "scope_gap" | "methodology" | "severity_inflation"
    argument        str   — 2-3 sentence objection
    suggested_fix   str   — what remediation would resolve this objection
    remediation_hint str  — one of "re_deliberate" | "re_probe" | "re_plan"
                           router uses this as a tiebreaker when multiple
                           objections suggest different re-entry points
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

from app.configs.prompt_registry import PromptRegistry, render
from app.models.finding import Finding
from app.services.deliberation_council.synthesis_agent import SynthesisMemo
from app.services.model_clients.base import (
    GovernanceModelClient,
    GovernanceModelRequest,
)

logger = logging.getLogger(__name__)

_TEMPLATE_ID = "devils_advocate_agent.council_objection"
# v4: adds a raw-findings section (see _format_findings_detail) so the Devil's
# Advocate can catch Synthesis omitting/mischaracterizing a finding, not just
# critique the narrative prose it was handed — v1-v3 had no path to that.
# v5. Supersedes v4 (53b1bb88…), which instructed the model to fall back to a
# sample-adequacy objection whenever the evidence looked clean, and asserted
# "n < 50 is a regulatory threshold in most frameworks" — a number that appears
# in no framework and in no code. Together those produced the same two
# objections in nearly every run (da-001/sample_adequacy in 60 of 60 audited
# runs) and put fabricated regulatory authority into governance output. v4 is
# left in place unmodified: these templates are content-addressed, so a version
# is immutable once shipped.
_PHASE_HASH = "583363011ba86fa0dc3279f4833e6b8ade1718a2b481e318518d8b376223a7e5"


def _format_findings_detail(findings: list[Finding]) -> str:
    if not findings:
        return "  (none)"
    return "\n".join(
        f"  [finding_id={f.id} | {f.agent_name or 'unknown'} | {f.severity} | {f.dimension}] "
        f"{f.title}: {f.summary}"
        for f in findings
    )

_DEFAULT_OBJECTION = {
    "objection_id": "da-default",
    "target_agent": None,
    "category": "scope_gap",
    "argument": (
        "The governance model failed to produce a structured objection. "
        "As a conservative safety measure, this default objection flags that "
        "the Devil's Advocate could not complete its analysis. "
        "Evidence should be treated as insufficiently scrutinised."
    ),
    "suggested_fix": (
        "Re-deliberate with a fresh synthesis pass to ensure the objection "
        "phase completes successfully."
    ),
    "remediation_hint": "re_deliberate",
}


@dataclass
class Objection:
    objection_id: str
    target_agent: str | None
    category: str
    argument: str
    suggested_fix: str
    remediation_hint: str


def _parse_objections(content: str) -> list[Objection] | None:
    try:
        start = content.find("[")
        end = content.rfind("]") + 1
        if start == -1 or end == 0:
            return None
        items = json.loads(content[start:end])
        if not isinstance(items, list) or len(items) == 0:
            return None
        result = []
        for item in items:
            result.append(
                Objection(
                    objection_id=str(item.get("objection_id", "da-unknown")),
                    target_agent=item.get("target_agent"),
                    category=str(item.get("category", "methodology")),
                    argument=str(item.get("argument", "")),
                    suggested_fix=str(item.get("suggested_fix", "")),
                    remediation_hint=str(item.get("remediation_hint", "re_deliberate")),
                )
            )
        return result or None
    except (json.JSONDecodeError, ValueError, TypeError) as exc:
        logger.warning("DevilsAdvocateAgent: parse error: %s", exc)
        return None


class DevilsAdvocateAgent:
    """Council Devil's Advocate.

    Mandatory dissent on every Council pass. Retries once if the LLM
    returns no valid objections, then falls back to a default objection
    so the Verdict Agent always has something to weigh.
    """

    name = "devils_advocate_agent"

    def __init__(
        self,
        governance_client: GovernanceModelClient,
        registry: PromptRegistry | None = None,
    ) -> None:
        self._governance = governance_client
        self._registry = registry or PromptRegistry.from_directory()

    def _build_prompt(self, memo: SynthesisMemo, findings: list[Finding]) -> str:
        template = self._registry.get(_TEMPLATE_ID, _PHASE_HASH)
        return render(template, {
            "iteration": str(memo.iteration),
            "narrative": memo.narrative,
            "risk_summary": memo.risk_summary,
            "dimensions": ", ".join(memo.dimensions) if memo.dimensions else "(none listed)",
            "sample_sizes": json.dumps(memo.sample_sizes) if memo.sample_sizes else "{}",
            "conflicts": "; ".join(memo.conflicts) if memo.conflicts else "(none detected)",
            "findings_detail": _format_findings_detail(findings),
        })

    def _call_governance(self, memo: SynthesisMemo, findings: list[Finding]) -> str:
        response = self._governance.complete(
            GovernanceModelRequest(
                task="council_devils_advocate",
                prompt=self._build_prompt(memo, findings),
                context={
                    "iteration": memo.iteration,
                    "dimension_count": len(memo.dimensions),
                    "conflict_count": len(memo.conflicts),
                },
            )
        )
        return response.content

    def object_to(self, memo: SynthesisMemo, findings: list[Finding]) -> list[Objection]:
        """Raise objections to the Synthesis memo.

        ``findings`` is the raw evidence this iteration's synthesis was built
        from — passed through (not just the memo) so the Devil's Advocate can
        cross-check the narrative against ground truth and flag an omission,
        not only critique whatever prose Synthesis chose to write.
        """
        try:
            content = self._call_governance(memo, findings)
            objections = _parse_objections(content)
            if objections is not None:
                return objections

            # Retry once with a note that the first attempt failed
            logger.info("DevilsAdvocateAgent: first attempt returned no objections, retrying")
            content = self._call_governance(memo, findings)
            objections = _parse_objections(content)
            if objections is not None:
                return objections
        except Exception as exc:
            logger.error("DevilsAdvocateAgent: governance call failed: %s", exc)

        # Inject mandatory default objection so the Council never runs without dissent
        logger.warning("DevilsAdvocateAgent: injecting default objection after failed attempts")
        return [Objection(**_DEFAULT_OBJECTION)]
