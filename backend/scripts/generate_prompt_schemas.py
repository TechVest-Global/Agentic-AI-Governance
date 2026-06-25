"""
Schema generation script for the Prompt Template Registry.

Run from the repo root:
    python backend/scripts/generate_prompt_schemas.py

Generates:
    backend/app/configs/schemas/prompt_template.schema.json

The JSON Schema file is derived entirely from the Pydantic model — never
hand-written. Re-run this script whenever prompt_template_models.py changes.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_SRC = REPO_ROOT / "backend"
if str(BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(BACKEND_SRC))

from app.configs.prompt_template_models import PromptTemplate  # noqa: E402

SCHEMA_DIR = REPO_ROOT / "backend" / "app" / "configs" / "schemas"


def generate_schema() -> None:
    SCHEMA_DIR.mkdir(parents=True, exist_ok=True)

    schema = PromptTemplate.model_json_schema()
    schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
    out_path = SCHEMA_DIR / "prompt_template.schema.json"
    out_path.write_text(json.dumps(schema, indent=2), encoding="utf-8")
    print(f"  wrote {out_path.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    print("Generating JSON Schema for PromptTemplate...")
    generate_schema()
    print("Done.")
