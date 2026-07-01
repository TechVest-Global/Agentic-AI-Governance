"""Deterministic production-log analyzer (Layer 1, task P011).

Converts a list of structured log records into stable coverage aggregates. The
same input always produces the same output: every count map is key-sorted and no
wall-clock or randomness is involved, which lets the output be hash-chained into
GovernanceState and reproduced on demand.
"""

from collections import Counter

from app.schemas.governance import ContextLogEntry, LogAnalysisSummary


def _sorted_counts(counter: Counter[str]) -> dict[str, int]:
    return {key: counter[key] for key in sorted(counter)}


def analyze_logs(entries: list[ContextLogEntry]) -> LogAnalysisSummary:
    category_counts: Counter[str] = Counter()
    demographic_counts: Counter[str] = Counter()
    jurisdiction_counts: Counter[str] = Counter()
    outcome_counts: Counter[str] = Counter()
    modality_counts: Counter[str] = Counter()
    pii_count = 0
    flagged_count = 0

    for entry in entries:
        category_counts[entry.request_category] += 1
        modality_counts[entry.modality] += 1
        if entry.demographic_group:
            demographic_counts[entry.demographic_group] += 1
        if entry.jurisdiction:
            jurisdiction_counts[entry.jurisdiction] += 1
        if entry.outcome:
            outcome_counts[entry.outcome] += 1
        if entry.contains_pii:
            pii_count += 1
        if entry.flagged:
            flagged_count += 1

    return LogAnalysisSummary(
        total_requests=len(entries),
        empty=len(entries) == 0,
        request_category_counts=_sorted_counts(category_counts),
        demographic_coverage=_sorted_counts(demographic_counts),
        jurisdiction_coverage=_sorted_counts(jurisdiction_counts),
        outcome_counts=_sorted_counts(outcome_counts),
        modality_counts=_sorted_counts(modality_counts),
        pii_request_count=pii_count,
        flagged_request_count=flagged_count,
        distinct_request_categories=len(category_counts),
        distinct_demographic_groups=len(demographic_counts),
        distinct_jurisdictions=len(jurisdiction_counts),
        distinct_outcomes=len(outcome_counts),
        observed_request_categories=sorted(category_counts),
        observed_demographic_groups=sorted(demographic_counts),
        observed_jurisdictions=sorted(jurisdiction_counts),
        observed_outcomes=sorted(outcome_counts),
    )
