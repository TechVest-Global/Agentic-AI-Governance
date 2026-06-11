# Documentation Index

This folder is the source of truth for the GenAI Governance Engine specification
and engineering plan. The local Word, PowerPoint, and Excel planning files stay
out of Git; the durable project knowledge should live here in Markdown.

## Core Documents

| Document | Purpose |
| --- | --- |
| [SPEC.md](SPEC.md) | Product specification: what we are building, for whom, success criteria, scope, requirements, risks, and glossary. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Engineering design: pipeline layers, state flow, clients, components, deployment assumptions, and invariants. |
| [DATA_MODEL.md](DATA_MODEL.md) | Core entities, relationships, append-only lifecycle, retention, and migration approach. |
| [API_CONTRACTS.md](API_CONTRACTS.md) | Planned API groups, endpoints, request/response shapes, errors, and versioning. |
| [THREAT_MODEL.md](THREAT_MODEL.md) | Security, abuse, privacy, and AI-specific risks with mitigations. |
| [RUNBOOK.md](RUNBOOK.md) | Local operations, checks, troubleshooting, and recovery notes. |
| [PROJECT_PLAN.md](PROJECT_PLAN.md) | Workstream milestones, Person 1 backend responsibilities, sequencing, and current status. |

## Decision Records

Architecture decisions live under [adr/](adr/). ADRs are append-only records of
important choices, alternatives, and consequences.

## Current Implementation Status

The repository currently contains:

- FastAPI backend foundation with health/version routes.
- PostgreSQL-ready configuration through environment variables.
- Docker Compose PostgreSQL for local development.
- Alembic migration scaffold.
- Vite React frontend prototype using mock data.

The next implementation focus is the Week 2 backend data foundation:
`AISystem`, `ApplicationContextProfile`, `EvaluationRun`, `GovernanceState`,
`EvidenceRecord`, `Finding`, and `Verdict`.
