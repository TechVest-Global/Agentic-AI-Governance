"""HR Recruitment AI Gateway target model client.

Adapts the HR application's AI Gateway (13 structured LLM endpoints under
``/api/v1/ai``) to the TargetModelClient protocol used by all specialist agents.

The HR gateway accepts:

    POST {TARGET_ENDPOINT}/<endpoint-path>
    Headers: x-api-key: <key>
    Body:    endpoint-specific JSON (see GET {TARGET_ENDPOINT}/catalog)

And responds with a self-contained audit envelope:

    {"function", "feature", "provider", "deployment", "input", "output",
     "metadata": {"latencyMs", "timestamp", "correlationId", "success"}}

Routing: ``request.endpoint_ref`` or ``request.capability_name`` selects which
HR endpoint to call (accepts the kebab-case path, the camelCase function name,
or a full path). The request body comes from ``request.metadata["payload"]``
when the probe supplies a structured body; otherwise the plain ``prompt`` is
wrapped into the endpoint's primary text field with neutral defaults for the
other required fields, so prompt-only agents still get a live response.

Activated when TARGET_ENDPOINT + TARGET_API_KEY are set and
TARGET_SYSTEM_KIND=hr_gateway.
"""

from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.request
from typing import Any
from uuid import uuid4

from app.services.model_clients.base import TargetModelRequest, TargetModelResponse
from app.services.model_clients.http_errors import enrich_http_error
from app.services.model_clients.sanitization import sanitize_target_output

logger = logging.getLogger(__name__)

_GENERIC_QUESTION = "Describe a challenging project you worked on and how you approached it."
_GENERIC_ANSWER = (
    "I broke the project into milestones, communicated blockers early, and "
    "delivered iteratively while validating each stage with stakeholders."
)
_DEFAULT_CANDIDATE: dict[str, Any] = {
    "id": "probe-candidate-1",
    "firstName": "Probe",
    "lastName": "Candidate",
    "currentTitle": "Software Engineer",
    "currentCompany": "ExampleCorp",
    "totalExperience": 4,
    "skills": ["Python", "SQL", "communication"],
    "education": [{"degree": "Bachelor's in Computer Science"}],
    "certifications": [],
    "status": "APPLIED",
}
_DEFAULT_JOB: dict[str, Any] = {
    "title": "Software Engineer",
    "department": "Engineering",
    "responsibilities": "Build and maintain software systems.",
    "qualifications": "Bachelor's degree or equivalent experience.",
    "skillsRequired": ["Python", "SQL"],
    "experienceMin": 2,
    "experienceMax": 8,
}


def _prompt_body(path: str, prompt: str) -> dict[str, Any]:
    """Build a minimal valid body for ``path`` from a plain prompt string."""
    if path == "parse-resume":
        return {"resumeText": prompt}
    if path in ("parse-job-description", "extract-jd-requirements"):
        return {"jdText": prompt}
    if path == "rank-candidates":
        return {"job": {**_DEFAULT_JOB, "description": prompt}, "candidates": [_DEFAULT_CANDIDATE]}
    if path == "deep-rank-candidates":
        return {"jdText": prompt, "candidates": [_DEFAULT_CANDIDATE]}
    if path == "format-resume":
        return {
            "currentResume": prompt,
            "targetFormat": (
                "Sections in order: Summary, Skills, Experience, Education, "
                "Certifications."
            ),
        }
    if path == "analyze-response":
        return {
            "question": {"question": _GENERIC_QUESTION, "type": "GENERAL"},
            "response": prompt,
        }
    if path == "interview-summary":
        return {"responses": [{"question": _GENERIC_QUESTION, "response": prompt, "score": 50}]}
    if path == "generate-question":
        return {"jobTitle": prompt, "questionType": "behavioral"}
    if path == "screening-qa":
        return {
            "candidateName": "Probe Candidate",
            "jobTitle": "Software Engineer",
            "jobDescription": prompt,
            "questionCount": 3,
        }
    if path == "evaluate-screening-answer":
        return {
            "question": _GENERIC_QUESTION,
            "expectedAnswer": _GENERIC_ANSWER,
            "candidateAnswer": prompt,
        }
    if path == "interview-bot/generate-questions":
        return {"resumeText": prompt, "numQuestions": 5}
    if path == "interview-bot/evaluate-answer":
        return {
            "question": _GENERIC_QUESTION,
            "expectedAnswer": _GENERIC_ANSWER,
            "userAnswer": prompt,
        }
    raise ValueError(f"Unknown HR gateway endpoint: {path}")


# camelCase function names (as registered in capabilities) → endpoint paths
_FUNCTION_TO_PATH = {
    "parseresume": "parse-resume",
    "parsejobdescription": "parse-job-description",
    "extractjdrequirements": "extract-jd-requirements",
    "rankcandidatesforjob": "rank-candidates",
    "deeprankcandidates": "deep-rank-candidates",
    "formatresume": "format-resume",
    "analyzeresponse": "analyze-response",
    "generatebotinterviewsummary": "interview-summary",
    "generatebotquestion": "generate-question",
    "generatescreeningqa": "screening-qa",
    "evaluatescreeninganswer": "evaluate-screening-answer",
    "generatequestions": "interview-bot/generate-questions",
    "evaluateanswer": "interview-bot/evaluate-answer",
}

_KNOWN_PATHS = set(_FUNCTION_TO_PATH.values())

# Default endpoint for generic prompt-only probes (bias/misuse/oversight/
# explainability text probes). analyze-response is the system's general
# free-text reasoning entry point: it accepts an arbitrary question + response
# and returns a real analysis (score, reasoning, sentiment). parse-resume was
# the previous default, but it is a strict *extractor* — any probe that is not
# literally a resume comes back as {"firstName": "Not Provided", ...} with empty
# fields, producing meaningless evidence. Behavioral probes must reach a
# reasoning endpoint, not the extractor.
_DEFAULT_PATH = "analyze-response"

# Probes that genuinely ARE a resume (resume-parsing bias/quality probes) name
# the parse-resume function explicitly; everything else defaults to reasoning.
_RESUME_PROBE_TOKENS = ("parse_resume", "parse-resume")


def _resolve_path(request: TargetModelRequest) -> str:
    for candidate in (request.endpoint_ref, request.capability_name):
        if not candidate:
            continue
        # Accept "/api/v1/ai/parse-resume", "hr:parse-resume", "parse-resume", "parseResume"
        cleaned = candidate.strip().strip("/")
        if "/ai/" in cleaned:
            cleaned = cleaned.split("/ai/", 1)[1]
        cleaned = cleaned.split(":")[-1].strip("/")
        if cleaned in _KNOWN_PATHS:
            return cleaned
        normalized = cleaned.replace("-", "").replace("_", "").replace("/", "").lower()
        if normalized in _FUNCTION_TO_PATH:
            return _FUNCTION_TO_PATH[normalized]
        # A resume-parsing probe (e.g. "parse_resume_name_signal") targets the
        # extractor even though its capability_name isn't an exact function name.
        lowered = candidate.lower()
        if any(token in lowered for token in _RESUME_PROBE_TOKENS):
            return "parse-resume"
    return _DEFAULT_PATH


class HRGatewayTargetModelClient:
    """Target model client for the HR Recruitment AI Gateway."""

    provider = "hr_ai_gateway"
    # Real structured-JSON production gateway — its 13 endpoints are text/JSON
    # only, no media in or out.
    supports_media = False

    def __init__(self, *, endpoint: str, api_key: str, timeout: float = 90.0) -> None:
        self._endpoint = endpoint.rstrip("/")
        self._api_key = api_key
        self._timeout = timeout
        self.credential_ref = "TARGET_API_KEY"

    def invoke(self, request: TargetModelRequest) -> TargetModelResponse:
        trace_id = f"target-{uuid4()}"
        start = time.monotonic()

        path = _resolve_path(request)

        structured = request.metadata.get("payload") if request.metadata else None
        if isinstance(structured, dict) and structured:
            body: dict[str, Any] = structured
        else:
            body = _prompt_body(path, request.prompt)

        req = urllib.request.Request(
            url=f"{self._endpoint}/{path}",
            data=json.dumps(body).encode(),
            headers={
                "Content-Type": "application/json",
                "x-api-key": self._api_key,
            },
            method="POST",
        )

        try:
            # Honor a per-probe timeout override — see TargetModelRequest.
            with urllib.request.urlopen(
                req, timeout=request.timeout_seconds or self._timeout
            ) as resp:
                envelope = json.loads(resp.read().decode())
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace")[:500]
            logger.error(
                "HRGatewayTargetModelClient: %s /%s failed (%s): %s",
                exc.code, path, exc.reason, detail,
            )
            raise
        except Exception as exc:
            # Carry the target's response body with the error — see
            # model_clients/http_errors.py.
            enriched = enrich_http_error(exc)
            logger.error(
                "HRGatewayTargetModelClient: request to /%s failed: %s", path, enriched
            )
            raise enriched from exc

        output = envelope.get("output")
        raw_output = output if isinstance(output, str) else json.dumps(output, ensure_ascii=False)

        latency_ms = int((time.monotonic() - start) * 1000)
        sanitized = sanitize_target_output(raw_output)
        env_meta = envelope.get("metadata") or {}

        return TargetModelResponse(
            provider=self.provider,
            endpoint_ref=path,
            raw_output=raw_output,
            sanitized_output=sanitized.text,
            trace_id=trace_id,
            latency_ms=latency_ms,
            metadata={
                "client_mode": "live",
                "capability_name": request.capability_name,
                "hr_function": envelope.get("function"),
                "hr_feature": envelope.get("feature"),
                "model": envelope.get("deployment"),
                "hr_latency_ms": env_meta.get("latencyMs"),
                "hr_correlation_id": env_meta.get("correlationId"),
                "redaction_count": sanitized.redaction_count,
                "warning_count": sanitized.warning_count,
            },
        )
