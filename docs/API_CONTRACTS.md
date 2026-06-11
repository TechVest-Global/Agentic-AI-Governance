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

## Planned AI System Routes

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

List registered systems.

### GET `/ai-systems/{id}`

Return one system and its profile summary.

## Planned Application Context Routes

### PUT `/ai-systems/{id}/context-profile`

Create or replace the ApplicationContextProfile for an AI system.

Request:

```json
{
  "section_a": {
    "business_domain": "internal_operations",
    "primary_use_case": "employee_support_chatbot",
    "decision_impact": "advisory"
  },
  "section_b": {
    "input_validation": [],
    "pii_handling": "redacted before model call",
    "prompt_construction": "template reference"
  },
  "section_c": {
    "provider": "azure_foundry",
    "model": "deployment-name",
    "temperature": 0.0,
    "response_format": "json"
  },
  "section_d": {
    "output_filters": [],
    "human_review_triggers": []
  },
  "section_e": {
    "upstream_sources": [],
    "downstream_actions": [],
    "rollback_capability": "manual"
  }
}
```

## Planned Evaluation Run Routes

### POST `/evaluation-runs`

Create a run.

Request:

```json
{
  "ai_system_id": "uuid",
  "selected_frameworks": ["eu_ai_act"],
  "selected_metrics": ["CM-001", "CM-002"],
  "run_mode": "mock"
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

### POST `/evaluation-runs/{id}/start`

Start the run lifecycle.

### GET `/evaluation-runs/{id}/state`

Return state entries and phase summary.

Response:

```json
{
  "run_id": "uuid",
  "status": "agents_running",
  "current_phase": "specialist_agents",
  "entries": [
    {
      "sequence_number": 1,
      "entry_type": "run_created",
      "source": "api",
      "phase": "created",
      "created_at": "2026-06-11T00:00:00Z"
    }
  ]
}
```

## Planned Metric Routes

### GET `/metrics`

Return available metric configs.

### GET `/evaluation-runs/{id}/metric-plan`

Return the selected metric plan for one run.

### POST `/evaluation-runs/{id}/metrics/run`

Run metric wrappers or mock wrappers.

## Planned Evidence and Findings Routes

### GET `/evaluation-runs/{id}/evidence`

List evidence records for a run.

### GET `/evidence/{id}`

Return one evidence packet.

### GET `/evaluation-runs/{id}/findings`

Return findings for a run.

## Planned Verdict and Reporting Routes

### POST `/evaluation-runs/{id}/verdict`

Run or trigger council/verdict flow.

### GET `/evaluation-runs/{id}/verdict`

Return final verdict.

### GET `/evaluation-runs/{id}/report`

Return governance report data.

### GET `/evaluation-runs/{id}/framework-map`

Return clause/category compliance matrix.

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
