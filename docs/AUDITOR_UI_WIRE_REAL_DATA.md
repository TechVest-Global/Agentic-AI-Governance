# Build note — wire the auditor side to the REAL engine data (verdict, metrics, clause-level compliance)

## Context
We inspected the developer side. The backend already produces rich, correct governance data. The auditor/client UI is (a) mistranslating some of it and (b) not using compliance data that already exists. This is a **presentation-layer task only** — no backend, no engine, no developer-side screens, no shared components/hooks/types (wrap + flag if needed). Same shared-auth safety rules as before.

## Ground truth confirmed on the developer side (app: TechVest AI Chatbot, run 20031901)
- **Metric Results:** TOTAL 7, PASSED 0, FAILED 7. Every metric normalized_score ≈ 0.30 vs thresholds 0.8–0.9. Rule: **a metric passes when `normalized_score >= threshold`**; `failed/error` → failed; `pending/skipped` → needs review. (So the real state is metrics FAILING, not passing. The auditor tab previously showed 1.00/passed — that was the bug.)
- **Catalog (Metrics Configuration):** 51 metrics, 51 enabled, **17 dimensions**. Each metric has dimension, primary agent, tool, framework mappings, threshold rules, scoring config.
- **Verdict:** confidence **34%**, tier **human_review**, label **blocked**, reason insufficient evidence (n=1 sample, council loop exhaustion). Score composition: started 100%, −13 bias, −8 drift, −4 compliance gaps. This is UNRESOLVED UNCERTAINTY, **not** a compliance failure.
- **Compliance Reports (already clause-level!):** per-framework clause tables across EU AI Act, NIST AI RMF, ISO 42001, OWASP LLM Top 10, with Passing/Partial/Failing counts and per-clause rows like `AIMS-OPERATIONS — Operational controls... Fail — 0 passed / 3 failed / 0 pending / 0 findings`. Exports PDF/JSON/CSV.
- **Framework Mapping:** each control maps to specific metrics (e.g. AIMS-OPERATIONS → GOV-M002/M004/M007) and evidence requirements (`metric_result`, `governance_state_entry`).
- **Findings:** 8 total, 1 high, 8 open; some informational/positive.

## Guiding principle
The developer screens have the RIGHT DATA in the WRONG VOICE (dense, technical, dark, raw scores/agent names/thresholds — for an ML engineer). The auditor side must present the SAME data in a calm, plain-language, client voice. Do not invent data; re-voice what exists.

## Investigate first (edit nothing; report back, then wait for approval)
For app TechVest, print the exact backend responses + field names the auditor side can call for:
1. per-metric results (id, dimension, status, raw_score, normalized_score, threshold, passed, evidence ref),
2. dimension grouping (how 51 metrics map to the 17 dimensions),
3. verdict object (confidence, tier, label, score composition),
4. **clause-level compliance** (the data behind developer "Compliance Reports": per framework → clauses → status + passed/failed/pending/findings counts + clause definition + evidence),
5. framework→control→metric mapping.
Identify the endpoints for each. If the auditor API layer can't reach one that the developer side uses, flag it as a Backend change request (do NOT call developer-only internals directly if they're out of the auditor's role scope — confirm access rules).

## Fixes / builds (after approval)

### 1. Verdict translation (correctness — priority)
Map the real verdict, don't collapse to "Not compliant":
- pass/compliant → **Compliant**
- conditional → **Conditional**
- fail/not_compliant → **Not compliant**
- label `blocked` / tier `human_review` / insufficient evidence → **Under review** (neutral, not red) with plain text: "The assessment couldn't reach a confident decision (low sample size) and is pending human review." Use the real backend fields — confirm names in step 3.

### 2. Metrics tab (read real pass/fail)
- Compute pass/fail as `normalized_score >= threshold` per metric from the real result field — NOT from the verdict.
- Dimension roll-ups (passed/total) and the summary count must reflect real outcomes (currently failing) and all agree with each other and the tab badge.
- Give each dimension row an expandable clean table matching the developer Metric Results columns but client-voiced: metric name, status chip (Passed/Failed/Needs review), score vs threshold (e.g. "0.30 / 0.80"), evidence link. Keep raw agent/tool names out of the default view (optional "details").
- Reconcile the metric count with reality: if the catalog is 51 but this run scored 7, show "7 of 51 assessed this run" rather than implying all 51 ran.

### 3. Auditor Compliance — rebuild on the EXISTING clause-level data (the big one)
Replace the thin 2-row auditor Compliance page with the real clause-level model the backend already returns:
- **Matrix** (framework rows × application columns) of cell status derived from the clause roll-up (compliant / conditional=partial / not_compliant=failing / not_in_scope). With one app it's one column — that's fine; also support many apps (horizontal scroll or transpose when apps > ~8).
- **Single-app convenience:** when the org has one app, open Compliance directly into the clause detail rather than the sparse grid.
- **Cell → clause detail:** click a cell to open, for that app×framework, the per-clause table (clause id + title, status chip, "n passed / m failed / p pending / f findings", expandable to clause definition + mapped metrics + evidence) — exactly the data on the developer Compliance Reports screen, re-voiced. Lead with a plain-language blocking line (e.g. "Not satisfied: operational controls — 3 checks failed").
- Client voice: "clauses fully satisfied / partially satisfied / not satisfied" summary tiles (the backend already computes Passing/Partial/Failing).
- Export: reuse the backend's existing PDF/JSON/CSV export for this data; on the client side surface **Download** (secondary), and prefer the in-app **preview pane** for reading (per the Reports pattern) — no forced download to view.

### 4. Findings (if surfaced to client)
Real counts (8 total / 1 high / 8 open); don't render positive/informational findings as failures.

### 5. Consistency
Verdict pill, "what this means", metric counts, compliance summary, and findings must tell ONE story. For this app: metrics failing + verdict blocked/under-review + clauses failing → the plain-language should say the app has real gaps AND the overall assessment is pending human review — distinguish "requirements not met" from "assessment incomplete".

## Constraints
- Auditor presentation only; reuse existing endpoints/exports; no fabricated fields (flag gaps as Backend change requests, degrade gracefully).
- No `any`; align to real response shapes.
- Loading/error/empty states on every async view; a11y (keyboard matrix/tabs, aria-labels, color never sole signal).
- When done, one-line root cause per fix (field misread → field now used) + the Backend change-requests list.

Start with the investigation and the endpoint/field inventory. Do not edit until I approve the mapping — especially the verdict states and the clause-level compliance shape.
