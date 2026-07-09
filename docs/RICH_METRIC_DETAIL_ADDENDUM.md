# Addendum — rich per-metric detail in expanded clause/metric cards (definition-first)

## What this is
The reference mockup shows a rich per-metric detail level (plain-language "how to evaluate", a pass threshold/"gate", the tools that measure it, and a framework crosswalk to ISO/EU AI Act/NIST/OECD). **Confirmed: our backend already returns this detail per metric.** So this is a pure presentation task — surface detail that already exists, do not hardcode a static catalog and do not load from a spreadsheet. Presentation layer only, real backend fields, our design system, same shared-auth safety rules.

## Goal
Make each expandable clause/metric card in the auditor Compliance + Metrics views as *descriptive* as the reference — but read from the real backend per-metric fields, voiced for a non-technical client, and ordered by what the client needs first.

## Investigate first (edit nothing; report the field mapping, then wait for approval)
From the existing backend per-metric payload, identify the real field names for each of:
- plain-language definition / "what it means" / how-to,
- pass threshold / gate / acceptance criteria (and threshold-per-framework if present),
- measuring tools,
- framework crosswalk (which ISO/EU/NIST/OECD control this metric maps to),
- direction flags if present (lower-is-better, decimal vs percentage),
- the metric's own result for this run (score, normalized, threshold, pass/fail, evidence ref).
Show me the mapping (reference-mockup concept → real backend field). Flag any of the above the backend does NOT actually return as a Backend change request; do not invent or hardcode it — hide that section gracefully if absent.

## Display order inside an expanded card (client-first)
1. **What it means** — the plain-language definition, FIRST and most prominent. This is the client's top priority. If the backend field is terse/technical, render it as-is (do not fabricate); keep it readable.
2. **Result** — this run's outcome: status chip (Passed / Failed / Needs review), score vs threshold (e.g. "0.30 / 0.80"), so meaning is immediately tied to how this app did.
3. **Pass threshold / gate** — what acceptable looks like, plain language.
4. **How it's measured / tools** — supporting detail, lower in the card (calm chips, not loud).
5. **Framework crosswalk** — how this metric maps across frameworks (ISO / EU AI Act / NIST / OECD), as quiet chips.
6. **Evidence** — sealed evidence reference/link (opens in the existing preview pane).
Keep raw agent names / internal tool identifiers out of the default view; they can sit at the bottom or behind an optional "technical details" toggle.

## Visual (reuse what we already agreed)
- Status-colored left edge on each card, chevron rotates on open, filter pills (All / Failed / Needs review / Passed), calm roomy spacing.
- Our design tokens only — flat, hairline borders, semantic color paired with icon/text. No navy/gradient/shadow/Apple-font styling from the reference.
- Clause-first structure with framework tabs (unchanged). Single-app org opens straight into the clause view.

## Do NOT
- Do not hardcode the metric catalog into the frontend or read it from a spreadsheet — read the backend fields that already exist.
- Do not invent any of the detail fields; if a field is missing, hide that subsection and flag it.
- No conformance % / score-derived verdict. Verdict stays the engine's real state (incl. Under review for blocked/human_review).
- No standalone HTML file — in-app change to the existing views.

## Order
1. Field mapping (reference concept → real backend field) + list of any missing fields. **Stop for approval.**
2. Build the expanded-card detail, definition-first ordering, real fields.
3. Apply the same rich card to both the Compliance clause view and the Application → Metrics tab (consistent detail everywhere a metric/clause appears).
4. Verify a couple of metrics' displayed detail against the developer side to confirm fields match reality.
