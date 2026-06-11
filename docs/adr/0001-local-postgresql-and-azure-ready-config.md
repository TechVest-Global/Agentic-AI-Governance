# ADR 0001: Local PostgreSQL and Azure-Ready Configuration

**Status:** Accepted  
**Date:** 2026-06-11

## Context

The backend needs a local development database and a path to shared/cloud
deployment. Company guidance confirmed:

- Local development uses PostgreSQL through Docker Compose.
- Shared/cloud environments are expected to use Azure Database for PostgreSQL.
- Secrets should move through Azure secrets infrastructure.
- AI integrations should use Azure AI Foundry by default.
- Azure hosting target is not finalized, though Container Apps is used by some
  deployed applications.

## Decision

Use PostgreSQL locally through Docker Compose and configure the backend through
environment variables. Use Alembic for migrations. Keep Azure settings as
configuration placeholders until the cloud target is finalized.

## Alternatives Considered

- **SQLite for local development:** simple, but does not match the target
  database behavior closely enough for migrations and JSON/state workloads.
- **Shared dev database only:** creates dependency on network/cloud access and
  makes local onboarding harder.
- **Hardcoded Azure settings:** premature because hosting and secrets details
  are not finalized.

## Consequences

Positive:

- Local setup matches the likely production database family.
- Developers can run independently.
- Migrations are part of the workflow from the beginning.
- Azure migration remains mostly configuration-driven.

Negative:

- Docker Desktop must be running.
- Port conflicts can happen when other projects use PostgreSQL on `5432`.

Mitigation:

- Allow `POSTGRES_PORT=5433` locally while the container still uses PostgreSQL's
  internal `5432`.
