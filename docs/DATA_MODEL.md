# Data Model

## Design Rules

- PostgreSQL is the source of truth.
- IDs should be UUIDs unless there is a strong reason otherwise.
- GovernanceState and audit events are append-only.
- Evidence is stored separately and linked by ID.
- Framework and metric behavior should be config-driven.
- No production secret should be stored in model configuration payloads.

## Entity Overview

```text
AISystem
  1 -> 1 ApplicationContextProfile
  1 -> many EvaluationRun

EvaluationRun
  1 -> many GovernanceStateEntry
  1 -> many EvidenceRecord
  1 -> many MetricResult
  1 -> many Finding
  1 -> 0..1 Verdict
  1 -> many AuditLedgerEntry
```

## AISystem

Purpose: registered AI application or model-backed workflow.

Suggested fields:

- `id`
- `name`
- `description`
- `owner`
- `system_type`
- `risk_tier`
- `deployment_environment`
- `status`
- `selected_frameworks`
- `model_provider`
- `model_name`
- `model_version`
- `target_endpoint_ref`
- `created_at`
- `updated_at`

## ApplicationContextProfile

Purpose: required context that lets the engine test the production application,
not a laboratory model.

Sections:

- **A: Application Identity and Purpose**
  Business domain, use case, users, decision impact, scale, jurisdictions.
- **B: Pre-Model Business Rules**
  Input validation, PII handling, prompt construction, context injection,
  conditional routing.
- **C: Model Configuration**
  Provider, version, system prompt reference, temperature, token limits, tools,
  response format, fine-tuning notes.
- **D: Post-Model Business Rules**
  Output filtering, moderation, transformations, fallback logic, human review,
  logging.
- **E: Integration Context**
  Upstream systems, downstream actions, audit sinks, notifications, rollback
  capability.

Suggested fields:

- `id`
- `ai_system_id`
- `section_a`
- `section_b`
- `section_c`
- `section_d`
- `section_e`
- `created_at`
- `updated_at`

## EvaluationRun

Purpose: one governance audit execution.

Suggested fields:

- `id`
- `ai_system_id`
- `status`
- `current_phase`
- `selected_frameworks`
- `selected_metrics`
- `started_at`
- `completed_at`
- `created_by`
- `result_summary`
- `error_summary`

Statuses:

- `created`
- `context_assembly`
- `planned`
- `metrics_running`
- `agents_running`
- `council_running`
- `report_ready`
- `completed`
- `failed`
- `degraded`
- `cancelled`

## GovernanceStateEntry

Purpose: append-only state bus and reconstruction source.

Suggested fields:

- `id`
- `run_id`
- `sequence_number`
- `entry_type`
- `source`
- `phase`
- `payload`
- `previous_hash`
- `entry_hash`
- `created_at`

Rules:

- Insert only.
- No update/delete in normal application flow.
- `sequence_number` is monotonic per run.
- Hash includes run ID, sequence number, entry type, payload, previous hash, and
  timestamp.

## EvidenceRecord

Purpose: stored proof that supports metric results, findings, verdicts, and
reports.

Suggested fields:

- `id`
- `run_id`
- `source_type`
- `source_name`
- `tool_name`
- `tool_version`
- `input_ref`
- `output_ref`
- `raw_score`
- `normalized_score`
- `threshold`
- `passed`
- `trace_id`
- `payload`
- `sensitivity`
- `created_at`

## MetricResult

Purpose: normalized output from tool wrappers.

Suggested fields:

- `id`
- `run_id`
- `metric_id`
- `dimension`
- `tool_name`
- `status`
- `raw_score`
- `normalized_score`
- `threshold`
- `passed`
- `evidence_ids`
- `created_at`

## Finding

Purpose: structured issue or observation produced by a metric/tool/agent.

Suggested fields:

- `id`
- `run_id`
- `finding_type`
- `title`
- `summary`
- `severity`
- `confidence`
- `dimension`
- `framework_refs`
- `evidence_ids`
- `agent_name`
- `recommended_action`
- `status`
- `created_at`

## Verdict

Purpose: final confidence-scored result for a run.

Suggested fields:

- `id`
- `run_id`
- `confidence_score`
- `action_tier`
- `label`
- `synthesis`
- `objections`
- `reasoning`
- `required_actions`
- `created_at`

Action tiers:

- `autonomous`
- `supervised`
- `human_review`

## AuditLedgerEntry

Purpose: tamper-evident history for state, findings, verdicts, reports, and
human actions.

Suggested fields:

- `id`
- `run_id`
- `event_type`
- `actor_type`
- `actor_id`
- `payload`
- `previous_hash`
- `entry_hash`
- `created_at`

## Migration Plan

1. Create SQLModel models for core entities.
2. Generate an initial Alembic migration.
3. Apply migration against local Docker PostgreSQL.
4. Add repository/service functions for create/read/list flows.
5. Add tests for persistence and serialization.
