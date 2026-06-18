# Architecture

## Governing Principles

The backend architecture follows these invariants:

1. **Aggressive detection, conservative action.** Specialist agents should flag
   suspicious behavior early; the council moderates findings before action.
2. **Append-only state.** No layer overwrites earlier work. GovernanceState is
   a ledger.
3. **Resume from any failure.** State must be checkpointed at node boundaries.
4. **Framework drives behavior, not code.** Regulations and mappings live in
   config.
5. **Two clients, one firewall.** Governance reasoning and target model calls
   use separate clients, credentials, and context boundaries.
6. **Detection and adjudication are separate.** Specialists detect; the council
   adjudicates.

## Five-Layer Pipeline

```text
Layer 1: Context Assembly
  -> log analysis, sanity probe, regulatory ingester, coverage gaps

Layer 2: Adaptive Orchestrator
  -> evaluation plan, activated agents, budget allocation, rationale

Layer 3: Specialist Agent Pipeline
  -> bias, drift, misuse, compliance, explainability, risk findings

Layer 4: Deliberation Council
  -> synthesis, objections, verdict, confidence, action tier

Layer 5: Action and Reporting
  -> report, audit ledger, override flow, action records
```

Every layer reads from and appends to GovernanceState. Later layers may read
earlier entries, but they do not mutate them.

## Major Components

### FastAPI API Layer

Responsibilities:

- Versioned REST API under `/api/v1`.
- Health/version routes.
- AI system and evaluation run APIs.
- State, evidence, finding, verdict, report, and framework map APIs.
- Future WebSocket or event stream endpoints for run progress.

### Database Layer

Responsibilities:

- PostgreSQL persistence.
- SQLModel model definitions.
- Alembic migrations.
- Session lifecycle and transaction boundaries.

### Config Layer

Responsibilities:

- Environment-variable based settings.
- Metric config loading.
- Framework mapping loading.
- Azure-ready secrets/model provider settings.

### GovernanceState Service

Responsibilities:

- Append-only state writes.
- Sequence assignment.
- Integrity hash calculation.
- Checkpoint retrieval.
- Run reconstruction.

### Evidence Service

Responsibilities:

- Store evidence packets.
- Link evidence to metric results, findings, verdicts, and reports.
- Preserve tool metadata without leaking implementation details to callers.

### Metric and Tool Wrapper Layer

Responsibilities:

- Execute or mock Promptfoo, RAGAS, DeepEval, Presidio, Garak, Evidently, and
  Langfuse-related workflows.
- Normalize output into MetricResult and EvidenceRecord shapes.
- Encapsulate tool-specific errors.

### Model Clients

Responsibilities:

- `governance_model_client`: approved reasoning model access through Azure AI
  Foundry by default.
- `target_model_client`: isolated calls to the audited model/application.
- Sanitization and output fencing before target responses are used downstream.

## Current Runtime Setup

Local development:

- FastAPI + Uvicorn.
- Locally installed PostgreSQL service for day-to-day development.
- Optional Docker Compose PostgreSQL fallback for isolated local database
  testing.
- Alembic for migrations.
- `.env` for local secrets and configuration.

Cloud direction:

- Azure Database for PostgreSQL for shared/cloud data.
- Azure secrets infrastructure for secrets.
- Azure AI Foundry for model integrations by default.
- Hosting target not finalized; Azure Container Apps is a likely option.

## State Flow

1. User registers AISystem and ApplicationContextProfile.
2. User registers the system's callable capabilities/endpoints, including
   side-effect and human-review classifications.
3. User creates EvaluationRun.
4. Backend initializes GovernanceState.
5. Context Assembly appends deterministic context entries.
6. Orchestrator appends evaluation plan.
7. Metrics/tools append evidence and metric results.
8. Specialist agents append findings.
9. Council appends synthesis, objections, and verdict.
10. Reporting appends report generation events.

## Trust Boundaries

- Browser/client to API boundary.
- API to database boundary.
- Governance model client boundary.
- Target model client boundary.
- Tool wrapper boundary.
- Evidence/report boundary where sensitive payloads may be displayed.

Target model output is untrusted at every boundary.

## Extension Points

- Add a framework by adding config and mapping entries.
- Add a metric by adding metric config and wrapper support.
- Add an agent by implementing the common finding contract.
- Add a report view by consuming stored state/evidence rather than rerunning
  evaluations.
