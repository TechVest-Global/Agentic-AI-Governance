from fastapi import APIRouter

from app.api.routes import (
    agents,
    ai_systems,
    audit_ledger,
    boundary,
    configs,
    council,
    evaluation_runs,
    evidence,
    findings,
    governance_state,
    security_tools,
    system,
    verdicts,
)

api_router = APIRouter()
api_router.include_router(system.router, tags=["system"])
api_router.include_router(configs.router, tags=["governance-config"])
api_router.include_router(ai_systems.router, tags=["ai-systems"])
api_router.include_router(evaluation_runs.router, tags=["evaluation-runs"])
api_router.include_router(agents.router, tags=["agents"])
api_router.include_router(council.router, tags=["council"])
api_router.include_router(audit_ledger.router, tags=["audit-ledger"])
api_router.include_router(governance_state.router, tags=["governance-state"])
api_router.include_router(evidence.router, tags=["evidence"])
api_router.include_router(findings.router, tags=["findings"])
api_router.include_router(verdicts.router, tags=["verdicts"])
api_router.include_router(security_tools.router, tags=["security-tools"])
api_router.include_router(boundary.router, tags=["client-boundary"])
