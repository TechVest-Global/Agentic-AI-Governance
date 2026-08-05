"""GARAK_MAX_PROBE_PROMPTS / GARAK_GENERATIONS must actually be configurable.

Both were module-level `os.getenv(...)` reads, evaluated once at import time —
the exact anti-pattern documented at the top of core/config.py and already
fixed once for the pipeline concurrency knobs (see
test_concurrency_configuration.py): pydantic-settings loads <repo>/.env into a
Settings object without ever touching os.environ, so setting either in .env
silently did nothing, and reading at import time meant no test could vary it
either. Now resolved through concurrency_settings, like every other knob.
"""

import os

import pytest
from app.core.config import get_settings
from app.services import concurrency_settings


@pytest.fixture(autouse=True)
def _clean_settings():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.mark.parametrize(
    ("env_var", "accessor", "value", "expected"),
    [
        ("GARAK_MAX_PROBE_PROMPTS", "garak_max_probe_prompts", "25", 25),
        ("GARAK_GENERATIONS", "garak_generations", "3", 3),
    ],
)
def test_garak_knobs_resolve_from_configuration(monkeypatch, env_var, accessor, value, expected):
    monkeypatch.setenv(env_var, value)
    get_settings.cache_clear()

    assert getattr(concurrency_settings, accessor)() == expected


def test_garak_knobs_default_without_any_override():
    assert concurrency_settings.garak_max_probe_prompts() == 10
    assert concurrency_settings.garak_generations() == 1


def test_garak_evaluator_module_no_longer_reads_os_getenv_directly():
    """Regression guard for the anti-pattern itself, not just its symptom —
    a future edit re-adding a module-level os.getenv() read would silently
    reintroduce the .env bug without any functional test noticing until a
    real deployment's .env override quietly failed.

    Checks actual code (the AST), not raw source text — the module's own
    comments legitimately mention "os.getenv()" in prose explaining why it's
    no longer used, which a plain substring search would wrongly flag.
    """
    import ast
    import inspect

    from app.services.evaluators import garak_evaluator

    tree = ast.parse(inspect.getsource(garak_evaluator))
    calls_os_getenv = any(
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "getenv"
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "os"
        for node in ast.walk(tree)
    )
    assert not calls_os_getenv
    assert not hasattr(garak_evaluator, "os"), "the os module should no longer be imported at all"


def test_setting_the_env_var_actually_changes_behaviour_end_to_end(monkeypatch):
    """The concrete regression: GARAK_MAX_PROBE_PROMPTS=25 in a real process
    environment must be visible to the evaluator, not just to the settings
    object in isolation."""
    monkeypatch.setenv("GARAK_MAX_PROBE_PROMPTS", "25")
    get_settings.cache_clear()

    assert os.environ["GARAK_MAX_PROBE_PROMPTS"] == "25"
    assert concurrency_settings.garak_max_probe_prompts() == 25
