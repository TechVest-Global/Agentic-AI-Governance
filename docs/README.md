# Documentation Index

This folder is the source of truth for the GenAI Governance Engine product
specification and technical design. Local schedules, assignments, Word,
PowerPoint, and Excel planning files stay out of Git; durable product and
engineering knowledge lives here in Markdown.

## Core Documents

| Document | Purpose |
| --- | --- |
| [SPEC.md](SPEC.md) | Product specification: what we are building, for whom, success criteria, scope, requirements, risks, and glossary. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Engineering design: pipeline layers, state flow, clients, components, deployment assumptions, and invariants. |
| [DATA_MODEL.md](DATA_MODEL.md) | Core entities, relationships, append-only lifecycle, retention, and migration approach. |
| [API_CONTRACTS.md](API_CONTRACTS.md) | Planned API groups, endpoints, request/response shapes, errors, and versioning. |
| [THREAT_MODEL.md](THREAT_MODEL.md) | Security, abuse, privacy, and AI-specific risks with mitigations. |
| [RUNBOOK.md](RUNBOOK.md) | Local operations, checks, troubleshooting, and recovery notes. |

## Decision Records

Architecture decisions live under [adr/](adr/). ADRs are append-only records of
important choices, alternatives, and consequences.

## Current Implementation Status

The repository currently contains:

- FastAPI backend foundation with health/version routes.
- PostgreSQL-ready configuration through environment variables.
- Local PostgreSQL workflow through `DATABASE_URL`.
- Optional Docker Compose PostgreSQL fallback for isolated local testing.
- Alembic migration scaffold.
- Core governance SQLModel entities, API schemas, migrations, and model tests.
- AI system, capability, profile, evaluation run, state, ledger, evidence,
  findings, verdict, report, and config APIs.
- Metric evaluator adapter scaffold with a mock evaluator.
- Deterministic specialist-agent scaffold separated from future real agent
  design work.
- Target/governance model client boundary scaffold with target-output
  sanitization.
- Vite React frontend prototype using mock data.

The next backend implementation focus is deterministic Context Assembly:
log analysis, regulatory config ingestion, coverage gap detection, and an
evaluation-plan contract that can drive real agents and metric tools.
