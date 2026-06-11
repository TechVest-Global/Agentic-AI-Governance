# GenAI Governance Engine Specification

**Status:** Draft for implementation alignment  
**Version:** 0.1  
**Primary source inputs:** Lead architecture document, project tracking workbook,
tool decision workbook, and pre-code blueprint guide  
**Current delivery target:** V1 prototype from run creation to findings, verdict,
and report

## 1. Overview and Context

The GenAI Governance Engine is an enterprise governance control plane for
actively evaluating production AI systems. It is not a passive monitoring
dashboard. The system registers AI applications, gathers application and
regulatory context, plans an audit, executes specialist evaluations, deliberates
over the results, produces a confidence-scored verdict, and preserves an
append-only audit record that can be reconstructed later.

The core problem is that production AI systems can drift, behave unfairly, leak
sensitive information, fail compliance requirements, or be manipulated through
prompt injection without producing obvious infrastructure failures. Traditional
monitoring can show latency, token volume, or basic logs; it does not reliably
answer whether the AI application is still safe, fair, explainable, compliant,
and operating within its intended boundaries.

The V1 system must give governance engineers, model owners, compliance teams,
and auditors a structured way to run an evidence-backed governance audit. It
must connect model behavior, application context, regulatory framework
requirements, findings, deliberation, verdicts, and reports into one traceable
workflow.

Canonical names:

- **System:** GenAI Governance Engine
- **Shared state:** GovernanceState
- **Primary workflow:** Governance evaluation run
- **Application profile:** ApplicationContextProfile
- **Runtime output:** Findings, verdict, action tier, report, audit ledger

## 2. Goals

V1 must achieve these outcomes:

- Provide a backend foundation that can store AI systems, evaluation runs,
  application context, evidence, findings, verdicts, and append-only state.
- Support a governance run lifecycle from registered AI system to reportable
  verdict.
- Keep governance behavior framework-driven through configuration rather than
  hardcoded regulatory logic.
- Preserve evidence and state so a run can be reconstructed after completion or
  interruption.
- Separate the governance reasoning client from the target model client.
- Provide API contracts that frontend and agent workstreams can build against.
- Produce a prototype UI and report flow that demonstrates the V1 story:
  run -> findings -> verdict -> report.

## 3. Non-Goals

V1 will not attempt to deliver:

- Full production multi-tenancy.
- SSO or enterprise RBAC beyond a scaffolded authentication direction.
- Automated remediation against real production systems.
- Legal certification that a system is compliant.
- Direct third-party model provider use without company approval.
- Kubernetes deployment.
- Full PDF report generation if JSON/HTML can satisfy the prototype milestone.
- Complete support for every listed framework and metric before the core run
  lifecycle works.

## 4. Anti-Goals

The system must actively avoid these outcomes:

- Hardcoding regulatory article references inside application code.
- Allowing one agent to overwrite another agent's output.
- Letting target model output directly influence governance LLM context without
  sanitization and boundaries.
- Treating model-generated confidence labels as authoritative over deterministic
  routing thresholds.
- Creating a workflow that depends on in-memory state for recovery-critical
  information.
- Committing local Office files, secrets, virtual environments, build output, or
  logs.

## 5. Users and Jobs To Be Done

### AI Governance Engineer

Needs to register systems, start governance runs, inspect findings, review
evidence, and approve or override proposed actions. This is the primary V1
operator.

### Model Owner

Needs to understand why a model passed, needs monitoring, requires remediation,
or needs escalation. The model owner also needs enough evidence to act on a
finding without reverse-engineering the audit.

### Compliance Officer

Needs a framework-level view of pass, partial, and fail status, with evidence
linked to clauses or control categories.

### Audit Team

Needs immutable history, lineage, and proof that records were not silently
rewritten after a decision.

### Agent/Tool Engineer

Needs stable contracts for metric configs, tool wrappers, evidence records, and
finding outputs.

### Frontend Engineer

Needs API contracts and predictable mock-to-real data shapes for systems, runs,
state, findings, verdicts, reports, and ledger views.

## 6. Key Scenarios

### Scenario A: Register a TechVest AI Application

A governance engineer registers a TechVest AI application, such as an internal
support chatbot, knowledge assistant, RAG application, or workflow assistant.
They provide the system name, owner, deployment environment, risk tier, selected
frameworks, model configuration, and the five-section
ApplicationContextProfile. The system stores the record and returns a stable ID.

Success:

- The record is persisted.
- The selected frameworks and risk tier are valid.
- The profile captures enough context for downstream run planning.

Failure handling:

- Invalid framework IDs return a validation error.
- Missing mandatory profile sections block creation.
- Secrets must not be stored in plaintext profile fields.

### Scenario B: Start a Governance Evaluation Run

The user selects a registered system and starts an evaluation run. The backend
creates an EvaluationRun and initializes GovernanceState. Later layers append
context analysis, metric results, agent findings, council outputs, verdict, and
report events.

Success:

- Run status is visible.
- Initial state exists before any agent/tool work begins.
- State changes are append-only.

Failure handling:

- If the target model is unavailable during sanity probing, the run records the
  failure and halts or degrades according to policy.
- If a later phase fails, checkpoints let the system resume or show partial
  progress.

### Scenario C: Execute Metric and Specialist Evaluation

The engine loads metric and framework configs, selects the relevant metrics for
the system type and risk tier, runs tool wrappers or mock wrappers, captures
evidence, and lets specialist agents produce findings.

Success:

- Each metric result is normalized.
- Each finding links to evidence.
- Tool-specific outputs are preserved without leaking tool complexity into the
  public API.

Failure handling:

- Tool errors become state events.
- Partial evidence is preserved.
- Missing configs fail validation before the run starts.

### Scenario D: Deliberate and Produce Verdict

The council reads all findings and evidence. Synthesis summarizes patterns,
Devil's Advocate challenges weak evidence or alternative explanations, and
Verdict calculates confidence and action tier.

Success:

- Every specialist finding is represented or explicitly marked unavailable.
- At least one objection is produced or a fallback objection is injected.
- Routing is deterministic from confidence thresholds.

Failure handling:

- If a council step fails, the run records the failed step and can resume from
  the previous checkpoint.

### Scenario E: Generate Report and Audit View

The user opens a report showing risk summary, framework mapping, findings,
evidence, council reasoning, final verdict, action tier, and audit trail.

Success:

- Report data is consistent with GovernanceState.
- Evidence IDs resolve to stored evidence packets.
- The report does not claim legal compliance beyond the evidence produced.

## 7. Functional Requirements

### System Registration

- **FR-001:** The system shall allow creation of an AI system record with name,
  owner, system type, risk tier, deployment environment, selected frameworks,
  model configuration, status, and description.
- **FR-002:** The system shall validate selected frameworks against loaded
  framework config IDs.
- **FR-003:** The system shall support retrieval of one AI system by ID.
- **FR-004:** The system shall support listing registered AI systems.

### Application Context Profile

- **FR-005:** The system shall require an ApplicationContextProfile before a
  full governance run can start.
- **FR-006:** The profile shall contain five sections: A identity and purpose,
  B pre-model business rules, C model configuration, D post-model business
  rules, and E integration context.
- **FR-007:** The profile shall distinguish model-level behavior from
  application-level business rules and guardrails.

### Evaluation Runs

- **FR-008:** The system shall create EvaluationRun records linked to an
  AISystem.
- **FR-009:** The run shall store selected frameworks, selected metrics, status,
  timestamps, current phase, and result summary.
- **FR-010:** The system shall expose run state for frontend progress views.
- **FR-011:** The system shall support checkpointing at major phase boundaries.

### GovernanceState

- **FR-012:** GovernanceState shall be append-only.
- **FR-013:** No layer or agent shall update or delete another layer's state
  entry.
- **FR-014:** GovernanceState shall contain enough data to reconstruct a run.
- **FR-015:** State entries shall include type, payload, timestamp, source,
  sequence, run ID, and previous hash or equivalent integrity reference.

### Config-Driven Governance

- **FR-016:** Metrics shall load from config files or DB-backed config records,
  not route-level hardcoding.
- **FR-017:** Framework mappings shall load from config files or DB-backed config
  records.
- **FR-018:** Invalid metric/framework config shall fail with clear validation
  errors.

### Tool and Metric Execution

- **FR-019:** Tool wrappers shall normalize outputs into MetricResult records.
- **FR-020:** Evidence records shall preserve prompts, model outputs, scores,
  thresholds, pass/fail status, tool version, trace ID, and reviewer notes where
  applicable.
- **FR-021:** V1 shall allow mock wrapper execution where a selected tool is not
  integrated yet.

### Specialist Findings

- **FR-022:** Specialist agents shall write structured Finding records.
- **FR-023:** Findings shall include severity, confidence, affected dimension,
  framework references, evidence IDs, and recommended next step.
- **FR-024:** Agents shall not directly message each other; they communicate
  through upstream state and append-only outputs.

### Deliberation and Verdict

- **FR-025:** The system shall store synthesis, objections, verdict reasoning,
  confidence score, and action tier.
- **FR-026:** Devil's Advocate shall produce at least one objection or a
  fallback objection.
- **FR-027:** Action tier routing shall be deterministic from confidence
  thresholds.

### Reporting and Audit

- **FR-028:** The system shall expose a report endpoint for a run.
- **FR-029:** The report shall include framework matrix, findings, evidence,
  verdict, and run metadata.
- **FR-030:** The audit ledger shall support integrity verification.

## 8. Non-Functional Requirements

### Security

- Secrets must come from environment variables locally and Azure secrets
  infrastructure later.
- Target model credentials and governance model credentials must be separate.
- Target model outputs must be treated as untrusted.
- Logs must not include secrets or raw sensitive payloads unless explicitly
  classified and protected.

### Privacy

- PII must be minimized in stored evidence.
- PII detection/redaction should use Microsoft Presidio or an approved utility
  where applicable.
- Retention rules must be documented before production use.

### Compliance and Auditability

- State must be reconstructable after a run.
- Findings must link to evidence.
- Reports must distinguish evidence from legal conclusions.
- Human overrides must be recorded append-only.

### Reliability

- Run state must survive process crashes.
- Major phase boundaries must checkpoint to the database.
- A failed agent/tool should degrade the run rather than erase previous state.

### Maintainability

- Backend code uses FastAPI, SQLModel, Alembic, Pydantic settings, and pytest.
- Config and tool wrappers must be modular and testable.
- New frameworks should require config authoring rather than code edits.

### Deployment Portability

- Local development uses Docker Compose PostgreSQL.
- Shared development/staging/production should move to Azure Database for
  PostgreSQL.
- Hosting target is not finalized; Container Apps is likely but not guaranteed.
- Configuration must stay environment-driven.

## 9. Constraints and Assumptions

Confirmed constraints:

- Local database workflow uses PostgreSQL through Docker Compose.
- Shared/cloud database direction is Azure Database for PostgreSQL.
- Secrets should move through Azure secrets infrastructure later.
- AI model integrations should use Azure AI Foundry by default.
- Third-party model providers require management approval.
- Frontend is locked for now except when backend integration requires changes.

Assumptions to verify:

- Exact Azure hosting service is not decided.
- Authentication and authorization requirements are not finalized.
- The first supported framework config will be a V1 subset, not every framework
  in the source materials.
- Tool integrations can begin with normalized mock wrappers before full tool
  installation.

## 10. Success Metrics

North Star:

- A governance user can run a V1 audit from registered system to findings,
  verdict, and report without manually stitching data together.

30-day indicators:

- Backend models and migrations exist for the core run lifecycle.
- API endpoints support systems, runs, state, evidence, findings, and verdict.
- Mock metric/tool wrappers produce normalized evidence and findings.

90-day indicators:

- At least one demo system can complete an end-to-end run.
- Report output can explain why the verdict was produced.
- The run can be reconstructed from stored state and evidence.

Guardrail metrics:

- No secrets committed.
- No target model output passed unsanitized into governance reasoning.
- No destructive action without deterministic tier routing and human override
  path.

## 11. Dependencies and Integrations

Internal dependencies:

- Person 2 metric catalog and framework mapping configs.
- Person 2 tool wrapper and specialist agent definitions.
- Person 3 frontend screens and report display.
- Company guidance for Azure hosting and secrets.

External/tool dependencies:

- PostgreSQL and Alembic for persistence.
- Azure AI Foundry for approved model access.
- Promptfoo, RAGAS, DeepEval, Microsoft Presidio, Garak, Evidently, and
  Langfuse as planned dimension owners or evidence utilities.

## 12. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Scope spreads across tools before core state works | Medium | High | Build normalized interfaces and mock wrappers first. |
| GovernanceState design is too weak for audit reconstruction | Medium | High | Implement append-only state and evidence IDs before agent work. |
| Framework logic becomes hardcoded | Medium | High | Add config schemas and loaders before framework-specific routes. |
| Target output injection reaches governance reasoning | Medium | High | Implement target firewall and sanitization as a first-class service. |
| Azure hosting direction changes | Medium | Medium | Keep Docker and env-driven config portable. |
| Legal compliance is overstated | Low | High | Label reports as evidence and decision support, not legal certification. |

## 13. Open Questions

- What exact Azure hosting service should V1 target?
- What is the authentication model for V1: no auth, JWT scaffold, or company
  identity provider?
- Which framework config is first: EU AI Act only, or a small combined demo
  set?
- Which tool integrations must be real for the first demo, and which can be
  mocked?
- What retention period should apply to evidence records containing sensitive
  prompts or outputs?

## 14. Glossary

- **AISystem:** A registered AI application or model-backed workflow being
  governed.
- **ApplicationContextProfile:** Five-section description of application
  purpose, business rules, model configuration, post-processing, and
  integrations.
- **EvaluationRun:** One governance audit execution for one registered system.
- **GovernanceState:** Append-only shared state and audit conveyor belt for the
  run.
- **EvidenceRecord:** Stored proof from prompts, outputs, traces, tool scores,
  human notes, or artifacts.
- **Finding:** Structured risk/compliance issue produced by a metric, tool, or
  specialist agent.
- **Verdict:** Final confidence-scored governance decision and action tier.
- **Framework:** Regulatory or control mapping such as EU AI Act, NIST AI RMF,
  ISO 42001, OECD AI Principles, OWASP LLM Top 10, or SR 11-7.
- **Target model:** The model/application being audited.
- **Governance model:** The approved model used by the governance engine for
  planning, judging, synthesis, or verdict reasoning.

## 15. Detailed Out of Scope

- Full enterprise identity integration.
- Real autonomous remediation against production systems.
- Management approval workflow for non-Azure model providers.
- Production-grade human task queue.
- Multi-tenant billing or tenant isolation.
- Legal sign-off automation.
- Real-time monitoring mode outside a run lifecycle.

## 16. Sign-Off Checklist

Before major backend implementation proceeds, the team should confirm:

- [ ] V1 data model names and relationships.
- [ ] First framework config target.
- [ ] First demo AI system type.
- [ ] Tool wrappers that must be real versus mocked.
- [ ] Azure secrets approach.
- [ ] PR workflow into `dev`.
