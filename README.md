# Agentic AI Governance

Agentic AI Governance is an AI governance control plane for evaluating,
auditing, and governing AI systems through a multi-agent pipeline. The system is
designed to register AI systems, assemble governance context, plan an adaptive
audit, run specialist agents, deliberate through a council, route the final
verdict by confidence tier, and preserve an immutable audit ledger.

This repository currently contains the backend foundation and a Vite React
frontend prototype used to align the team on the lead-provided governance engine
experience.

## Documentation

The project specification and engineering docs live in [docs](docs/README.md).
Start with [docs/SPEC.md](docs/SPEC.md), then use the architecture, data model,
API contracts, threat model, runbook, and architecture decision records as
companion references.

## Product Scope

The platform targets regulated AI governance workflows where model owners,
governance engineers, compliance officers, model risk teams, and auditors need
evidence-backed oversight rather than a simple monitoring dashboard.

Core outcomes:

- Register AI systems and capture application context.
- Run a governance audit through deterministic and LLM-powered layers.
- Generate specialist findings with evidence, severity, confidence, and
  regulatory citations.
- Synthesize findings through a deliberation council with adversarial review.
- Route verdicts into Autonomous, Supervised, or Human Review tiers.
- Preserve append-only audit history with traceable lineage.

## Governance Lifecycle

```text
AI System Registration
  -> Context Assembly
  -> Adaptive Orchestrator
  -> Specialist Agent Execution
  -> Deliberation Council
  -> Verdict and Action Routing
  -> Audit Ledger
```

## Planned Architecture

The project plan is organized around five execution layers plus delivery
infrastructure:

- Layer 1: Context Assembly
  Deterministic analysis of logs, sanity probes, regulatory context, and
  coverage gaps.
- Layer 2: Adaptive Orchestrator
  LLM-powered audit planning and evaluation budget allocation.
- Layer 3: Specialist Agents
  Parallel agents for bias, drift, misuse, compliance, explainability, and risk.
- Layer 4: Deliberation Council
  Synthesis, Devil's Advocate review, verdict scoring, and confidence routing.
- Layer 5: Action, Reporting, and Audit Ledger
  Human actions, override windows, reports, and hash-chained audit events.

## Team Roles

| Person | Primary Focus |
| --- | --- |
| Person 1 | Backend foundation, GovernanceState, orchestration, API, Layers 1-2, and infrastructure |
| Agent Engineer | Specialist agents, deliberation council, framework configs, reporting logic |
| Frontend Engineer | UI components, live run experience, reporting views, frontend integration |

## Delivery Plan

| Week | Focus | Deliverable |
| --- | --- | --- |
| 1 | Foundation and infrastructure | Project scaffold, backend shell, GovernanceState direction, DB/API foundation |
| 2 | Layer 1: Context Assembly | Log analysis, sanity probes, regulatory ingester, coverage gaps |
| 3 | Layer 2: Adaptive Orchestrator | LLM planner, evaluation plan schema, plan persistence |
| 4 | Layer 3 Part 1 | Bias Auditor, Drift Analyst, shared agent pattern |
| 5 | Layer 3 Part 2 | Misuse, Compliance, Explainability, Risk Scorer agents |
| 6 | Layer 4: Deliberation Council | Synthesis, Devil's Advocate, Verdict Agent, confidence engine |
| 7 | Layer 5: Action and Ledger | Action tiers, human overrides, audit ledger, reporting |
| 8 | Frontend Core | System registry, live governance run, agent drilldowns, verdict view |
| 9 | Frontend Reporting and Integration | Reports, audit ledger UI, WebSocket feeds, end-to-end wiring |
| 10 | Stabilization and Delivery | Testing, deployment, documentation, demo readiness |

## Current Repository State

Backend foundation:

- FastAPI application shell.
- `/api/v1/health` and `/api/v1/version`.
- Environment-driven settings.
- PostgreSQL-ready database session foundation.
- Docker Compose local PostgreSQL service.
- Alembic migration scaffold.
- API, schema, model, service, and compliance config folders.
- Placeholder config directories for metric and framework definitions.

Frontend prototype:

- Vite + React + TypeScript application under `frontend/`.
- Dashboard, AI Systems, Governance Engine, Agent Intelligence, Council,
  Verdicts, Reports, and Audit Ledger views.
- Lead-provided governance engine prototype embedded into the app shell.
- Mock data only until backend integration is explicitly wired.

## Backend Local Setup

Create and activate a virtual environment:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

Install dependencies:

```powershell
python -m pip install -e ".[dev]"
```

Create local environment config:

```powershell
Copy-Item .env.example .env
```

Start local PostgreSQL:

```powershell
docker compose up -d postgres
```

If another local project already uses port `5432`, set `POSTGRES_PORT=5433`
and update `DATABASE_URL` in `.env` to use `localhost:5433`.

Apply database migrations:

```powershell
alembic upgrade head
```

Run the backend:

```powershell
uvicorn app.main:app --reload --app-dir backend
```

Useful backend URLs:

- API docs: `http://127.0.0.1:8000/docs`
- Health: `http://127.0.0.1:8000/api/v1/health`
- Version: `http://127.0.0.1:8000/api/v1/version`

## Frontend Local Setup

Install frontend dependencies:

```powershell
cd frontend
npm install
```

Run the frontend:

```powershell
npm run dev
```

Useful frontend URL:

- App: `http://127.0.0.1:3000/`

Validate the frontend build:

```powershell
npm run build
```

## Branching and PR Workflow

The team should use `dev` as the integration branch and open pull requests from
feature branches.

Recommended flow:

```powershell
git switch dev
git pull origin dev
git switch -c feature/<scope-name>
```

Examples:

- `feature/p1-backend-foundation`
- `feature/p2-agent-evaluation-tools`
- `feature/p3-frontend-reporting`

Before opening a PR:

- Run relevant backend and frontend checks.
- Push only source code, configuration, and documentation intended for the team.
- Keep generated files and private local files out of Git.
- Target the PR into `dev` unless the lead gives a different instruction.

## Do Not Commit

The repository ignore rules intentionally exclude local or binary planning files
and generated artifacts, including:

- `.env` and local secrets.
- `.venv`, `venv`, and local Python environments.
- `.pytest_cache`, `.ruff_cache`, `.mypy_cache`, `__pycache__`, and egg-info.
- `node_modules`, `dist`, `build`, `.next`, and `.vite`.
- Local log files.
- Word, PowerPoint, and Excel files such as `*.docx`, `*.pptx`, and `*.xlsx`.

If project planning files need to be shared with the team, convert them into
Markdown under `docs/` or attach them outside the repository workflow.

## Deployment Direction

Current backend assumptions based on company guidance:

- Local development uses PostgreSQL through Docker Compose.
- Shared development, staging, and production should move to Azure Database for
  PostgreSQL when the cloud environment is ready.
- Secrets should be routed through Azure secrets infrastructure later; local
  development uses environment variables.
- AI model integrations should target Azure AI Foundry by default. Third-party
  model providers should stay behind provider-neutral clients and require
  management approval before use.
- The Azure hosting target is not finalized yet. Container Apps is a likely
  option because some deployed applications already use it, but the backend
  should stay container-ready and environment-configurable.
