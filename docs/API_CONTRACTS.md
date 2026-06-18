# API Contracts

All V1 API routes live under `/api/v1`.

## Existing System Routes

### GET `/health`

Returns backend health.

Response:

```json
{
  "status": "healthy",
  "service": "Agentic AI Governance Engine",
  "environment": "local"
}
```

### GET `/version`

Returns backend version.

Response:

```json
{
  "version": "0.1.0"
}
```

## Implemented AI System Routes

### POST `/ai-systems`

Create an AI system record.

Request:

```json
{
  "name": "TechVest Support Chatbot",
  "description": "Internal assistant for employee support and knowledge retrieval",
  "owner": "Model Risk",
  "system_type": "chatbot",
  "risk_tier": "medium",
  "deployment_environment": "production",
  "selected_frameworks": ["nist_ai_rmf", "owasp_llm_top_10"],
  "model_provider": "azure_foundry",
  "model_name": "support-assistant",
  "model_version": "v1",
  "target_endpoint_ref": "secret-or-config-reference"
}
```

Response:

```json
{
  "id": "uuid",
  "name": "TechVest Support Chatbot",
  "status": "registered",
  "created_at": "2026-06-11T00:00:00Z"
}
```

### GET `/ai-systems`

List registered systems. Supports `offset` and `limit` query parameters. The
maximum page size is 100.

### GET `/ai-systems/{id}`

Return one registered system.

## Implemented AI System Capability Routes

### POST `/ai-systems/{id}/capabilities`

Register one callable application capability or endpoint.

Request:

```json
{
  "name": "create_support_ticket",
  "description": "Create a ticket in the support platform",
  "capability_type": "action",
  "endpoint_ref": "/api/support/tickets",
  "http_method": "POST",
  "input_schema": {
    "type": "object",
    "properties": {
      "category": {"type": "string"},
      "description": {"type": "string"}
    }
  },
  "output_schema": {"type": "object"},
  "permissions": ["support:write"],
  "side_effect_level": "write",
  "requires_human_review": true,
  "enabled": true
}
```

### GET `/ai-systems/{id}/capabilities`

List capabilities for one system. Supports `offset`, `limit`, and optional
`enabled` filtering.

### GET `/ai-systems/{id}/capabilities/{capability_id}`

Return one capability when it belongs to the specified AI system.

Capability names must be unique within a system. Duplicate creation returns
HTTP 409 with error code `RESOURCE_CONFLICT`.

## Implemented Application Context Routes

### PUT `/ai-systems/{id}/context-profile`

Create or replace the ApplicationContextProfile for an AI system.

Request:

```json
{
  "identity_purpose": {
    "business_domain": "internal_operations",
    "primary_use_case": "employee_support_chatbot",
    "decision_impact": "advisory"
  },
  "pre_model_controls": {
    "input_validation": [],
    "pii_handling": "redacted before model call",
    "prompt_construction": "template reference"
  },
  "model_configuration": {
    "provider": "azure_foundry",
    "model": "deployment-name",
    "temperature": 0.0,
    "response_format": "json"
  },
  "post_model_controls": {
    "output_filters": [],
    "human_review_triggers": []
  },
  "integration_context": {
    "upstream_sources": [],
    "downstream_actions": [],
    "rollback_capability": "manual"
  }
}
```

Context profile named areas:

| API field | Purpose |
| --- | --- |
| `identity_purpose` | Business domain, use case, users, decision impact, scale, and jurisdictions. |
| `pre_model_controls` | Input validation, PII handling, prompt construction, retrieved context, and routing. |
| `model_configuration` | Provider, model/version, prompt reference, tools, temperature, token limits, and response format. |
| `post_model_controls` | Output filtering, moderation, citation checks, fallback behavior, human review, and logging. |
| `integration_context` | Upstream sources, downstream actions, audit sinks, notifications, and rollback capability. |

### GET `/ai-systems/{id}/context-profile`

Return the context profile associated with an AI system.

## Implemented Evaluation Run Routes

### POST `/evaluation-runs`

Create a run.

Request:

```json
{
  "ai_system_id": "uuid",
  "selected_frameworks": ["eu_ai_act"],
  "selected_metrics": ["CM-001", "CM-002"],
  "created_by": "governance-user"
}
```

Response:

```json
{
  "id": "uuid",
  "ai_system_id": "uuid",
  "status": "created",
  "current_phase": "created"
}
```

### GET `/evaluation-runs`

List evaluation runs. Supports `offset`, `limit`, and optional `ai_system_id`
filter parameters. The maximum page size is 100.

### GET `/evaluation-runs/{id}`

Return one evaluation run.

## Implemented Governance State Routes

### POST `/evaluation-runs/{id}/state`

Append one immutable state entry to an evaluation run. The backend assigns the
next `sequence_number`, copies the previous entry hash into `previous_hash`, and
calculates `entry_hash`.

Request:

```json
{
  "entry_type": "context_assembled",
  "source": "context_assembly",
  "phase": "context_assembly",
  "payload": {
    "profile_loaded": true,
    "capability_count": 4
  }
}
```

Response:

```json
{
  "run_id": "uuid",
  "sequence_number": 1,
  "entry_type": "context_assembled",
  "source": "context_assembly",
  "phase": "context_assembly",
  "payload": {
    "profile_loaded": true,
    "capability_count": 4
  },
  "previous_hash": null,
  "entry_hash": "sha256..."
}
```

### GET `/evaluation-runs/{id}/state`

List state entries for one run in sequence order. Supports `offset`, `limit`,
`phase`, and `source` filters.

### GET `/evaluation-runs/{id}/state/verify`

Verify sequence continuity and hash-chain integrity for one run.

Response:

```json
{
  "valid": true,
  "entry_count": 12,
  "failed_sequence": null,
  "reason": null
}
```

## Implemented Audit Ledger Routes

### POST `/evaluation-runs/{id}/ledger`

Append one audit event to a run-scoped ledger. The backend copies the previous
ledger hash into `previous_hash` and calculates the new `entry_hash`.

Request:

```json
{
  "event_type": "metric_execution_completed",
  "actor_type": "tool",
  "actor_id": "mock_metric_runner",
  "payload": {
    "metric_results_created": 1
  }
}
```

Response:

```json
{
  "id": "uuid",
  "run_id": "uuid",
  "event_type": "metric_execution_completed",
  "actor_type": "tool",
  "actor_id": "mock_metric_runner",
  "payload": {
    "metric_results_created": 1
  },
  "previous_hash": "sha256...",
  "entry_hash": "sha256...",
  "created_at": "2026-06-11T00:00:00Z"
}
```

### GET `/evaluation-runs/{id}/ledger`

List audit ledger entries for one run. Supports `offset`, `limit`,
`event_type`, and `actor_type` filters.

### GET `/evaluation-runs/{id}/ledger/{entry_id}`

Return one ledger entry scoped to the run.

### GET `/evaluation-runs/{id}/ledger/verify`

Verify ledger hash-chain integrity for one run.

Response:

```json
{
  "valid": true,
  "entry_count": 2,
  "failed_entry_id": null,
  "reason": null
}
```

## Implemented Run Lifecycle Routes

### POST `/evaluation-runs/{id}/start`

Start the run lifecycle and move the run into context assembly.

Request:

```json
{
  "note": "Context assembly begins."
}
```

Effect:

```json
{
  "status": "context_assembly",
  "current_phase": "context_assembly",
  "started_at": "2026-06-11T00:00:00Z"
}
```

### POST `/evaluation-runs/{id}/complete`

Mark a run as completed and preserve final result summary data.

Request:

```json
{
  "result_summary": {
    "verdict": "approved"
  }
}
```

Effect:

```json
{
  "status": "completed",
  "current_phase": "action_reporting",
  "completed_at": "2026-06-11T00:00:00Z"
}
```

### POST `/evaluation-runs/{id}/fail`

Mark a run as failed and preserve error summary data.

Request:

```json
{
  "error_summary": {
    "reason": "tool timeout"
  }
}
```

### POST `/evaluation-runs/{id}/cancel`

Cancel a run and store the cancellation reason.

Request:

```json
{
  "reason": "duplicate request"
}
```

Completed, failed, and cancelled runs are terminal. Later lifecycle transition
attempts return HTTP 409 with error code `INVALID_RUN_TRANSITION`.

## Implemented Metric Config Routes

### POST `/governance-config/bootstrap`

Seed the default governance metric catalog and framework-control mappings.
This endpoint is idempotent: existing default records are skipped rather than
duplicated.

Default seed scope:

- NIST AI RMF governance, map, measure, and manage controls.
- ISO/IEC 42001 operational control mapping.
- Core governance metrics for groundedness, privacy, prompt injection,
  compliance, action safety, fairness, and monitoring/drift readiness.

Response:

```json
{
  "metrics_created": 7,
  "metrics_skipped": 0,
  "framework_mappings_created": 5,
  "framework_mappings_skipped": 0,
  "metric_ids_created": ["GOV-M001"],
  "metric_ids_skipped": [],
  "control_refs_created": ["nist_ai_rmf/1.0/GOVERN-1"],
  "control_refs_skipped": []
}
```

### POST `/metrics`

Create one governance metric definition. Metric IDs are versioned; duplicate
`metric_id` plus `version` creation returns HTTP 409 with error code
`RESOURCE_CONFLICT`.

Request:

```json
{
  "metric_id": "M01",
  "name": "Task success rate",
  "description": "Measures whether the application capability completes the task.",
  "dimension": "Task Fulfilment / Instruction Following",
  "primary_agent": "orchestrator",
  "tool_name": "promptfoo",
  "framework_ids": ["nist_ai_rmf", "iso_42001"],
  "modality": "text",
  "threshold_rules": {
    "medium_risk_minimum": 0.9,
    "high_risk_minimum": 0.95
  },
  "scoring_config": {
    "direction": "higher_is_better",
    "normalization": "ratio"
  },
  "version": "v1",
  "enabled": true
}
```

### GET `/metrics`

Return available enabled `MetricConfig` records. Filters should support
`framework_id`, `dimension`, `primary_agent`, `tool_name`, and `modality`.

Metric config shape:

```json
{
  "metric_id": "M01",
  "name": "Task success rate",
  "dimension": "Task Fulfilment / Instruction Following",
  "primary_agent": "orchestrator",
  "tool_name": "promptfoo",
  "framework_ids": ["nist_ai_rmf", "iso_42001"],
  "threshold_rules": {
    "medium_risk_minimum": 0.9,
    "high_risk_minimum": 0.95
  },
  "scoring_config": {
    "direction": "higher_is_better",
    "normalization": "ratio"
  },
  "version": "v1",
  "enabled": true
}
```

### GET `/metrics/{metric_config_id}`

Return one metric config by ID.

## Implemented Framework Mapping Routes

### POST `/framework-mappings`

Create one framework-control mapping. The tuple `framework_id`,
`framework_version`, and `control_ref` must be unique.

Request:

```json
{
  "framework_id": "nist_ai_rmf",
  "framework_name": "NIST AI RMF",
  "framework_version": "1.0",
  "control_ref": "MAP-1",
  "control_title": "Context is established",
  "control_category": "map",
  "jurisdiction": "US",
  "requirement_text": "The system context should be documented.",
  "metric_ids": ["M01", "M02"],
  "agent_names": ["orchestrator", "explainability_agent"],
  "risk_tiers": ["medium", "high"],
  "evidence_requirements": ["metric_result", "state_entry"],
  "enabled": true
}
```

### GET `/framework-mappings`

Return enabled `FrameworkMapping` records. Filters should support
`framework_id`, `framework_version`, `control_category`, `jurisdiction`, and
`risk_tier`. The API also supports `metric_id` filtering.

Framework mapping shape:

```json
{
  "framework_id": "nist_ai_rmf",
  "framework_name": "NIST AI RMF",
  "framework_version": "1.0",
  "control_ref": "MAP-1",
  "control_title": "Context is established",
  "metric_ids": ["M01", "M02"],
  "agent_names": ["orchestrator", "explainability_agent"],
  "risk_tiers": ["medium", "high"],
  "evidence_requirements": ["metric_result", "state_entry"],
  "enabled": true
}
```

### GET `/framework-mappings/{framework_mapping_id}`

Return one framework mapping by ID.

## Implemented Context Assembly Routes (Layer 1)

Layer 1 (Context Assembly) runs the deterministic log analyzer, the regulatory
ingester, and the coverage-gap detector for a run. The assembled context is
persisted append-only as a `context_assembled` GovernanceState entry (source
`context_assembly`, phase `context_assembly`) and a `context_assembly.completed`
audit-ledger entry, and the run transitions to status/phase `context_assembly`.
The full result is stored inside the state-entry payload, so a run's context can
be reconstructed from state alone.

### POST `/evaluation-runs/{id}/context-assembly`

Assemble (or re-assemble) Layer 1 context for the run. Provide representative
production/staging logs in the request; framework context is resolved from the
run's `selected_frameworks` against the seeded `FrameworkMapping` rows plus the
framework knowledge configs in `app/configs/frameworks`.

Request:

```json
{
  "logs": [
    {
      "request_category": "loan_decision",
      "demographic_group": "female",
      "jurisdiction": "US",
      "outcome": "approved",
      "modality": "text",
      "contains_pii": true,
      "flagged": false,
      "timestamp": null
    }
  ],
  "requested_by": "governance_engineer",
  "notes": "weekly audit"
}
```

Response (`201 Created`):

```json
{
  "run_id": "uuid",
  "state_sequence_number": 1,
  "state_entry_hash": "sha256-hex",
  "generated_at": "2026-06-18T17:00:00+00:00",
  "log_analysis": {
    "total_requests": 1,
    "empty": false,
    "request_category_counts": {"loan_decision": 1},
    "demographic_coverage": {"female": 1},
    "jurisdiction_coverage": {"US": 1},
    "outcome_counts": {"approved": 1},
    "modality_counts": {"text": 1},
    "pii_request_count": 1,
    "flagged_request_count": 0,
    "distinct_demographic_groups": 1,
    "observed_demographic_groups": ["female"]
  },
  "regulatory_context": {
    "selected_frameworks": ["nist_ai_rmf", "iso_42001"],
    "resolved_frameworks": ["nist_ai_rmf", "iso_42001"],
    "missing_frameworks": [],
    "control_count": 5,
    "frameworks": [
      {
        "framework_id": "nist_ai_rmf",
        "framework_name": "NIST AI Risk Management Framework",
        "framework_version": "1.0",
        "citation_format": "NIST AI RMF {framework_version} {control_ref}",
        "severity_thresholds": {"high": 0.85},
        "control_count": 4,
        "controls": [
          {"control_ref": "MAP-1", "citation": "NIST AI RMF 1.0 MAP-1", "requirement_text": "..."}
        ],
        "rubric": [{"rubric_id": "nist-map-context", "dimension": "Context"}],
        "probe_templates": [{"probe_id": "nist-probe-bias", "dimension": "Bias and Fairness"}]
      }
    ]
  },
  "coverage_gaps": [
    {
      "gap_id": "nist_ai_rmf:nist-demographic-coverage",
      "framework_id": "nist_ai_rmf",
      "category": "demographic_coverage",
      "dimension": "Bias and Fairness",
      "severity": "high",
      "description": "Missing coverage for: age_over_60, ethnicity_minority, disability.",
      "control_refs": ["MEASURE-1"],
      "recommended_probe_id": "nist-probe-bias",
      "recommended_action": "Add log samples for the missing demographic groups ...",
      "expected": ["age_over_60", "female", "ethnicity_minority", "disability"],
      "observed": ["female"]
    }
  ],
  "gap_count": 1,
  "highest_gap_severity": "high",
  "counts": {
    "log_requests": 1,
    "frameworks_resolved": 2,
    "frameworks_missing": 0,
    "regulatory_controls": 5,
    "probe_templates": 5,
    "coverage_gaps": 1
  }
}
```

Notes:

- The analyzer is deterministic: identical logs produce identical output.
- Coverage gaps are returned highest-severity first.
- Frameworks selected but unknown (no seeded controls and no knowledge config)
  appear in `regulatory_context.missing_frameworks` rather than failing the run.
- Re-assembling appends a new state entry (append-only); `GET` returns the latest.
- A run in a terminal state (`completed`/`failed`/`cancelled`) returns
  HTTP 409 `INVALID_RUN_TRANSITION`.
- A missing run returns HTTP 404 `RESOURCE_NOT_FOUND`.

### GET `/evaluation-runs/{id}/context-assembly`

Return the latest assembled context for the run, reconstructed from the most
recent `context_assembled` GovernanceState entry. Returns HTTP 404
`RESOURCE_NOT_FOUND` (resource `Context assembly`) if Layer 1 has not run yet.

The pipeline route `POST /evaluation-runs/{id}/orchestrate` also accepts an
optional `logs` array; when supplied, context assembly runs first so the state
chain progresses through phases in order.

## Implemented Metric Plan Routes

### GET `/evaluation-runs/{id}/metric-plan`

Return the concrete metric checklist for one run. The plan is computed from the
run's selected metrics/frameworks plus enabled `MetricConfig` and
`FrameworkMapping` records.

If the run has explicit `selected_metrics`, those metric IDs are used. If the
run only has selected frameworks, the backend derives metric IDs from enabled
framework mappings for those frameworks.

Response:

```json
{
  "run_id": "uuid",
  "ai_system_id": "uuid",
  "selected_frameworks": ["nist_ai_rmf"],
  "selected_metrics": ["M01"],
  "metric_count": 1,
  "control_count": 1,
  "metrics": [
    {
      "metric_config_id": "uuid",
      "metric_id": "M01",
      "name": "Task success rate",
      "dimension": "Task Fulfilment",
      "primary_agent": "orchestrator",
      "tool_name": "promptfoo",
      "framework_ids": ["nist_ai_rmf"],
      "threshold_rules": {"minimum": 0.9},
      "scoring_config": {"direction": "higher_is_better"},
      "version": "v1",
      "controls": [
        {
          "framework_id": "nist_ai_rmf",
          "framework_name": "NIST AI RMF",
          "framework_version": "1.0",
          "control_ref": "MAP-1",
          "control_title": "Context is established",
          "control_category": "map",
          "jurisdiction": "US",
          "evidence_requirements": ["metric_result"],
          "agent_names": ["orchestrator"],
          "risk_tiers": ["medium"]
        }
      ]
    }
  ]
}
```

## Implemented Mock Metric Execution Routes

### POST `/evaluation-runs/{id}/orchestrate`

Run the current backend governance pipeline in one request:

1. Build and execute the metric plan through the local mock metric runner.
2. Run selected specialist agents.
3. Run council deliberation and create the final verdict.
4. Return the consolidated governance report.

Request:

```json
{
  "mock_score": 0.92,
  "force_metric_status": null,
  "source_name": "mock_metric_runner",
  "evaluator_name": "mock",
  "agent_names": ["risk_agent", "compliance_agent"],
  "requested_by": "prakriti",
  "notes": "Run pipeline after registering the system."
}
```

If `agent_names` is omitted or `null`, all registered specialist agents run.

Response:

```json
{
  "run_id": "uuid",
  "metric_execution": {},
  "agent_run": {},
  "council": {},
  "report": {}
}
```

This endpoint is intended for local prototype/demo orchestration. Production
orchestration can later replace the mock metric runner with approved evaluator
adapters and background job execution.
`evaluator_name` selects the metric evaluator adapter. The only current adapter
is `mock`.

### POST `/evaluation-runs/{id}/metrics/run`

Execute the current metric plan with a local mock runner. This creates one
`EvidenceRecord` and one `MetricResult` per planned metric, then updates the
run phase to `metric_execution`.

Request:

```json
{
  "mock_score": 0.92,
  "force_status": null,
  "source_name": "mock_metric_runner",
  "evaluator_name": "mock"
}
```

Response:

```json
{
  "run_id": "uuid",
  "evidence_created": 1,
  "metric_results_created": 1,
  "evidence": [
    {
      "id": "uuid",
      "run_id": "uuid",
      "source_type": "mock_metric",
      "source_name": "mock_metric_runner",
      "tool_name": "promptfoo",
      "normalized_score": 0.92,
      "threshold": 0.9,
      "passed": true
    }
  ],
  "metric_results": [
    {
      "id": "uuid",
      "run_id": "uuid",
      "metric_id": "M01",
      "dimension": "Task Fulfilment",
      "tool_name": "promptfoo",
      "status": "passed",
      "evidence_ids": ["uuid"]
    }
  ]
}
```

This endpoint currently uses adapter-backed metric execution. The only current
adapter is `mock`; future adapters can register names such as `promptfoo`,
`deepeval`, `ragas`, `garak`, `presidio`, `evidently`, or `azure_foundry`.

Future real tool runners should reuse the same output tables and replace the
mock scoring logic with evaluator-specific adapters.

## Implemented Evidence and Metric Result Routes

### POST `/evaluation-runs/{id}/evidence`

Store one evidence packet for a run. Evidence may optionally link to a specific
`AISystemCapability`.

Request:

```json
{
  "ai_system_capability_id": "uuid",
  "source_type": "tool",
  "source_name": "promptfoo",
  "tool_name": "promptfoo",
  "tool_version": "0.1",
  "raw_score": 0.92,
  "normalized_score": 0.92,
  "threshold": 0.9,
  "passed": true,
  "trace_id": "trace-001",
  "sensitivity": "internal",
  "payload": {
    "case_id": "tc-001"
  }
}
```

### GET `/evaluation-runs/{id}/evidence`

List evidence records for a run. Supports `offset`, `limit`, `source_type`,
`source_name`, and `ai_system_capability_id` filters.

### GET `/evaluation-runs/{id}/evidence/{evidence_id}`

Return one evidence packet scoped to the run.

### POST `/evaluation-runs/{id}/metric-results`

Store one normalized metric result for a run. Metric results may optionally link
to a capability and should reference evidence IDs from the same run.

Request:

```json
{
  "ai_system_capability_id": "uuid",
  "metric_id": "M01",
  "dimension": "Task Fulfilment",
  "tool_name": "deepeval",
  "status": "passed",
  "raw_score": 0.97,
  "normalized_score": 0.97,
  "threshold": 0.9,
  "passed": true,
  "evidence_ids": ["uuid"]
}
```

### GET `/evaluation-runs/{id}/metric-results`

List metric results for a run. Supports `offset`, `limit`, `metric_id`,
`status`, and `ai_system_capability_id` filters.

### GET `/evaluation-runs/{id}/metric-results/{metric_result_id}`

Return one metric result scoped to the run.

## Implemented Specialist Agent Routes

### POST `/evaluation-runs/{id}/agents/run`

Run deterministic specialist-agent services against the current run context.
These services inspect the AI system, capabilities, metric results, evidence,
and existing findings, then persist new `Finding` records.

This is the backend agent-execution structure. It does not call LLM agents yet;
future Azure AI Foundry or other approved model integrations can replace or
extend the deterministic agent implementations.

Each selected agent also creates an `AgentExecution` record. This gives the
backend a durable trace of which agents ran, when they started/completed, their
status, and how many findings they created.

Available agents:

```text
bias_agent
compliance_agent
explainability_agent
risk_agent
misuse_agent
drift_agent
```

Request:

```json
{
  "agent_names": ["bias_agent", "compliance_agent"]
}
```

If `agent_names` is omitted or `null`, all registered agents run.

Response:

```json
{
  "run_id": "uuid",
  "agents_run": [
    {
      "id": "uuid",
      "agent_name": "bias_agent",
      "finding_count": 1,
      "status": "completed"
    }
  ],
  "executions": [
    {
      "id": "uuid",
      "run_id": "uuid",
      "agent_name": "bias_agent",
      "status": "completed",
      "finding_count": 1,
      "started_at": "2026-06-18T00:00:00Z",
      "completed_at": "2026-06-18T00:00:01Z",
      "error_summary": null,
      "metadata_json": {
        "execution_mode": "deterministic"
      },
      "created_at": "2026-06-18T00:00:00Z",
      "updated_at": "2026-06-18T00:00:01Z"
    }
  ],
  "findings_created": 1,
  "findings": []
}
```

### GET `/evaluation-runs/{id}/agents/executions`

Return the stored specialist-agent execution records for one run.

Response:

```json
[
  {
    "id": "uuid",
    "run_id": "uuid",
    "agent_name": "bias_agent",
    "status": "completed",
    "finding_count": 1,
    "started_at": "2026-06-18T00:00:00Z",
    "completed_at": "2026-06-18T00:00:01Z",
    "error_summary": null,
    "metadata_json": {},
    "created_at": "2026-06-18T00:00:00Z",
    "updated_at": "2026-06-18T00:00:01Z"
  }
]
```

## Implemented Finding Routes

### POST `/evaluation-runs/{id}/findings`

Store one structured specialist-agent finding for a run. Findings may link to a
specific `AISystemCapability` and should reference evidence IDs from the same
run.

Request:

```json
{
  "ai_system_capability_id": "uuid",
  "finding_type": "quality",
  "title": "Answer missed required element",
  "summary": "The response omitted the escalation policy.",
  "severity": "medium",
  "confidence": 0.82,
  "dimension": "Task Fulfilment",
  "framework_refs": ["nist_ai_rmf:map-1"],
  "evidence_ids": ["uuid"],
  "agent_name": "explainability_agent",
  "recommended_action": "Add escalation policy coverage to the prompt.",
  "status": "open",
  "payload": {
    "missing_element": "escalation_policy"
  }
}
```

### GET `/evaluation-runs/{id}/findings`

List findings for a run. Supports `offset`, `limit`, `severity`, `status`,
`agent_name`, `dimension`, and `ai_system_capability_id` filters.

### GET `/evaluation-runs/{id}/findings/{finding_id}`

Return one finding scoped to the run.

## Implemented Council Deliberation Routes

### POST `/evaluation-runs/{id}/council/deliberate`

Generate the final verdict from stored metric results and specialist-agent
findings. This endpoint creates one `Verdict` for the run. If a verdict already
exists, the backend returns HTTP 409 with error code `RESOURCE_CONFLICT`.

Decision rules:

- `approved`: no failed metrics, no pending metrics, and no open findings.
- `conditional_approval`: open low/medium findings or pending/skipped metrics.
- `blocked`: failed/error metrics or open high/critical findings.

Request:

```json
{
  "requested_by": "prakriti",
  "notes": "Deliberate after metric execution."
}
```

Response:

```json
{
  "run_id": "uuid",
  "verdict": {
    "id": "uuid",
    "run_id": "uuid",
    "confidence_score": 0.88,
    "action_tier": "supervised",
    "label": "conditional_approval",
    "synthesis": "Council decision is conditional_approval..."
  },
  "finding_count": 1,
  "open_finding_count": 1,
  "metric_result_count": 3,
  "failed_metric_count": 0,
  "pending_metric_count": 0,
  "highest_severity": "medium",
  "created_verdict": true
}
```

## Implemented Verdict Routes

### POST `/evaluation-runs/{id}/verdict`

Store one final verdict manually. Each run can have one verdict; duplicate
creation returns HTTP 409 with error code
`RESOURCE_CONFLICT`.

Request:

```json
{
  "confidence_score": 0.91,
  "action_tier": "human_review",
  "label": "conditional_approval",
  "synthesis": "The system can proceed after owner review.",
  "objections": [
    {
      "agent": "bias_agent",
      "summary": "Needs more protected-class test coverage."
    }
  ],
  "reasoning": "Most metrics passed, with one medium-risk gap.",
  "required_actions": [
    {
      "owner": "system_owner",
      "action": "Add bias coverage before production release."
    }
  ]
}
```

### GET `/evaluation-runs/{id}/verdict`

Return the final verdict for a run.

## Implemented Reporting Routes

### GET `/evaluation-runs/{id}/report`

Return a consolidated governance report for one run. This is a read-only
aggregation endpoint for frontend dashboards, lead review, and export/reporting
workflows.

Response sections:

```json
{
  "run": {},
  "ai_system": {},
  "context_profile": {},
  "capabilities": [],
  "metric_plan": {},
  "agent_executions": [],
  "evidence": [],
  "metric_results": [],
  "findings": [],
  "verdict": {},
  "state_chain": {
    "valid": true,
    "entry_count": 1,
    "failed_sequence": null,
    "reason": null
  },
  "counts": {
    "capabilities": 1,
    "planned_metrics": 1,
    "planned_controls": 1,
    "evidence": 1,
    "metric_results": 1,
    "agent_executions": 1,
    "findings": 1,
    "state_entries": 1
  }
}
```

`context_profile` and `verdict` may be `null` when they have not been created
for the run/system yet.

## Implemented Framework Compliance Map Routes

### GET `/evaluation-runs/{id}/framework-map`

Return a control-by-control compliance matrix for one run. The map uses enabled
`FrameworkMapping` records scoped to the run's selected frameworks, then attaches
matching metric results and findings.

Control status rules:

- `failed`: any mapped metric result failed, errored, or has `passed=false`.
- `not_evaluated`: no metric result exists for the control.
- `needs_review`: mapped metrics exist, but results are pending/skipped or open
  findings reference the control.
- `passed`: mapped metrics passed and no open findings reference the control.

Response:

```json
{
  "run_id": "uuid",
  "ai_system_id": "uuid",
  "selected_frameworks": ["nist_ai_rmf"],
  "control_count": 2,
  "status_counts": {
    "passed": 1,
    "failed": 0,
    "needs_review": 1,
    "not_evaluated": 0
  },
  "controls": [
    {
      "framework_id": "nist_ai_rmf",
      "framework_name": "NIST AI RMF",
      "framework_version": "1.0",
      "control_ref": "MAP-1",
      "control_title": "Context is established",
      "control_category": "map",
      "jurisdiction": "US",
      "status": "passed",
      "metric_ids": ["M01"],
      "passed_metric_count": 1,
      "failed_metric_count": 0,
      "pending_metric_count": 0,
      "finding_count": 0,
      "highest_severity": null,
      "evidence_requirements": ["metric_result"],
      "metric_results": [],
      "findings": []
    }
  ]
}
```

## Error Format

All API errors should use a consistent shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Selected framework is not available.",
    "details": {
      "framework_id": "unknown"
    }
  }
}
```

## Versioning

- V1 routes are under `/api/v1`.
- Breaking changes require a new route version.
- Internal model/config changes do not require API version changes unless
  request/response contracts change.
