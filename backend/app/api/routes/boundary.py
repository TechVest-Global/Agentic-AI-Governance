from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.services import boundary as service

router = APIRouter(prefix="/client-boundary")


class BoundaryTestRequest(BaseModel):
    prompt: str = Field(default="", max_length=8000)


@router.get("")
def get_client_boundary() -> dict:
    """Live mode (real vs mock) + provider/credential of the two boundary clients."""
    return service.client_boundary_status()


@router.post("/test")
def run_boundary_test(payload: BoundaryTestRequest) -> dict:
    """Send a prompt to the real target model and return the sanitized + fenced
    result, using the same boundary pipeline the audit engine uses."""
    return service.run_boundary_test(payload.prompt)
