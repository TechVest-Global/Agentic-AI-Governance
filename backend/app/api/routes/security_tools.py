from dataclasses import asdict

from fastapi import APIRouter

from app.services import security_tools as service

router = APIRouter(prefix="/security-tools")


@router.get("")
def list_security_tools() -> dict:
    """Live inventory of security/evaluation adapters and the current target mode.

    Reports, per adapter, whether its dependency is installed and its config is
    present — i.e. whether it would run for real or skip. Replaces the frontend's
    hardcoded mock list.
    """
    adapters = [asdict(a) for a in service.list_adapter_status()]
    target = service.target_client_mode()
    return {
        "target_client": target,
        "adapters": adapters,
        "summary": {
            "total": len(adapters),
            "available": sum(1 for a in adapters if a["available"]),
            "real": sum(1 for a in adapters if a["kind"] == "real"),
        },
    }
