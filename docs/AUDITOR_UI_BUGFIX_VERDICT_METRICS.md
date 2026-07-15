# Bug-fix task — auditor UI is misreading backend results

## Context
The auditor/client UI you refactored is displaying results that **contradict what the backend engine actually produced**. The developer-side screens show the ground truth; the auditor side is mapping it wrong. This is a **presentation-layer bug only** — do not change the backend, the engine, or any developer-side code. Same shared-auth/shared-code rules as the refactor spec: touch auditor-scoped presentation code only.

## Ground truth (from the developer side, same app "TechVest AI Chatbot")
- **Individual metrics PASS.** The 51 metric checks return scores of 1.00 / passed. (Auditor Metrics tab wrongly shows every dimension as 0/N and summary "Metrics passed 0/51".)
- **The verdict is NOT "not compliant."** The engine's verdict agent produced: confidence **34%**, tier **human_review**, label **blocked**, reason **insufficient evidence** — low sample size (n=1) across specialist agents and council "loop exhaustion" after 3 iterations. This is *unresolved uncertainty*, not a compliance failure.
- **Findings: 8 total, 1 critical/high, 8 open** — some are positive/informational (e.g. "No Invented Facts Detected", 100% confidence). Not 51 failures.

The auditor UI is currently collapsing a **blocked / human-review / low-confidence** verdict into **"Not compliant"**, and deriving a **0/51** metric count that contradicts the passing metric data and its own "what this means" prose ("despite all metric results passing").

## Investigate first (edit nothing until you report back)
1. Find the exact backend response the auditor Application record fetches for this app. Print the real field names/values for:
   - per-metric result (the pass/fail or score for each of the 51 checks),
   - the dimension aggregate (how passed/total per dimension is or should be derived),
   - the verdict object (its status/tier/label/confidence fields — e.g. `blocked`, `human_review`, `0.34`).
2. Show me exactly where the auditor UI computes (a) the dimension pass counts / "0/51", and (b) the verdict pill text. Identify which backend field each is reading and why it produces the wrong value.
3. Report your findings and proposed fix. **Wait for approval before editing.**

## The fixes (after approval)
### 1. Metric pass-count mapping
Count per-check pass/fail from the **actual metric result field**, not from the verdict/confidence. Dimension `passed/total` and the summary `metrics passed n/51` must reflect the real metric outcomes (which are currently passing). The tab badge, dimension bars, and summary card must all read the same source and agree.

### 2. Verdict must not be mistranslated (priority)
The client-facing verdict must faithfully represent the engine's real state. A **blocked / human_review** outcome is **not** "Not compliant." Introduce a verdict state that matches the engine, e.g.:
- engine `compliant`/pass → **Compliant**
- engine `conditional` → **Conditional**
- engine `not_compliant`/fail → **Not compliant**
- engine `blocked` / tier `human_review` / insufficient-evidence → **Under review** (or "Assessment incomplete") — a distinct, neutral state, NOT red "Not compliant".
Map from the real backend verdict field. Do not invent the mapping — confirm the actual values in step 1 and mirror them. If the backend distinguishes "failed a requirement" from "couldn't decide," the UI must too.

### 3. Plain-language + counts must agree
Once 1 and 2 are fixed, the "what this means" block, the verdict pill, the metrics count, and the findings count must tell one consistent story. For a blocked/under-review app the plain-language should say the assessment needs more evidence / human review — not that the app failed requirements.

### 4. Findings (if surfaced on auditor side)
If findings show to the client, reflect real counts (8 total, 1 high, 8 open) and don't render positive/informational findings as failures.

## Constraints
- Auditor presentation layer only. No backend, no engine, no developer-side screens, no shared components/hooks/types (wrap if needed and flag).
- No fabricated fields — if the UI needs a value the response doesn't include, add it to the Backend change-requests list and degrade gracefully.
- Every affected view keeps loading/error/empty states.
- Report the root cause in one line per bug when done (which field was misread → which field it now reads).

Begin with the investigation. Do not edit until I approve the mapping.
