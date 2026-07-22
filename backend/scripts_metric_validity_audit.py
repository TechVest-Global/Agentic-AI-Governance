"""Ad-hoc audit: for every metric in the catalog, classify how its score is
produced under the `auto` router — REAL tool probe, DERIVED (threshold), or
SKIPPED (no real integration). Read-only; does not execute any probes."""
from collections import defaultdict

from app.configs.config_loader import load_metric_configs_from_dir
from app.services.evaluators.registry import EVALUATORS

REAL = {name for name in EVALUATORS if name not in {"mock", "threshold"}}
DERIVED = {"threshold"}
MOCK = {"mock", "mock_metric_runner"}

metrics = sorted(load_metric_configs_from_dir(), key=lambda m: m.metric_id)

buckets = defaultdict(list)
rows = []
for m in metrics:
    tool = (m.tool or "").strip().lower()
    if tool in REAL:
        cls = "REAL"
    elif tool in DERIVED:
        cls = "DERIVED"
    elif tool in MOCK:
        cls = "MOCK"
    else:
        cls = "SKIPPED"  # auto router skips tools with no evaluator integration
    buckets[cls].append(m.metric_id)
    rows.append((m.metric_id, m.dimension, tool, m.secondary_tool or "-", cls))

print(f"{'METRIC':9} {'DIMENSION':16} {'TOOL':12} {'2ND TOOL':11} CLASS")
print("-" * 62)
for r in rows:
    print(f"{r[0]:9} {r[1]:16} {r[2]:12} {r[3]:11} {r[4]}")

print("\n=== SUMMARY (how each metric's score is produced under `auto`) ===")
total = len(metrics)
for cls in ("REAL", "DERIVED", "MOCK", "SKIPPED"):
    ids = buckets.get(cls, [])
    print(f"  {cls:8} {len(ids):2}/{total}  {sorted(ids)}")
print(f"\nReal evaluators available: {sorted(REAL)}")
