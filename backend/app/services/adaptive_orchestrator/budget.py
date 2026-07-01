"""Deterministic probe-budget allocation.

Allocates a fixed total budget across activated agents proportional to their
weight, guaranteeing the allocations sum to exactly ``total`` (spec invariant:
the probe budget validates to 100). Each activated agent receives at least one
probe; the remainder is distributed by the largest-remainder method with a stable
alphabetical tie-break so the result is fully reproducible.
"""

from collections.abc import Mapping


def allocate_probe_budget(weights: Mapping[str, float], *, total: int) -> dict[str, int]:
    names = sorted(weights)
    if not names:
        return {}

    # More agents than budget units: give the highest-weighted agents one each.
    if len(names) >= total:
        ranked = sorted(names, key=lambda name: (-weights[name], name))
        return {name: (1 if index < total else 0) for index, name in enumerate(ranked)}

    base = {name: 1 for name in names}
    remaining = total - len(names)

    positive = {name: weights[name] for name in names if weights[name] > 0}
    weight_sum = sum(positive.values())
    if weight_sum <= 0:
        # No signal to differentiate agents: distribute the remainder evenly,
        # then hand any leftover units to the alphabetically-first agents.
        even, leftover = divmod(remaining, len(names))
        for name in names:
            base[name] += even
        for name in names[:leftover]:
            base[name] += 1
        return base

    raw = {name: remaining * positive.get(name, 0.0) / weight_sum for name in names}
    floors = {name: int(raw[name]) for name in names}
    for name in names:
        base[name] += floors[name]

    leftover = remaining - sum(floors.values())
    order = sorted(names, key=lambda name: (-(raw[name] - floors[name]), name))
    for name in order[:leftover]:
        base[name] += 1
    return base
