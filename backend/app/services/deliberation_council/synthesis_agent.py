"""Synthesis Agent — Layer 4, first pass.

Reads all specialist findings and metric results for the run and produces
a unified narrative memo. The memo is passed verbatim to the Devil's
Advocate; the Verdict Agent reads it directly (not through the objections).

Structured output contract (JSON):
  narrative     str   — 3-5 sentence unified finding summary
  risk_summary  str   — 1-2 sentence headline of the dominant risk signal
  dimensions    list  — risk dimensions covered, e.g. ["fairness", "robustness"]
  sample_sizes  dict  — {agent_name: probe_count} for adequacy cross-check.
                        Always overwritten with real AgentExecution probe-count
                        telemetry after parsing — never the LLM's own guess.
  conflicts     list  — detected cross-finding conflicts, empty if none
  claims        list  — provenance edges: each claim cites the finding_ids it
                        rests on and HOW it uses each (see Claim/Citation)
  unused_findings list — findings the synthesis deliberately did not use, with
                        a reason, so "ignored" is a recorded decision rather
                        than an absence
  iteration     int   — which remediation pass produced this memo

Provenance (v5 template onward)
-------------------------------
The memo used to be prose only: a reader could not tell which specialist
findings it actually rested on, nor in what way. ``claims`` makes that
machine-checkable — every claim names the findings behind it and labels each
citation as primary evidence, corroboration, or a compounding factor.

Every citation is verified against the run's real findings after parsing (see
``_validate_provenance``); ids the model invented are dropped rather than
displayed. What survives is summarised in ``ProvenanceCoverage``, which is
deliberately reported even when incomplete — a provenance view that silently
omits what the model failed to cite looks rigorous while being less honest
than the prose it replaced.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field

from app.configs.prompt_registry import PromptRegistry, render
from app.models.enums import Severity
from app.models.evidence import MetricResult
from app.models.finding import Finding
from app.services.model_clients.base import (
    GovernanceModelClient,
    GovernanceModelRequest,
)
from app.services.model_clients.mock import is_mock_governance_client

logger = logging.getLogger(__name__)

_TEMPLATE_ID = "synthesis_agent.council_memo"
# v5 (52c26971…) added the claims/unused_findings provenance contract to v4
# (2cbc634e…), which produced narrative prose with no way back to the evidence.
#
# v6 fixes a latent defect v5 inherited from v4. Both told the model to copy the
# ACTUAL PROBE COUNTS block "verbatim" into sample_sizes. When a run has no probe
# telemetry that block is prose, not data, and the model copied the prose inside
# the JSON object — `"sample_sizes": { "(no probe telemetry...)" }` — which is
# invalid JSON and cost the entire memo. Harmless while the memo was prose;
# fatal once the memo carries the provenance, and especially wasteful because
# sample_sizes is overwritten with real telemetry immediately after parsing, so
# the run lost everything over a field whose value is discarded.
#
# Earlier versions stay in place unmodified: templates are content-addressed, so
# a shipped version is immutable and older runs keep resolving the one they used.
_PHASE_HASH = "d400a8af1ed2adc983b924a325f88e23e90b7c52a1a19441f26be345ba3bca97"

# How a claim uses a finding.
#   primary_evidence   — the claim mainly rests on it
#   corroboration      — independently supports a claim that already has primary evidence
#   compounding_factor — makes the claim more serious in combination, but would
#                        not establish it alone
_ALLOWED_ROLES = frozenset({"primary_evidence", "corroboration", "compounding_factor"})

_ALLOWED_UNUSED_REASONS = frozenset(
    {"duplicate", "superseded", "out_of_scope", "not_material", "insufficient_detail"}
)

_SEVERITY_WEIGHT = {
    Severity.info: 1,
    Severity.low: 2,
    Severity.medium: 3,
    Severity.high: 4,
    Severity.critical: 5,
}


@dataclass
class Citation:
    """One provenance edge: a claim rests on this finding, in this way."""

    finding_id: str
    role: str


@dataclass
class Claim:
    """One assertion the synthesis makes, with the evidence behind it."""

    claim_id: str
    statement: str
    citations: list[Citation] = field(default_factory=list)


@dataclass
class UnusedFinding:
    """A finding the synthesis saw and deliberately did not build on."""

    finding_id: str
    reason: str


@dataclass
class ProvenanceCoverage:
    """How much of the run's evidence the synthesis actually accounted for.

    Reported whether or not it is complete. The model is not reliable at
    citing every finding, so the honest number has to be visible: a panel
    showing four tidy claims while eleven findings went unmentioned is worse
    than prose, because it looks like an audit trail.
    """

    total_findings: int
    cited: int
    declared_unused: int
    unaccounted: list[str] = field(default_factory=list)
    invalid_citations: list[str] = field(default_factory=list)

    @property
    def accounted(self) -> int:
        return self.cited + self.declared_unused

    @property
    def is_complete(self) -> bool:
        return not self.unaccounted and self.accounted == self.total_findings


@dataclass
class SynthesisMemo:
    narrative: str
    risk_summary: str
    dimensions: list[str]
    sample_sizes: dict[str, int]
    conflicts: list[str]
    iteration: int
    raw_response: str
    claims: list[Claim] = field(default_factory=list)
    unused_findings: list[UnusedFinding] = field(default_factory=list)
    coverage: ProvenanceCoverage | None = None


def _format_findings(findings: list[Finding], iteration: int) -> str:
    if not findings:
        return "  (none)"
    # For re-probe iterations, the caller passes only the latest-per-agent findings.
    # finding_id/evidence_ids are included so downstream reasoning (the Devil's
    # Advocate, the Verdict's objections_addressed) can cite a specific,
    # queryable record instead of only this prose summary — without them, a
    # verdict was traceable to narrative but not to evidence.
    lines = []
    for f in findings:
        lines.append(
            f"  [finding_id={f.id} | {f.agent_name or 'unknown'} | {f.severity} | "
            f"{f.dimension}] {f.title}: {f.summary}"
        )
        if f.recommended_action:
            lines.append(f"    → Recommended action: {f.recommended_action}")
        if f.evidence_ids:
            lines.append(f"    → Evidence: {', '.join(f.evidence_ids)}")
    return "\n".join(lines)


def _format_probe_counts(counts: dict[str, int]) -> str:
    if not counts:
        return "  (no probe telemetry available for this run)"
    return "\n".join(f"  {name}: {count}" for name, count in sorted(counts.items()))


def _format_metrics(metrics: list[MetricResult]) -> str:
    if not metrics:
        return "  (none)"
    lines = []
    for m in metrics:
        status_str = f"status={m.status}"
        score_str = (
            f"score={m.normalized_score:.3f}"
            if m.normalized_score is not None
            else "score=N/A"
        )
        passed_str = f"passed={m.passed}"
        lines.append(f"  [{m.metric_id} | {m.dimension}] {status_str}, {score_str}, {passed_str}")
    return "\n".join(lines)


def _parse_sample_sizes(raw: object) -> dict[str, int]:
    """Read sample_sizes without letting a bad value cost us the memo.

    Whatever the model returns here is overwritten with real AgentExecution
    telemetry immediately after parsing (see synthesize), so this value is
    discarded either way. It has no business raising — which it previously
    could, taking the claims and coverage down with it over a field nobody
    reads. See the v6 note on _PHASE_HASH for how that actually bit.
    """
    if not isinstance(raw, dict):
        return {}
    counts: dict[str, int] = {}
    for name, value in raw.items():
        try:
            counts[str(name)] = int(value)
        except (TypeError, ValueError):
            continue
    return counts


def _parse_claims(raw: object) -> list[Claim]:
    """Read the claims array, skipping anything structurally unusable.

    Tolerant on purpose: a malformed claim must not cost us the whole memo,
    which is why each element is guarded individually rather than the list
    being parsed as a unit. Semantic checks (does this finding_id exist?)
    belong to _validate_provenance, not here.
    """
    if not isinstance(raw, list):
        return []
    claims: list[Claim] = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            continue
        statement = str(item.get("statement", "")).strip()
        if not statement:
            continue
        citations: list[Citation] = []
        for cite in item.get("citations", []) or []:
            if not isinstance(cite, dict):
                continue
            finding_id = str(cite.get("finding_id", "")).strip()
            if not finding_id:
                continue
            citations.append(
                Citation(finding_id=finding_id, role=str(cite.get("role", "")).strip())
            )
        claims.append(
            Claim(
                claim_id=str(item.get("claim_id") or f"c{index + 1}"),
                statement=statement,
                citations=citations,
            )
        )
    return claims


def _parse_unused(raw: object) -> list[UnusedFinding]:
    if not isinstance(raw, list):
        return []
    unused: list[UnusedFinding] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        finding_id = str(item.get("finding_id", "")).strip()
        if not finding_id:
            continue
        reason = str(item.get("reason", "")).strip()
        # An unrecognised reason still counts as accounting for the finding —
        # the point of this list is that the synthesis SAW it and chose to pass
        # over it. Normalising rather than dropping keeps the count honest.
        if reason not in _ALLOWED_UNUSED_REASONS:
            reason = "unspecified"
        unused.append(UnusedFinding(finding_id=finding_id, reason=reason))
    return unused


def _try_parse_memo(content: str, iteration: int) -> SynthesisMemo | None:
    """Parse the memo, or return None if the response was not usable JSON.

    Split out from ``_parse_memo`` so the caller can tell "the model returned
    something unparseable" from "the model returned a degraded memo" and retry
    the former. The v5 contract asks for a much longer nested object than v4
    did, and a longer object is a likelier one to come back malformed.
    """
    try:
        start = content.find("{")
        end = content.rfind("}") + 1
        if start == -1 or end == 0:
            raise ValueError("No JSON object found")
        data = json.loads(content[start:end])
        return SynthesisMemo(
            narrative=str(data.get("narrative", "Evidence synthesis not available.")),
            risk_summary=str(data.get("risk_summary", "Risk level indeterminate.")),
            dimensions=list(data.get("dimensions", [])),
            sample_sizes=_parse_sample_sizes(data.get("sample_sizes")),
            conflicts=list(data.get("conflicts", [])),
            iteration=int(data.get("iteration", iteration)),
            raw_response=content,
            claims=_parse_claims(data.get("claims")),
            unused_findings=_parse_unused(data.get("unused_findings")),
        )
    except (json.JSONDecodeError, ValueError, TypeError) as exc:
        logger.warning("SynthesisAgent: could not parse governance response: %s", exc)
        return None


def _parse_memo(content: str, iteration: int) -> SynthesisMemo:
    """Parse the memo, degrading to a fallback rather than raising."""
    return _try_parse_memo(content, iteration) or _fallback_memo(iteration, content)


def _validate_provenance(memo: SynthesisMemo, findings: list[Finding]) -> SynthesisMemo:
    """Verify every provenance edge against the run's real findings.

    Same job, and the same conservative posture, as ``_validated`` in
    verdict_agent: LLM-supplied references are free text with no guarantee
    they name anything real. An id the model invented is dropped rather than
    rendered — a fabricated citation in a governance record is worse than a
    missing one, because it survives review looking like evidence.

    Mutates and returns ``memo`` so the caller keeps one object; the discarded
    edges are not lost but summarised in ``memo.coverage``.
    """
    known_ids = {str(f.id) for f in findings}
    invalid: list[str] = []

    for claim in memo.claims:
        kept: list[Citation] = []
        for cite in claim.citations:
            if cite.finding_id not in known_ids:
                invalid.append(f"{cite.finding_id} (no such finding)")
                continue
            if cite.role not in _ALLOWED_ROLES:
                # The id is real but the stated relationship is not one we
                # define. Coercing it would invent a meaning the model did not
                # express, so the edge goes and the finding falls through to
                # `unaccounted`, where it is visible instead of silently wrong.
                invalid.append(f"{cite.finding_id} (unknown role {cite.role!r})")
                continue
            kept.append(cite)
        claim.citations = kept

    memo.unused_findings = [u for u in memo.unused_findings if u.finding_id in known_ids]

    cited_ids = {c.finding_id for claim in memo.claims for c in claim.citations}
    unused_ids = {u.finding_id for u in memo.unused_findings}
    memo.coverage = ProvenanceCoverage(
        total_findings=len(known_ids),
        cited=len(cited_ids),
        declared_unused=len(unused_ids - cited_ids),
        unaccounted=sorted(known_ids - cited_ids - unused_ids),
        invalid_citations=invalid,
    )

    if invalid:
        logger.warning(
            "SynthesisAgent: dropped %d unverifiable citation(s): %s",
            len(invalid),
            invalid,
        )
    if memo.coverage.unaccounted:
        logger.info(
            "SynthesisAgent: %d of %d findings neither cited nor declared unused",
            len(memo.coverage.unaccounted),
            memo.coverage.total_findings,
        )
    return memo


def _fallback_memo(iteration: int, raw: str) -> SynthesisMemo:
    return SynthesisMemo(
        narrative=(
            "Governance model returned a non-structured response. "
            "Evidence review was attempted but structured synthesis is unavailable. "
            "Manual review recommended."
        ),
        risk_summary="Risk level indeterminate — governance model response unparseable.",
        dimensions=[],
        sample_sizes={},
        conflicts=["Synthesis agent returned non-JSON; evidence may be incomplete."],
        iteration=iteration,
        raw_response=raw,
    )


class SynthesisAgent:
    """Council Synthesis Agent.

    Accepts the latest-iteration findings (caller must apply
    'latest per agent' read rule) and all metric results, then
    produces a SynthesisMemo via the governance LLM.
    Falls back to a DEGRADED memo if the LLM fails completely.
    """

    name = "synthesis_agent"

    def __init__(
        self,
        governance_client: GovernanceModelClient,
        registry: PromptRegistry | None = None,
    ) -> None:
        self._governance = governance_client
        self._registry = registry or PromptRegistry.from_directory()

    def synthesize(
        self,
        *,
        findings: list[Finding],
        metric_results: list[MetricResult],
        iteration: int,
        real_probe_counts: dict[str, int] | None = None,
    ) -> SynthesisMemo:
        """Produce a SynthesisMemo.

        ``real_probe_counts`` (agent_name -> total probes actually sent this
        run, from AgentExecution.metadata_json) is measured system telemetry,
        not something the LLM can derive from finding text alone — one agent
        typically writes exactly one finding regardless of how many probes it
        sent, so asking the LLM to infer "sample size" from findings produces
        a fabricated number (usually 1), not the real count. It's fed into
        the prompt so the LLM's narrative reasons about the real figures, and
        the returned memo's sample_sizes is always overwritten with this
        ground truth afterward — never trusting the LLM to copy it correctly.
        """
        real_probe_counts = real_probe_counts or {}
        findings_text = _format_findings(findings, iteration)
        metrics_text = _format_metrics(metric_results)
        probe_counts_text = _format_probe_counts(real_probe_counts)

        template = self._registry.get(_TEMPLATE_ID, _PHASE_HASH)
        prompt = render(template, {
            "iteration": str(iteration),
            "findings_text": findings_text,
            "metrics_text": metrics_text,
            "real_probe_counts": probe_counts_text,
        })

        request = GovernanceModelRequest(
            task="council_synthesis",
            prompt=prompt,
            context={
                "iteration": iteration,
                "finding_count": len(findings),
                "metric_count": len(metric_results),
                "agents": list({f.agent_name for f in findings if f.agent_name}),
            },
        )

        memo: SynthesisMemo | None = None
        try:
            # Retry once on an unparseable response, matching the Devil's
            # Advocate. Synthesis had no retry at all, which mattered little
            # when the memo was a handful of prose fields; under the v5 claims
            # contract one malformed response costs the whole run its
            # provenance, and the failure is intermittent rather than
            # systematic — observed parsing cleanly and failing on the same
            # 34-finding input.
            response = self._governance.complete(request)
            memo = _try_parse_memo(response.content, iteration)
            if memo is None and not is_mock_governance_client(self._governance):
                # Not retried against a mock: it returns the same canned
                # response every time, so a second call cannot parse where the
                # first did not — it would only double the council's call count
                # on every mock-mode iteration.
                logger.info("SynthesisAgent: response was not parseable, retrying once")
                response = self._governance.complete(request)
                memo = _try_parse_memo(response.content, iteration)
            if memo is None:
                memo = _fallback_memo(iteration, response.content)
        except Exception as exc:
            logger.error("SynthesisAgent: governance call failed: %s", exc)
            memo = _fallback_memo(iteration, str(exc))

        if real_probe_counts:
            memo.sample_sizes = dict(real_probe_counts)
        # Always run, including on the fallback memo: a degraded synthesis still
        # needs a coverage record, otherwise "no claims" and "claims not checked"
        # are indistinguishable downstream.
        return _validate_provenance(memo, findings)
