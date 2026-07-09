"""Seed the application context profile for the TechVest RAG Chatbot.

The profile content is derived from the real chatbot repository
(github.com/TechVest-Global/TechVest-Global-Chatbot-v1): a FastAPI RAG assistant
over a company knowledge base, backed by gpt-4.1-mini via Microsoft Foundry AI
and Azure AI Search, exposing POST /api/chat.

Usage:
    python -m scripts.seed_techvest_context_profile            # auto-detect the system
    python -m scripts.seed_techvest_context_profile <system_id>

Idempotent: the context profile is upserted (one per system), so re-running
overwrites with the latest values.
"""

from __future__ import annotations

import sys
from uuid import UUID

from app.db.session import engine
from app.models.ai_system import AISystem
from app.schemas.governance import ApplicationContextProfileCreate
from app.services.ai_systems import upsert_context_profile
from sqlmodel import Session, select

# Free-text names that identify the TechVest RAG chatbot system, matched
# case-insensitively when no explicit system id is supplied.
_NAME_HINTS = ("techvest rag chatbot", "techvest ai assistant", "techvest chatbot")


TECHVEST_CONTEXT_PROFILE = ApplicationContextProfileCreate(
    identity_purpose={
        "name": 'TechVest Global Chatbot v1 ("TechVest AI Assistant")',
        "type": "Enterprise RAG (Retrieval-Augmented Generation) support/knowledge chatbot",
        "purpose": (
            "Answer user questions strictly from TechVest's curated knowledge base "
            "(company services, culture, careers, offerings) with grounded, concise "
            "responses; career-intent queries are routed to a careers response."
        ),
        "domain": (
            "Investment / financial services firm specializing in responsible AI "
            "adoption — AI governance, data engineering, and analytics across the "
            "investment lifecycle."
        ),
        "intended_users": [
            "Website visitors / prospective clients",
            "Candidates asking about careers, culture, benefits",
            "General public querying company information",
        ],
        "intended_use": (
            "Informational Q&A grounded in an internal knowledge-base document "
            "(TechVest_Global_Knowledge_Base.docx) plus admin-uploaded documents "
            "(PDF/DOC/DOCX/TXT, max 10MB)."
        ),
        "out_of_scope": (
            "Personalized financial/investment advice, non-public financials, and "
            "anything not present in retrieved context (the model is instructed to decline)."
        ),
    },
    pre_model_controls={
        "input_validation": (
            "FastAPI Pydantic ChatRequest: 'message' required string; 'session_id' "
            "optional (defaults to 'default'). Uploads restricted to PDF/DOC/DOCX/TXT, 10MB max."
        ),
        "input_sanitization": (
            "No dedicated PII/profanity/prompt-injection input filter (GAP). LLM query "
            "reformulation normalizes queries but is an optimization, not a security control."
        ),
        "prompt_injection_guardrails": (
            "No dedicated injection filter (GAP). Partial mitigation: strong system prompt "
            "instructing the model to answer ONLY from provided context and not use training data."
        ),
        "retrieval_rag": {
            "knowledge_base": "TechVest_Global_Knowledge_Base.docx + admin-uploaded documents.",
            "chunking": (
                "Parent-child. Child chunks 500 chars / 100 overlap (embedded, searched); "
                "parent chunks 4000 chars / 300 overlap (returned to the LLM as context)."
            ),
            "embeddings": "text-embedding-3-large (3072 dimensions) via Microsoft Foundry AI.",
            "vector_store": "Azure AI Search, index 'techvest-documents', field 'content_vector'.",
            "retrieval_strategy": (
                "Adaptive: query reformulation + career-intent detection -> cache lookup -> "
                "sparse BM25 -> LLM context-sufficiency check -> dense vector fallback -> "
                "merge/rank -> final sufficiency check. Default top_k=3 unique parent chunks."
            ),
            "caching": "Query-response cache (chatbot_cache.json) with retrieval-method tracking.",
        },
    },
    model_configuration={
        "provider": "Microsoft Foundry AI (Azure OpenAI-compatible) via openai==1.12.0 AzureOpenAI client.",
        "llm_model": "gpt-4.1-mini",
        "embedding_model": "text-embedding-3-large",
        "api_version": "2024-02-01",
        "temperature": 0.2,
        "max_tokens": 7000,
        "deployment": (
            "Env-driven: FOUNDRY_ENDPOINT, FOUNDRY_API_KEY, "
            "FOUNDRY_LLM_DEPLOYMENT=gpt-4.1-mini, FOUNDRY_EMBEDDING_DEPLOYMENT=text-embedding-3-large."
        ),
        "system_prompt_behavior": (
            "Identity 'TechVest AI Assistant'. Hard grounding: answer ONLY from provided "
            "context, never fabricate, decline when context is insufficient. Style: max "
            "100 words, bullets for 3+ items; forbidden hedging words: typically/usually/generally."
        ),
        "auxiliary_llm_calls": (
            "Same model reused for query reformulation, context-sufficiency evaluation, and "
            "generating 3 suggested follow-up questions."
        ),
    },
    post_model_controls={
        "grounding_enforcement": (
            "Prompt-enforced only — the model verifies facts against context and declines "
            "otherwise. No separate programmatic grounding/citation validator (GAP)."
        ),
        "citations": "Context is source-tagged as '[Source: {title}]'; user responses do not render citations.",
        "refusal_behavior": (
            "On insufficient context returns: \"I don't have that specific information in my "
            "knowledge base.\" and may prompt the user to contact TechVest."
        ),
        "output_filtering": "No post-generation content moderation / PII scrubbing on output (GAP).",
        "disclaimers": "None in code — recommend a 'not financial advice / informational only' disclaimer (GAP).",
        "human_review": "None in the runtime path; oversight is limited to admins curating the knowledge base (GAP).",
        "fallback_message": (
            "On processing failure: \"I apologize, but I'm having trouble processing your "
            "request. Please try again.\""
        ),
        "career_routing": "Job-related queries bypass RAG and return an instant careers response.",
    },
    integration_context={
        "hosting": (
            "Python FastAPI served by Uvicorn (NOT Azure Functions). Chatbot on port 8000, "
            "companion upload service on port 8001."
        ),
        "primary_endpoint": {
            "method": "POST",
            "path": "/api/chat",
            "request": '{ "message": string (required), "session_id": string (optional, default "default") }',
            "response": '{ "response": string, "session_id": string, "suggested_questions": string[] }',
        },
        "other_endpoints": [
            "POST /api/clear-history",
            "GET /api/health",
            "GET / (chat UI)",
            "Upload service: POST /api/upload, POST /api/create-index, POST /api/clear-data",
        ],
        "authentication": (
            "NONE enforced in repo code (GAP). NOTE: the governance backend's TechVest target "
            "client calls this with an 'x-functions-key' header — that is a caller-side "
            "assumption not implemented server-side in this version."
        ),
        "cors": "Permissive: allow_origins=['*'], allow_credentials=True (GAP — restrict in production).",
        "upstream_systems": [
            "Microsoft Foundry AI (LLM + embeddings inference)",
            "Azure AI Search (vector + keyword retrieval)",
        ],
        "downstream_consumers": [
            "Built-in web chat widget",
            "External API clients such as the governance backend TechVest target client",
        ],
        "session_handling": (
            "In-memory dict 'conversation_store' keyed by session_id, capped at 20 messages/session; "
            "not persisted across restarts."
        ),
    },
)


def _resolve_system_id(session: Session, argv: list[str]) -> UUID:
    if len(argv) > 1:
        return UUID(argv[1])
    systems = session.exec(select(AISystem)).all()
    matches = [
        s for s in systems
        if any(hint in (s.name or "").lower() for hint in _NAME_HINTS)
    ]
    # Prefer an active (non-archived) system so duplicates/archived copies don't win.
    active = [s for s in matches if getattr(s.status, "value", s.status) != "archived"]
    if active:
        return active[0].id
    if matches:
        return matches[0].id
    raise SystemExit(
        "Could not find a TechVest RAG Chatbot system. Pass an explicit system id:\n"
        "  python -m scripts.seed_techvest_context_profile <system_id>\n"
        f"Known systems: {[(str(s.id), s.name) for s in systems]}"
    )


def main() -> None:
    with Session(engine) as session:
        system_id = _resolve_system_id(session, sys.argv)
        profile = upsert_context_profile(session, system_id, TECHVEST_CONTEXT_PROFILE)
        print(f"Seeded context profile {profile.id} for system {system_id}.")


if __name__ == "__main__":
    main()
