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

If another project uses `5432`, set:

```text
POSTGRES_PORT=5433
DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5433/agentic_ai_governance
```

Start database:

```powershell
docker compose up -d postgres
```

Apply migrations:

```powershell
python -m alembic upgrade head
```

Run API:

```powershell
uvicorn app.main:app --reload --app-dir backend
```

Useful URLs:

- `http://127.0.0.1:8000/docs`
- `http://127.0.0.1:8000/api/v1/health`
- `http://127.0.0.1:8000/api/v1/version`

## Validation Commands

```powershell
python -m pytest backend\tests -q
python -m ruff check backend
python -m alembic heads
docker compose config
```

## Docker Safety

This repo's compose project is separate from other local projects. Do not run
global Docker cleanup commands when other projects are running.

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

Use `POSTGRES_PORT=5433` and update `DATABASE_URL` accordingly.

### Alembic Cannot Import `app`

Run Alembic from the repository root. `alembic.ini` sets
`prepend_sys_path = backend`.

### App Still Uses SQLite

Check ignored local `.env`. It overrides defaults from `.env.example`.

### Docker Permission Error

Make sure Docker Desktop is running and the terminal has permission to access
the Docker engine.

## Recovery Notes

- If a migration fails before production data exists, inspect the migration and
  rerun after fixing it.
- Once shared data exists, do not manually edit migration history without team
  agreement.
- Append-only GovernanceState and audit ledger records should not be manually
  deleted in normal operation.
