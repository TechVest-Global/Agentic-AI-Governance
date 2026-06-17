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
  1 -> many AISystemCapability
  1 -> many EvaluationRun

MetricConfig
  many <-> many FrameworkMapping through stored metric/framework IDs

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

`target_endpoint_ref` is an optional system-level or default endpoint reference.
Individual callable operations are represented by `AISystemCapability`.

## AISystemCapability

Purpose: one independently governable application capability or endpoint, such
as `answer_question`, `search_documents`, or `create_support_ticket`.

Suggested fields:

- `id`
- `ai_system_id`
- `name`
- `description`
- `capability_type`
- `endpoint_ref`
- `http_method`
- `input_schema`
- `output_schema`
- `permissions`
- `side_effect_level`
- `requires_human_review`
- `enabled`
- `metadata_json`
- `created_at`
- `updated_at`

Rules:

- One AI system can expose many capabilities.
- Capability names are unique within one AI system.
- Endpoint references never contain credentials.
- Write/destructive capabilities should declare required permissions and human
  review expectations.
- Evaluation planning can later select and test capabilities independently.

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
- `identity_purpose` - business domain, primary use case, users, decision impact, scale, and jurisdictions
- `pre_model_controls` - input validation, PII handling, prompt construction, retrieved context, and routing
- `model_configuration` - provider, model/version, prompt reference, tools, temperature, token limits, and response format
- `post_model_controls` - output filtering, moderation, citation checks, fallback behavior, human review, and logging
- `integration_context` - upstream sources, downstream actions, audit sinks, notifications, and rollback capability
- `created_at`
- `updated_at`

These are first-class database and API fields so callers do not have to remember
abstract section labels.

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

## MetricConfig

Purpose: versioned metric catalog entry that tells the orchestrator and tool
wrappers what to evaluate.

Suggested fields:

- `id`
- `metric_id`
- `name`
- `description`
- `dimension`
- `primary_agent`
- `tool_name`
- `framework_ids`
- `modality`
- `threshold_rules`
- `scoring_config`
- `version`
- `enabled`
- `metadata_json`
- `created_at`
- `updated_at`

Rules:

- `metric_id` and `version` are unique together.
- Thresholds remain data/config, not hardcoded route logic.
- Disabled metrics remain stored for auditability but should not be selected for
  new runs by default.

## FrameworkMapping

Purpose: map framework controls or clauses to metrics, agents, risk tiers, and
required evidence.

Suggested fields:

- `id`
- `framework_id`
- `framework_name`
- `framework_version`
- `control_ref`
- `control_title`
- `control_category`
- `jurisdiction`
- `requirement_text`
- `metric_ids`
- `agent_names`
- `risk_tiers`
- `evidence_requirements`
- `enabled`
- `metadata_json`
- `created_at`
- `updated_at`

Rules:

- `framework_id`, `framework_version`, and `control_ref` are unique together.
- Framework mappings should reference metric IDs from `MetricConfig`.
- Clause/control text lives in config data, not application code.

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
- `ai_system_capability_id`
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

`ai_system_capability_id` is optional because some evidence belongs to the
overall run, while capability-specific probes should point to the exact
application function or endpoint that produced the evidence.

## MetricResult

Purpose: normalized output from tool wrappers.

Suggested fields:

- `id`
- `run_id`
- `ai_system_capability_id`
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

`ai_system_capability_id` lets one run store separate metric results for
different functions exposed by the same AI system.

## Finding

Purpose: structured issue or observation produced by a metric/tool/agent.

Suggested fields:

- `id`
- `run_id`
- `ai_system_capability_id`
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

`ai_system_capability_id` should be set when a finding applies to a specific
capability, such as `search_documents` or `create_support_ticket`; it can remain
null for system-wide findings.

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
