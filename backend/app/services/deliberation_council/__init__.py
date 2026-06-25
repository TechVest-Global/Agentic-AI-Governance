"""Layer 4 — Deliberation Council.

Three-agent pipeline with a bounded remediation loop:
  SynthesisAgent       → unified narrative memo from all findings + metrics
  DevilsAdvocateAgent  → forced objection on every iteration (mandatory dissent)
  VerdictAgent         → confidence score, sufficient flag, remediation_type

Router (deterministic, 3 exits):
  sufficient=True          → action tier (Layer 5)
  iteration >= 3           → human review + uncertainty memo
  insufficient + under cap → re-enter pipeline at cheapest fix point
"""
