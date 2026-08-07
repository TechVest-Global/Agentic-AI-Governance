"""LangChain ``BaseChatModel`` adapters over this project's model clients.

These adapters **wrap the Gateway; they do not replace it.** Every call still
goes through ``GatewayGovernanceModelClient`` / ``GatewayTargetModelClient``,
which is where the pipeline's non-negotiable behaviour lives:

  * retry with backoff, and the distinction between retryable and non-retryable
    failures (an auth error must not be retried three times);
  * the process-wide throttle on concurrent requests into an audited system,
    plus the video-specific cap and the 429/quota-exhaustion handling;
  * capture of every call into ``llm_call_logs`` — prompt text, response text,
    token counts, estimated cost, trace id, agent attribution;
  * sanitization of target output.

Reimplementing any of that on top of a LangChain provider integration would
mean a governance system whose audit trail depends on a third-party library's
callback plumbing. Wrapping keeps the guarantees exactly where they are and
still lets graph nodes speak LangChain's interface.

**Why the target adapter refuses to hand back raw output.** Output from an
audited system is untrusted input to the governance model — it is the thing
being evaluated, and it may contain prompt injection aimed at the auditor.
``ModelBackedAgent._probe_target`` therefore sanitizes it and fences it before
it can enter a governance prompt. A chat model that returned raw target text
would make it trivially easy to skip that step by mistake, so
``TargetChatModel`` returns the SANITIZED text as content and exposes the
fenced form separately in ``response_metadata``.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, SystemMessage
from langchain_core.outputs import ChatGeneration, ChatResult

from app.services.model_clients.base import (
    GovernanceModelRequest,
    TargetModelRequest,
)
from app.services.model_clients.sanitization import (
    fence_untrusted_target_output,
    sanitize_target_output,
)


def _flatten(messages: Sequence[BaseMessage]) -> str:
    """Collapse a message list into the single prompt string the clients take.

    Both underlying clients have a one-prompt interface, and the pipeline's
    prompts come from the versioned PromptRegistry as complete strings — so
    there is no chat history to preserve here, only whatever a caller passed.
    System messages lead, matching how the registry templates are written.
    """
    system = [m for m in messages if isinstance(m, SystemMessage)]
    rest = [m for m in messages if not isinstance(m, SystemMessage)]
    parts = [str(m.content) for m in [*system, *rest] if str(m.content).strip()]
    return "\n\n".join(parts)


class GovernanceChatModel(BaseChatModel):
    """LangChain chat model backed by the approved governance reasoning model.

    ``task`` is carried through to the Gateway because it is what
    ``llm_call_logs.task`` records — the audit trail distinguishes a
    bias_analysis call from a verdict call, and losing that would flatten every
    governance call into one indistinguishable bucket.
    """

    client: Any
    task: str = "governance_reasoning"

    @property
    def _llm_type(self) -> str:
        return "governance-gateway"

    @property
    def _identifying_params(self) -> dict[str, Any]:
        return {
            "provider": getattr(self.client, "provider", None),
            "task": self.task,
        }

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        response = self.client.complete(
            GovernanceModelRequest(
                task=kwargs.get("task") or self.task,
                prompt=_flatten(messages),
                context=kwargs.get("context") or {},
                metadata=kwargs.get("metadata") or {},
            )
        )
        message = AIMessage(
            content=response.content,
            response_metadata={
                "provider": response.provider,
                "deployment_name": response.deployment_name,
                "trace_id": response.trace_id,
                "latency_ms": response.latency_ms,
                **(response.metadata or {}),
            },
        )
        return ChatResult(generations=[ChatGeneration(message=message)])


class TargetChatModel(BaseChatModel):
    """LangChain chat model that sends a probe to the AUDITED system.

    Content is the sanitized output; ``response_metadata["fenced"]`` holds the
    form that is safe to embed in a governance prompt. See this module's
    docstring for why raw output is never the content.
    """

    client: Any
    endpoint_ref: str
    capability_name: str | None = None

    @property
    def _llm_type(self) -> str:
        return "target-gateway"

    @property
    def _identifying_params(self) -> dict[str, Any]:
        return {
            "provider": getattr(self.client, "provider", None),
            "endpoint_ref": self.endpoint_ref,
        }

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        prompt = _flatten(messages)
        response = self.client.invoke(
            TargetModelRequest(
                endpoint_ref=kwargs.get("endpoint_ref") or self.endpoint_ref,
                prompt=prompt,
                capability_name=kwargs.get("capability_name") or self.capability_name,
                media=kwargs.get("media") or [],
                metadata=kwargs.get("metadata") or {},
                timeout_seconds=kwargs.get("timeout_seconds"),
            )
        )
        sanitized = sanitize_target_output(response.raw_output)
        message = AIMessage(
            content=sanitized.text,
            response_metadata={
                "provider": response.provider,
                "endpoint_ref": response.endpoint_ref,
                "trace_id": response.trace_id,
                "latency_ms": response.latency_ms,
                # The only form that may enter a governance prompt.
                "fenced": fence_untrusted_target_output(sanitized),
                "redaction_warnings": list(sanitized.warnings),
                "media": list(response.media or []),
                **(response.metadata or {}),
            },
        )
        return ChatResult(generations=[ChatGeneration(message=message)])
