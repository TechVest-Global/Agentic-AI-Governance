# Threat Model

## Scope

This threat model covers the V1 governance backend, model/tool integrations,
evidence storage, reporting, and local/cloud deployment direction.

## Assets

- AI system records.
- ApplicationContextProfile data.
- Target model endpoint references.
- Governance model credentials.
- Target model credentials.
- Evidence packets, prompts, outputs, and traces.
- Findings, verdicts, reports, and audit ledger entries.
- Framework and metric configs.

## Trust Boundaries

- Browser/frontend to API.
- API to PostgreSQL.
- API to governance model provider.
- API to target model/application.
- API to tool wrappers.
- Backend to Azure secrets infrastructure.
- Report/evidence views to human reviewers.

## Key Threats and Controls

| Threat | Impact | Control |
| --- | --- | --- |
| Target model prompt injection influences governance reasoning | Invalid verdict or unsafe action | Separate clients, sanitize target output, wrap untrusted content, never reuse target context in governance client. |
| Agent overwrites state | Broken audit trail | Append-only GovernanceState and reducer pattern. |
| Secrets are committed or logged | Credential compromise | `.env` ignored, Azure secrets later, redacted logging. |
| Evidence contains PII | Privacy/compliance exposure | Sensitivity labels, Presidio/redaction path, retention rules. |
| Framework behavior hardcoded incorrectly | Incorrect compliance mapping | Config-driven framework loader and validation. |
| Tool wrapper stores incompatible raw output | Broken report or replay | Normalize MetricResult and EvidenceRecord. |
| Unauthorized user triggers action | Operational harm | Auth/RBAC scaffold before production, action tier controls. |
| Hash chain omitted or mutable | Tampering undetected | AuditLedgerEntry hash chain and verification endpoint. |
| Third-party model use without approval | Policy violation | Default Azure AI Foundry provider, provider allowlist. |

## AI-Specific Abuse Cases

- Jailbreak probe produces malicious text and it is treated as instruction.
- Target model leaks secrets in output.
- Target model fabricates citations that are accepted by report generation.
- Governance model overstates confidence.
- Agent consensus hides weak evidence.
- User attempts to edit or delete adverse findings.

## Required Security Backlog

- Expand target output sanitization with approved PII scanning and richer
  provider-specific redaction rules.
- Add provider allowlist.
- Add audit logging for evidence/report reads.
- Add auth scaffold before shared deployment.
- Add PII/secret scan for evidence payloads.
- Add hash-chain verification tests.
