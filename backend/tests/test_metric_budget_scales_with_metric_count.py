"""The metric-execution budget must scale with how much was asked for.

It was one flat 600s for every run. Measured against the live TechVest chatbot:
~6s per model call and 2-4 calls per metric, so a full 42-metric catalog audit
needs ~880s. It got 600s, and the ~14 metrics that never got their turn were
recorded as "evaluation exceeded the metric-execution time budget" — a clock
expiring, presented in the report as though the tools had failed. A 7-metric
smoke run, meanwhile, had 600s for ~45s of work.

The configured value is now a FLOOR, with a per-metric allowance on top.
"""

import pytest
from app.core.config import get_settings
from app.services.concurrency_settings import metric_execution_budget_for


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_a_small_run_keeps_the_configured_floor() -> None:
    # 7 metrics x 25s = 175s, well under the 600s floor.
    assert metric_execution_budget_for(7) == 600.0


def test_a_full_catalog_run_gets_room_proportional_to_the_work() -> None:
    budget = metric_execution_budget_for(42)

    assert budget == pytest.approx(1050.0)
    # The number that matters: it must clear the ~880s a live 42-metric run cost.
    assert budget > 880, f"42 metrics still cannot finish inside {budget}s"


def test_the_floor_and_the_per_metric_rate_are_both_configurable(monkeypatch) -> None:
    monkeypatch.setenv("METRIC_EXECUTION_BUDGET_SECONDS", "120")
    monkeypatch.setenv("METRIC_EXECUTION_SECONDS_PER_METRIC", "10")
    get_settings.cache_clear()

    assert metric_execution_budget_for(5) == 120.0  # floor wins
    assert metric_execution_budget_for(30) == 300.0  # rate wins


def test_zeroing_the_rate_restores_a_flat_budget(monkeypatch) -> None:
    """An operator who wants the old behaviour must be able to have it."""
    monkeypatch.setenv("METRIC_EXECUTION_SECONDS_PER_METRIC", "0")
    get_settings.cache_clear()

    assert metric_execution_budget_for(42) == metric_execution_budget_for(1)


def test_no_metrics_does_not_produce_a_negative_budget() -> None:
    assert metric_execution_budget_for(0) == 600.0
    assert metric_execution_budget_for(-3) == 600.0
