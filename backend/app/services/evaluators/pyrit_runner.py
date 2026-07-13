"""Standalone PyRIT attack-generation runner.

Runs INSIDE the isolated ``.venv-pyrit`` interpreter, NOT the main backend venv:
PyRIT pins ``openai>=2.2`` while the backend pins ``openai<2.0`` (required by the
ragas/garak stack), so the two cannot share an environment. This script is
executed as a subprocess by ``pyrit_evaluator.py``; it must depend only on the
standard library and ``pyrit`` (never on ``app.*``).

Protocol — one JSON object on stdin, one JSON object on stdout:

    in:  {"base_prompts": [str, ...], "converters": [str, ...]}
    out: {"pyrit_version": str,
          "variants": [{"base": str, "converter": str, "prompt": str|null,
                        "error": str|null}, ...]}

Each base adversarial prompt is transformed by PyRIT's prompt-converter library
into encoded/obfuscated attack variants (the raw prompt is always included as a
control). The parent process sends the variants to the audited target through
the app's own TargetModelClient and scores the responses.
"""

import asyncio
import json
import sys

# Deterministic, setup-free converters (no LLM/target dependency). LLM-driven
# converters are intentionally excluded so the runner never needs credentials.
_DEFAULT_CONVERTERS = [
    "Base64Converter",
    "ROT13Converter",
    "LeetspeakConverter",
    "StringJoinConverter",
    "CaesarConverter",
]


def _load_converters(names):
    import pyrit.prompt_converter as pc

    loaded = []
    for name in names:
        cls = getattr(pc, name, None)
        if cls is None:
            continue
        try:
            loaded.append((name, cls()))
        except Exception:
            # A converter that needs constructor args we don't supply is skipped
            # rather than failing the whole batch.
            continue
    return loaded


async def _run(job):
    import pyrit

    base_prompts = [p for p in job.get("base_prompts", []) if isinstance(p, str) and p.strip()]
    converter_names = job.get("converters") or _DEFAULT_CONVERTERS
    converters = _load_converters(converter_names)

    variants = []
    for base in base_prompts:
        # Raw prompt as a control (no obfuscation).
        variants.append({"base": base, "converter": "none", "prompt": base, "error": None})
        for name, converter in converters:
            try:
                result = await converter.convert_async(prompt=base, input_type="text")
                variants.append(
                    {"base": base, "converter": name, "prompt": result.output_text, "error": None}
                )
            except Exception as exc:  # noqa: BLE001 - report, don't abort
                variants.append(
                    {"base": base, "converter": name, "prompt": None, "error": str(exc)}
                )

    return {"pyrit_version": pyrit.__version__, "variants": variants}


def main():
    try:
        job = json.load(sys.stdin)
    except Exception as exc:  # noqa: BLE001
        json.dump({"error": f"invalid job json: {exc}", "variants": []}, sys.stdout)
        return
    try:
        result = asyncio.run(_run(job))
    except Exception as exc:  # noqa: BLE001
        json.dump({"error": f"pyrit run failed: {exc}", "variants": []}, sys.stdout)
        return
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
