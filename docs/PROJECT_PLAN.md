# Project Plan

## Planning Window

Formal plan: June 8, 2026 through August 7, 2026.  
V1 goal: run -> findings -> verdict -> report.  
Planning style: milestone-based, not hour-based.

## Workstreams

- Backend Foundation and Orchestration: Person 1
- Agents and Evaluation Tools: Person 2
- Frontend, Reports, and Integration: Person 3

## Person 1 Scope

Person 1 owns:

- Backend repo structure and local setup.
- FastAPI app shell.
- PostgreSQL and Alembic foundation.
- Core data models.
- GovernanceState and append-only writes.
- AI system and evaluation run APIs.
- Metric/framework loaders.
- Evidence APIs.
- Agent execution service endpoints.
- Checkpointing and orchestration backend.
- Council/verdict backend.
- Report and audit ledger APIs.
- Backend setup and troubleshooting docs.

## Current Status

| Task | Plan Item | Status |
| --- | --- | --- |
| T001 | Backend repo structure and branch strategy | Done |
| T002 | FastAPI app shell with health/version endpoints | Done |
| T003 | Local DB setup and migration baseline | Done |
| T010-T015 | Core models | Done |
| T016 | AI system and evaluation run API groups | Next |

## Milestones

| Target Date | Milestone | Exit Evidence |
| --- | --- | --- |
| 2026-06-12 | Scope locked, repo ready, backend skeleton started | README, local dev setup, FastAPI skeleton |
| 2026-06-19 | Core data model and GovernanceState working | Core models, migrations, state persistence |
| 2026-06-26 | Metric configs and framework mappings working | M01-M20 config loader and framework map |
| 2026-07-03 | Tool wrappers and evidence capture working | Normalized tool wrapper outputs and evidence records |
| 2026-07-10 | First 3 agents producing findings | Initial specialist findings |
| 2026-07-17 | All 6 specialist agents working in V1 form | All specialist finding outputs |
| 2026-07-24 | Council, risk scorer, and verdict flow working | Synthesis, objections, confidence, action tier |
| 2026-07-31 | Frontend connected, report flow demoable | UI can show run, findings, verdict, report |
| 2026-08-07 | Final polished product demo | End-to-end demo and docs |

## Immediate Backend Backlog

1. Commit backend setup docs and local PostgreSQL/Alembic scaffold.
2. Implement SQLModel entities for:
   - AISystem
   - ApplicationContextProfile
   - EvaluationRun
   - GovernanceStateEntry
   - EvidenceRecord
   - MetricResult
   - Finding
   - Verdict
   - AuditLedgerEntry
3. Generate the first model migration after core SQLModel entities are added.
4. Add persistence tests.
5. Add API routes for systems and runs.
6. Add metric and framework config schema placeholders.

## Coordination Notes

- Person 2 needs stable metric and framework config schemas.
- Person 3 needs stable API contracts and response shapes.
- Frontend can remain mock-data based until backend endpoints are ready.
- Office planning files should remain ignored; update Markdown docs for repo
  visibility.
