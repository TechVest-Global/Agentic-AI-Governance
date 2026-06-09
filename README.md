# Agentic AI Governance

LangGraph-oriented multi-agent pipeline for auditing AI systems against regulatory
frameworks, covering bias, compliance, risk, evidence, and audit trails.

## Backend Foundation

Person 1 owns the backend and orchestration foundation. The first backend slice
contains:

- FastAPI application shell
- `/api/v1/health` and `/api/v1/version`
- environment-driven settings
- database session foundation
- folders for API routes, schemas, models, services, and compliance configs
- placeholder config directories for metric and framework definitions

## Local Setup

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

Run the backend:

```powershell
uvicorn app.main:app --reload --app-dir backend
```

Useful URLs:

- API docs: `http://127.0.0.1:8000/docs`
- Health: `http://127.0.0.1:8000/api/v1/health`
- Version: `http://127.0.0.1:8000/api/v1/version`

## Team Workflow

Use feature branches from `dev`.

Examples:

- `feature/p1-backend-foundation`
- `feature/p2-agent-evaluation-tools`
- `feature/p3-frontend-reporting`

Keep local planning documents, virtual environments, `.env` files, and generated
artifacts out of Git.
