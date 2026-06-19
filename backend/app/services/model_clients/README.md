# Model Client Boundary

This package separates governance reasoning calls from target application/model
calls.

- `target` clients call the AI system being audited. Their outputs are
  untrusted evidence and must be sanitized/fenced before downstream use.
- `governance` clients call the approved model used by the governance engine for
  planning, synthesis, scoring support, or explanations.
- Registry functions return mock clients today so the backend can run without
  external model credentials. Azure AI Foundry clients can replace these later
  behind the same typed interfaces.

Credential values are not stored here. The registry exposes environment-variable
reference names only.

