"""
Schema generation script.


Run from the repo root:
    python backend/scripts/generate_schemas.py

Generates:
    backend/app/configs/schemas/metric_config.schema.json
    backend/app/configs/schemas/framework_config.schema.json

The JSON Schema files are derived entirely from the Pydantic models — never
hand-written. Re-run this script whenever config_models.py changes.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path



# Ensure the backend package is importable when the script is run from the repo root.
REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_SRC = REPO_ROOT / "backend"
if str(BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(BACKEND_SRC))

from app.configs.config_models import FrameworkConfig, MetricConfig  # noqa: E402

SCHEMA_DIR = REPO_ROOT / "backend" / "app" / "configs" / "schemas"


def generate_schemas() -> None:
    SCHEMA_DIR.mkdir(parents=True, exist_ok=True)

    schemas: list[tuple[type, str]] = [
        (MetricConfig, "metric_config.schema.json"),
        (FrameworkConfig, "framework_config.schema.json"),
    ]

    for model, filename in schemas:
        schema = model.model_json_schema()
        # Embed the schema dialect so validators know what spec to use.
        schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
        out_path = SCHEMA_DIR / filename
        out_path.write_text(json.dumps(schema, indent=2), encoding="utf-8")
        print(f"  wrote {out_path.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    print("Generating JSON Schema files from Pydantic models...")
    generate_schemas()
    print("Done.")
