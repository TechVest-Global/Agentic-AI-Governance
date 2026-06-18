# Runbook

## Local Backend Startup

Create and activate environment:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
```

Create local config:

```powershell
Copy-Item .env.example .env
```

## Local PostgreSQL

The preferred local workflow is a locally installed PostgreSQL service, not a
Docker container.

Default local connection expected by `.env.example`:

```text
DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/agentic_ai_governance
```

Create the database if it does not exist:

```powershell
psql -U postgres -h localhost -p 5432 -c "CREATE DATABASE agentic_ai_governance;"
```

If your local PostgreSQL password, username, or port differs, update
`DATABASE_URL` in `.env`.

Optional Docker fallback:

```powershell
docker compose up -d postgres
```

Use Docker Compose only when you intentionally want an isolated local database
container.

Apply migrations:

```powershell
python -m alembic upgrade head
```

Run API:

```powershell
uvicorn app.main:app --reload --app-dir backend
```

Load default governance metrics and framework mappings:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/api/v1/governance-config/bootstrap
```

This step is safe to rerun. Existing default records are skipped.

Run the local prototype governance pipeline for an existing evaluation run:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8000/api/v1/evaluation-runs/<run-id>/orchestrate `
  -ContentType "application/json" `
  -Body '{"mock_score":1.0,"agent_names":["risk_agent"],"requested_by":"local"}'
```

The orchestration endpoint runs mock metrics, specialist agents, council
deliberation, and returns the consolidated governance report.

Useful URLs:

- `http://127.0.0.1:8000/docs`
- `http://127.0.0.1:8000/api/v1/health`
- `http://127.0.0.1:8000/api/v1/version`

## Validation Commands

```powershell
python -m pytest backend\tests -q
python -m ruff check backend
python -m alembic heads
python -m alembic current
```

## Optional Docker Safety

Docker is not required for the preferred local workflow. If you use the optional
compose fallback, this repo's compose project is separate from other local
projects. Do not run global Docker cleanup commands when other projects are
running.

Check running containers:

```powershell
docker ps
```

Stop only this repo's database:

```powershell
docker compose stop postgres
```

Do not stop or remove unrelated containers such as email automation services.

## Common Problems

### Port 5432 Is Already In Use

Either stop the unrelated local service, or run PostgreSQL on another local
port and update `DATABASE_URL` accordingly.

### Alembic Cannot Import `app`

Run Alembic from the repository root. `alembic.ini` sets
`prepend_sys_path = backend`.

### App Still Uses SQLite

Check ignored local `.env`. It overrides defaults from `.env.example`.

### Docker Permission Error

Docker is optional. If you are using the fallback compose workflow, make sure
Docker Desktop is running and the terminal has permission to access the Docker
engine.

## Recovery Notes

- If a migration fails before production data exists, inspect the migration and
  rerun after fixing it.
- Once shared data exists, do not manually edit migration history without team
  agreement.
- Append-only GovernanceState and audit ledger records should not be manually
  deleted in normal operation.
