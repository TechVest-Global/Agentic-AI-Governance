# Refactor spec — Auditor / client-facing assurance UI

## What this is
We have a **working** AI governance platform (GovernAI). The auditor workspace currently exists and is wired to a live FastAPI backend (findings, runs, verdicts, remediation, evidence all load — "Backend connected"). **This is a presentation-layer refactor, not a new build and not a data-layer change.** The current auditor UI is cluttered and framed as an internal reviewer *worklist*; we are reshaping it into a calm, read-only, **client-facing assurance window**. Keep all data sources, endpoints, and results exactly as they are — results are produced by the developer/backend side and only *displayed* here.

## Stack (already in place — do not change)
- Next.js (App Router) + React + TypeScript
- Tailwind CSS + shadcn/ui
- FastAPI REST backend (existing endpoints — reuse them)
- **Shared role-based auth already implemented.** The SAME login serves developers and auditors/clients. Role comes from the existing session/claim.

## CRITICAL SAFETY CONSTRAINTS — read before touching anything
1. **Shared auth, shared codebase.** A developer can sign in through the same entry point. Do **NOT** modify auth, session handling, routing guards shared with the developer side, shared API clients, shared types, or any backend code. Scope every change to the **auditor/client presentation layer only**.
2. **Before editing, map dependencies.** Identify which components, hooks, types, and utils are shared between auditor and developer sides. Anything shared is **off-limits to edit** — if the auditor UI needs a change to a shared file, create an auditor-scoped wrapper/variant instead, and flag it to me. Never refactor a shared file to suit the auditor side.
3. **Read-only over backend-owned data.** Assessment results, metrics, verdicts, and findings come from the developer/backend pipeline. This UI never writes, recomputes, or edits them. The only permitted client mutations are: request re-assessment (a *request* to the backend) and download/export a report. Everything else is display.
4. **No developer surfaces migrate here.** Remove reviewer/worklist framing from the auditor side (assignment routing, review queue, sign-off, verdict *editing*). If any of that is genuinely developer functionality living in shared code, leave it for the developer side — just stop surfacing it in the auditor UI. Do not delete developer features.

## Step 0 — investigate and plan (do this first, edit nothing)
1. Locate the current auditor workspace routes/components (the screens: Overview, My Assignments, Review Queue, AI Systems, Evidence Review, Findings Review, Verdict Review, Compliance Reports, Audit Ledger, Remediation, Notes & Queries).
2. List every backend endpoint + response type currently feeding those screens.
3. Produce a dependency map: which of those components/hooks/types are **auditor-only** (safe to change) vs **shared with developer** (off-limits).
4. Give me a written refactor plan: files to change, new auditor-scoped files, screens to retire from the auditor nav, and any shared-code changes you'd otherwise need (as requests, not edits).
**Wait for my confirmation before editing code.**

## Target design (what it should become)

### Navigation — collapse to a 3-item client structure
Replace the current ~11-item sidebar with a calm three-item rail. Everything else becomes a tab or content inside a record, or is retired from the auditor view.

```
Sidebar (auditor/client)
├── Applications     (home — the org's AI systems/apps, flat list)
├── Compliance       (framework × application matrix)
└── Reports          (list + inline preview pane)
```
Map from current → target:
- "AI Systems" → **Applications** (home, renamed to the client's mental model).
- "Evidence Review", "Findings Review", "Verdict Review" → **tabs inside an Application record**, reframed read-only (Evidence, Findings, and a plain-language Verdict on Summary) — not standalone reviewer queues.
- "Compliance Reports" → split into **Compliance** (the matrix) and **Reports** (the deliverables).
- "Audit Ledger" → keep accessible but demote to a quiet activity view (link from Reports or a footer), not a top nav item for a non-technical client.
- "My Assignments", "Review Queue", "Remediation" queue, "Notes & Queries" → **retire from the auditor client nav** (these are reviewer/ops worklist framing). Remediation *status* still shows inside a finding, read-only.

### Design principles (enforce)
- **Lead with the answer, then data.** Any "not compliant" state gets a one-sentence plain-language cause before the detail.
- **Translate jargon.** Verdicts render "Compliant / Conditional / Not compliant". Add a "what this means" plain-language block on detail views. Drop reviewer verbs (review, sign off, approve) from the client UI.
- **Layer density, don't dump.** Roll up: dimensions summarize the 44 metrics; the matrix summarizes articles. One click expands to detail. (This directly fixes the current wall-of-cards clutter.)
- **Calm, flat, enterprise.** Hairline borders, generous whitespace, no competing dense stat grids. Semantic color only, and color is **never the only signal** — pair with icon or text.
- **De-duplicate.** The current Overview repeats identical rows ("TechVest AI Chatbot" ×6); group by application, show counts, don't list the same entity repeatedly.

### Screens
**Applications (home).** Flat list + search/filter bar (verdict, risk, framework). Slim posture strip on top (apps assessed, compliant, conditional, not compliant) — a few calm stat tiles, not the current six-card grid. Each card: name, use context, VerdictPill, risk dot, framework tags, "Open →".

**Application record.** Breadcrumb + header (name + VerdictPill + risk). Top tabs: **Summary · Metrics · Evidence · Frameworks**. Footer actions: Request re-assessment (role-gated request), Export report.
- Summary: 4 calm stat tiles (verdict, metrics passed n/44, dimensions, last assessed) + "what this means" paragraph.
- **Metrics (centerpiece):** the 44 metrics rolled into our real named dimensions (below), each a row with passed/total + bar, expandable to individual checks (pass/fail). All present, layered, nothing hidden.
- Evidence: read-only list of sealed artifacts; each opens in the preview pane. (Reframe current "Evidence Review" — no review actions.)
- Frameworks: which frameworks this app is assessed against.

**Compliance.** Framework rows × application columns; each cell a colored status (compliant / conditional / not compliant / not-in-scope) with an icon. Legend + a callout naming the single blocking gap in the portfolio. Cell → detail: per-article breakdown, blocking banner first, blocking article auto-expanded, each article expandable to plain-language explanation + evidence reference. Support horizontal scroll; if apps > ~8 provide a transpose (apps-down) option.

**Reports.** Split view: list (left) + preview pane (right) — read a report in-app, download is the secondary action, never required to view. Reframe current "Compliance Reports"; the "awaiting sign-off" framing is developer/reviewer — on the client side reports are either available or in progress, not "sign these."

## OUR REAL DATA — fill these in before running
### Dimension mapping (the 44 metrics → dimensions)
```
[PASTE: real dimension names and which metrics belong to each,
 e.g.  Fairness & bias (8): demographic parity, equalized odds, disparate impact, ...
       Robustness (9): adversarial resilience, distribution shift, ...
       ... until all 44 are mapped]
```

### Real API responses (use exact field names — do not invent)
```
[PASTE one real JSON sample per endpoint the auditor UI uses, e.g.:
   GET /applications (or /ai-systems)  -> {...}
   GET /applications/{id}              -> {...}
   GET /applications/{id}/metrics      -> {...}   (the 44, however they come today)
   GET /applications/{id}/evidence     -> {...}
   GET /compliance/... (matrix)        -> {...}
   GET /compliance/{framework}/{appId} -> {...}
   GET /reports                        -> {...}
]
```
Align the new UI to these exact paths and field names. If the new design needs a field the current response lacks (e.g. a per-article `blockingSummary`, a report `previewUrl`, a dimension grouping key), **do not fabricate it** — degrade gracefully (compute client-side only if trivially derivable, otherwise hide) and add it to a "Backend change requests" list for our API team. Never edit the backend yourself.

## Constraints (hard)
- Touch only auditor/client presentation code. No auth, no shared components/hooks/types, no backend.
- Read-only except the re-assessment *request* and report *export/download*; gate the request on the existing role claim.
- Preserve every working data fetch; this is a reskin + restructure over live data.
- No `any`; align types to real responses, extend via auditor-scoped types if needed.
- Every async view: loading + error + empty states. Accessibility: keyboard-navigable tabs/matrix, aria-labels on icon-only controls, color never the sole signal.

## Refactor order (confirm each before the next)
1. Investigation + dependency map + written plan (Step 0). **Stop for my approval.**
2. Sidebar/nav collapse to the 3-item structure; retire reviewer screens from auditor nav (route-level, non-destructive to developer side).
3. Applications list + record with all 4 tabs; Metrics dimension-expansion against our real mapping (get this right).
4. Compliance matrix + cell detail (blocking banner, auto-expanded article).
5. Reports split-view + preview pane.
6. Loading/empty/error states, a11y pass, and the "Backend change requests" list.

Begin with Step 0 only. Do not edit code until I approve the plan.
