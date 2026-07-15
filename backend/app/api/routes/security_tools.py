from dataclasses import asdict
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlmodel import Session

from app.db.session import get_session
from app.services import security_tools as service

router = APIRouter(prefix="/security-tools")
SessionDependency = Annotated[Session, Depends(get_session)]


@router.get("")
def list_security_tools(
    session: SessionDependency,
    ai_system_id: str | None = Query(default=None),
) -> dict:
    """Live inventory of security/evaluation adapters and the current target mode.

    Reports, per adapter, whether its dependency is installed and its config is
    present — i.e. whether it would run for real or skip. When ``ai_system_id``
    is supplied, the target client is resolved for THAT system so availability
    reflects what a run against it would actually do.
    """
    target = service.target_client_mode_for_system(session, ai_system_id)
    adapters = [asdict(a) for a in service.list_adapter_status(target)]
    return {
        "target_client": target,
        "adapters": adapters,
        "summary": {
            "total": len(adapters),
            "available": sum(1 for a in adapters if a["available"]),
            "real": sum(1 for a in adapters if a["kind"] == "real"),
        },
    }


class AdapterRunRequest(BaseModel):
    ai_system_id: str | None = None


@router.post("/{adapter_key}/run")
def run_security_tool(
    adapter_key: str,
    session: SessionDependency,
    body: AdapterRunRequest | None = None,
) -> dict:
    """Run one real adapter against the live target and return the result.

    Executes the adapter through the same evaluator + target-client resolution
    the governance pipeline uses, so this is a genuine probe of the live system
    (not a mock). Non-runnable adapters (tracing/not-wired) return HTTP 422.
    """
    ai_system_id = body.ai_system_id if body else None
    return service.run_adapter(session, adapter_key, ai_system_id=ai_system_id)
