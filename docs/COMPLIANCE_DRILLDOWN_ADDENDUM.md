# Addendum — compliance drill-down: borrow the *feel* of the reference mockup, keep our structure + real data

## What this is
A teammate shared a standalone `index.html` mockup as a **look-and-feel reference** ("I want it to feel something like this"). It is NOT a spec and NOT wired to anything — hardcoded demo data, off-design palette, invented numbers. Use it ONLY for the visual/interaction ideas listed below. Do not copy its structure, data, styling system, or navigation model. This remains a presentation-layer change in the real GovernAI auditor app, real backend data, our design system (Tailwind + shadcn/ui, flat/hairline), same shared-auth safety rules as before.

## Decision: clause-first (confirmed)
Keep our clause-first compliance flow. Do NOT switch to the reference's framework-first picker.
- One compliance page per application. Failing clauses are surfaced directly (no drill-through to reach them).
- Frameworks are **tabs** on that page (ISO 42001 / NIST AI RMF / EU AI Act / OWASP LLM Top 10), each showing its own clause list with a per-tab fail count.
- Lead with the plain-language blocking banner (the single most important failing clause).
- For a single-application org, open straight into this clause view (not a one-column matrix).

## BORROW from the reference (the "visually easy" parts the teammate liked)
1. **Expandable control/clause cards** with a **status-colored left edge** (fail = red edge, pass = green, needs-review = amber) and a chevron that rotates on open. One click expands to detail. Clean, scannable, card-based.
2. **Filter pills** across the top of the list: All / Failed / Needs review / Passed. Fast narrowing of a long clause/metric list.
3. **Roomy, calm card spacing** — generous padding, clear hierarchy, one status pill per row.
4. Inside an expanded card: show the clause definition, why it failed (plain language), the mapped metrics that checked it, and the evidence reference — as calm labeled sections (the reference's "how to evaluate / gate / evidence" grouping is a fine pattern to echo, re-voiced for a non-technical client).

## DO NOT copy from the reference
- **No framework-first navigation** — frameworks are tabs, not a picker you drill through. (We chose clause-first.)
- **No "weighted conformance %" and no verdict pill derived from a score.** The verdict is the engine's real state (Compliant / Conditional / Not compliant / **Under review** for blocked/human_review). Never invent a conformance percentage.
- **No off-design styling** — ignore its navy/blue palette, gradients, box-shadows, `-apple-system` fonts. Use our design tokens only (flat surfaces, 0.5px hairline borders, our semantic colors, no gradients/shadows).
- **No invented data** — it says "44 metrics / 10 dimensions" and simulated values. Our real backend is 51 metrics / 17 dimensions with real clause results from the existing Compliance Reports data. Use real fields only.
- **Remove any hardcoded personal identifiers** (the reference header has a real email hardcoded — do not carry anything like that over).
- Do not create a new standalone HTML file. This is an in-app change to the existing auditor Compliance view.

## Net result (what to build)
Our clause-first compliance page + framework tabs + plain-language blocking banner, rendered with the reference's *easier card interaction*: status-edge expandable cards, filter pills, calm spacing. Real data, our design system, no fake score. Everything read-only; export/preview via the existing Reports pattern.

## Order
1. Confirm the real clause data + fields feeding this view (from the existing Compliance Reports backend data) and show me the mapping. Wait for approval.
2. Rebuild the clause list as status-edge expandable cards + filter pills within the existing clause-first layout.
3. Keep the framework tabs, blocking banner, and single-app auto-open behavior.
4. Verify against the developer side that per-framework fail counts and clause attributions match what the engine returns.
