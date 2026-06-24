"""Model-backed specialist agents (Layer 3).

Each agent calls the GovernanceModelClient (Azure AI Foundry) to reason about
evidence, and optionally probes the TargetModelClient to collect new evidence.
The two clients are always kept strictly separate — target outputs are sanitized
and fenced before they are passed to the governance model as evidence.
"""
