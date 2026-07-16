import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useId } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock,
  MinusCircle,
  SearchCheck,
  XCircle,
} from "lucide-react";
import clsx from "clsx";

/**
 * Client-facing assurance UI kit for the refactored auditor window.
 *
 * Design rules enforced here (per the auditor-UI refactor spec):
 *  - Translate jargon: backend verdict labels render as Compliant / Conditional
 *    / Not compliant, never the raw reviewer tokens.
 *  - Color is never the only signal — every status pairs color with an icon and
 *    text label.
 *  - Calm + flat: hairline borders, generous whitespace, no dense stat grids.
 * Everything here is display-only over backend-owned data.
 */

/* ─────────────────────────────────────────────────── verdict mapping ── */

export type ClientVerdictKey =
  | "compliant"
  | "conditional"
  | "not_compliant"
  | "under_review"
  | "in_progress"
  | "not_assessed";

export type VerdictMeta = {
  key: ClientVerdictKey;
  text: string;
  Icon: LucideIcon;
  /** text + border + bg tones (light/dark) */
  tone: string;
  dot: string;
};

const VERDICT_META: Record<ClientVerdictKey, VerdictMeta> = {
  compliant: {
    key: "compliant",
    text: "Compliant",
    Icon: CheckCircle2,
    tone: "text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40",
    dot: "bg-emerald-500",
  },
  conditional: {
    key: "conditional",
    text: "Conditional",
    Icon: AlertTriangle,
    tone: "text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40",
    dot: "bg-amber-500",
  },
  not_compliant: {
    key: "not_compliant",
    text: "Not compliant",
    Icon: XCircle,
    tone: "text-red-700 dark:text-red-300 border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40",
    dot: "bg-red-500",
  },
  under_review: {
    key: "under_review",
    text: "Under review",
    Icon: SearchCheck,
    tone: "text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-900/60 bg-violet-50 dark:bg-violet-950/40",
    dot: "bg-violet-500",
  },
  in_progress: {
    key: "in_progress",
    text: "In progress",
    Icon: Clock,
    tone: "text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/40",
    dot: "bg-blue-500",
  },
  not_assessed: {
    key: "not_assessed",
    text: "Not assessed",
    Icon: CircleDashed,
    tone: "text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60",
    dot: "bg-slate-400",
  },
};

/**
 * Translate the backend verdict into the client-facing key, mirroring what the
 * engine actually produced. This is TIER-FIRST, not label-first: the engine
 * routes a verdict it can't confidently decide (low sample size, council loop
 * exhaustion) to the `human_review` action tier and stamps the label `blocked`
 * — that is *unresolved uncertainty*, NOT a compliance failure, so it maps to a
 * neutral "Under review", never red "Not compliant".
 *
 * ActionTier enum: autonomous | supervised | human_review.
 * A `blocked`/`rejected` label with a decisive tier (not human_review) is a
 * genuine "Not compliant".
 */
export function verdictToClient(
  label: string | null | undefined,
  opts: { actionTier?: string | null; hasTerminalRun?: boolean; runInFlight?: boolean } = {},
): VerdictMeta {
  const tier = (opts.actionTier ?? "").toLowerCase();
  const l = (label ?? "").toLowerCase();

  // Human-review tier = engine deferred the decision (insufficient evidence).
  if (tier === "human_review") return VERDICT_META.under_review;

  switch (l) {
    case "approved":
      return VERDICT_META.compliant;
    case "conditional_approval":
    case "conditional":
      return VERDICT_META.conditional;
    case "blocked":
    case "rejected":
      return VERDICT_META.not_compliant;
    default:
      if (opts.runInFlight) return VERDICT_META.in_progress;
      if (opts.hasTerminalRun) return VERDICT_META.under_review; // terminal run, no verdict → awaiting decision
      return VERDICT_META.not_assessed;
  }
}

export type MetricOutcome = "passed" | "failed" | "needs_review";

type MetricLike = {
  passed?: boolean | null;
  status?: string | null;
  normalized_score?: number | null;
  threshold?: number | null;
};

/**
 * The real outcome of a metric check, mirroring the engine's rule:
 *  - status failed/error            → Failed
 *  - status pending/skipped         → Needs review
 *  - otherwise a metric PASSES when `normalized_score >= threshold`.
 * The backend leaves the `passed` boolean null on many results, so we derive
 * from score-vs-threshold (falling back to `status`/`passed` when a threshold
 * isn't present). Never derived from the verdict.
 */
export function metricOutcome(r: MetricLike): MetricOutcome {
  const s = (r.status ?? "").toLowerCase();
  if (s === "failed" || s === "error") return "failed";
  if (s === "pending" || s === "skipped") return "needs_review";
  if (r.normalized_score != null && r.threshold != null) {
    return r.normalized_score >= r.threshold ? "passed" : "failed";
  }
  if (r.passed === true || s === "passed") return "passed";
  if (r.passed === false) return "failed";
  return "needs_review";
}

export function metricPassed(r: MetricLike): boolean {
  return metricOutcome(r) === "passed";
}
export function metricFailed(r: MetricLike): boolean {
  return metricOutcome(r) === "failed";
}

const OUTCOME_META: Record<MetricOutcome, { label: string; tone: string }> = {
  passed: { label: "Passed", tone: "text-emerald-600 dark:text-emerald-400" },
  failed: { label: "Failed", tone: "text-red-600 dark:text-red-400" },
  needs_review: { label: "Needs review", tone: "text-amber-600 dark:text-amber-400" },
};

export function metricOutcomeMeta(outcome: MetricOutcome) {
  return OUTCOME_META[outcome];
}

export function VerdictPill({
  meta,
  size = "md",
}: {
  meta: VerdictMeta;
  size?: "sm" | "md";
}) {
  const { Icon, text, tone } = meta;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border font-semibold",
        tone,
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-[12px]",
      )}
    >
      <Icon className={clsx(size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5")} aria-hidden />
      {text}
    </span>
  );
}

/* ──────────────────────────────────────────────────────────── risk ── */

const RISK_META: Record<string, { label: string; dot: string; text: string }> = {
  high: { label: "High risk", dot: "bg-red-500", text: "text-red-700 dark:text-red-400" },
  medium: { label: "Medium risk", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400" },
  low: { label: "Low risk", dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400" },
};

export function RiskDot({ tier, withLabel = true }: { tier: string; withLabel?: boolean }) {
  const meta = RISK_META[tier?.toLowerCase()] ?? {
    label: tier || "Unknown",
    dot: "bg-slate-400",
    text: "text-slate-500 dark:text-slate-400",
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={clsx("h-2 w-2 rounded-full", meta.dot)} aria-hidden />
      {withLabel && <span className={clsx("text-[12px] font-medium", meta.text)}>{meta.label}</span>}
    </span>
  );
}

/* ─────────────────────────────────────────────────────── stat tile ── */

export function StatTile({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "danger" | "warn" | "good";
}) {
  const valueTone =
    tone === "danger"
      ? "text-red-600 dark:text-red-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "good"
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-ink dark:text-white";
  return (
    <div className="rounded-xl border border-hairline dark:border-white/10 bg-white dark:bg-slate-900 px-4 py-3.5">
      <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className={clsx("mt-1 font-display text-[24px] leading-none", valueTone)}>{value}</p>
      {hint && <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">{hint}</p>}
    </div>
  );
}

/* ──────────────────────────────────────────────── checks donut ── */

export type ChecksSummary = { passed: number; failed: number; needsReview: number; total: number };

/**
 * A stacked ring of a run's real check outcomes (passed / needs-review /
 * failed). The centre shows the share of assessed checks that PASSED — a
 * factual ratio of the checks, NOT a synthetic conformance/compliance score
 * (honesty rule §2/§7). The authoritative status remains the VerdictPill.
 * Shared by the Applications list card and the Application record header.
 */
export function ChecksDonut({ metrics, size = 76 }: { metrics: ChecksSummary; size?: number }) {
  const { passed, failed, needsReview, total } = metrics;
  const pct = (n: number) => (total ? (n / total) * 100 : 0);
  const passPct = Math.round(pct(passed));
  const segs = [
    { pct: pct(passed), color: "#10b981" },   // emerald
    { pct: pct(needsReview), color: "#f59e0b" }, // amber
    { pct: pct(failed), color: "#ef4444" },    // red
  ];
  let acc = 0;
  return (
    <div className="relative shrink-0" style={{ height: size, width: size }}>
      <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
        <circle cx="18" cy="18" r="15.915" fill="none" className="stroke-slate-100 dark:stroke-slate-800" strokeWidth="3.4" />
        {segs.map((s, i) => {
          const el = (
            <circle
              key={i}
              cx="18" cy="18" r="15.915" fill="none"
              stroke={s.color} strokeWidth="3.4"
              pathLength={100}
              strokeDasharray={`${s.pct} ${100 - s.pct}`}
              strokeDashoffset={-acc}
            />
          );
          acc += s.pct;
          return s.pct > 0 ? el : null;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-[17px] font-semibold leading-none text-ink dark:text-white">{passPct}%</span>
      </div>
    </div>
  );
}

export function LegendRow({ color, count, label }: { color: string; count: number; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[12px] text-slate-500 dark:text-slate-400">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} aria-hidden />
      <span className="font-semibold text-ink dark:text-white tabular-nums">{count}</span>
      <span>{label}</span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── tabs ── */

export type TabDef = { id: string; label: string; count?: number };

/** Keyboard-navigable (arrow keys) tab strip. */
export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
}) {
  const groupId = useId();
  function onKeyDown(e: React.KeyboardEvent, idx: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const next = (idx + dir + tabs.length) % tabs.length;
    onChange(tabs[next].id);
    document.getElementById(`${groupId}-${tabs[next].id}`)?.focus();
  }
  return (
    <div role="tablist" aria-label="Application sections" className="flex gap-1 border-b border-hairline dark:border-white/10">
      {tabs.map((t, i) => {
        const selected = t.id === active;
        return (
          <button
            key={t.id}
            id={`${groupId}-${t.id}`}
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={clsx(
              "relative -mb-px flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors",
              selected
                ? "border-brand-500 text-ink dark:text-white"
                : "border-transparent text-slate-500 dark:text-slate-400 hover:text-ink dark:hover:text-slate-200",
            )}
          >
            {t.label}
            {typeof t.count === "number" && (
              <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ────────────────────────────────────── compliance matrix status ── */

export type MatrixStatus = "compliant" | "conditional" | "not_compliant" | "not_in_scope";

const MATRIX_META: Record<MatrixStatus, { label: string; Icon: LucideIcon; cell: string; text: string }> = {
  compliant: {
    label: "Compliant",
    Icon: CheckCircle2,
    cell: "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/50",
    text: "text-emerald-700 dark:text-emerald-300",
  },
  conditional: {
    label: "Conditional",
    Icon: AlertTriangle,
    cell: "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900/50",
    text: "text-amber-700 dark:text-amber-300",
  },
  not_compliant: {
    label: "Not compliant",
    Icon: XCircle,
    cell: "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900/50",
    text: "text-red-700 dark:text-red-300",
  },
  not_in_scope: {
    label: "Not in scope",
    Icon: MinusCircle,
    cell: "bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700",
    text: "text-slate-400 dark:text-slate-500",
  },
};

export function matrixMeta(status: MatrixStatus) {
  return MATRIX_META[status];
}

/** Roll a set of framework control statuses into one cell status. */
export function rollUpControlStatuses(
  statuses: Array<"passed" | "failed" | "needs_review" | "not_evaluated">,
): MatrixStatus {
  if (statuses.length === 0) return "not_in_scope";
  if (statuses.some((s) => s === "failed")) return "not_compliant";
  if (statuses.some((s) => s === "needs_review")) return "conditional";
  if (statuses.every((s) => s === "not_evaluated")) return "not_in_scope";
  return "compliant";
}

/* ─────────────────────────────────────────────── dimension labels ── */

/** Friendly label for a backend dimension key (dynamic grouping). */
export function humanizeDimension(dimension: string): string {
  const known: Record<string, string> = {
    "bias and fairness": "Fairness & bias",
    fairness: "Fairness & bias",
    safety: "Safety",
    security: "Security",
    privacy: "Privacy",
    groundedness: "Groundedness",
    retrieval: "Retrieval quality",
    robustness: "Robustness",
    oversight: "Human oversight",
    transparency: "Transparency",
    monitoring: "Monitoring",
    compliance: "Compliance",
    "risk controls": "Risk controls",
    task_fulfilment: "Task fulfilment",
    task_fulfillment: "Task fulfilment",
  };
  const key = dimension.trim().toLowerCase();
  return known[key] ?? dimension.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Framework id → display name for the small set we assess against. */
export function frameworkLabel(id: string): string {
  const known: Record<string, string> = {
    eu_ai_act: "EU AI Act",
    iso_42001: "ISO 42001",
    nist_ai_rmf: "NIST AI RMF",
    owasp_llm_top_10: "OWASP LLM Top 10",
    sr_11_7: "SR 11-7",
    oecd: "OECD AI Principles",
    hipaa: "HIPAA",
    mitre_atlas: "MITRE ATLAS",
  };
  return known[id.toLowerCase()] ?? id.replace(/[_-]/g, " ").toUpperCase();
}

/**
 * Auditor-friendly name for an engine tool/adapter. The auditor is shown WHAT a
 * check does ("Adversarial security probe"), not the vendor tool name (garak /
 * deepeval / ragas / …) — the lead's point: auditors don't care which library
 * produced a result. Keyed by the raw `tool_name`; unknown tools fall back to a
 * humanized token, and deterministic/mock runners collapse to "Baseline check".
 * Single source of truth used everywhere a method is shown (Metrics, Evidence,
 * Compliance, metric detail). See the Assurance Tools page for full descriptions.
 */
const TOOL_LABELS: Record<string, string> = {
  garak: "Adversarial security probe",
  pyrit: "Red-team attack simulation",
  presidio: "Privacy & PII scan",
  deepeval: "AI safety & quality judge",
  ragas: "Grounding & citation check",
  inspect_ai: "Agent tool-use safety check",
  vision: "Visual content safety check",
  audio: "Voice & transcription check",
  langfuse: "Operational monitoring",
  evidently: "Stability & drift monitoring",
  promptfoo: "Scenario prompt test",
};

export function toolLabel(tool: string | null | undefined): string {
  const raw = (tool ?? "").trim();
  if (!raw) return "—";
  if (/mock|simulated|simulation|developer|threshold|metric_execution_engine|metric_runner/i.test(raw)) {
    return "Baseline check";
  }
  const key = raw.toLowerCase().replace(/[\s-]+/g, "_");
  return TOOL_LABELS[key] ?? raw.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ───────────────────────────────────────── control evidence + status ── */
// Per AUDITOR_MASTER_SPEC §2: distinguish how a control is evidenced (Automated
// by our metrics / Manual documentary / Not applicable) from its status. Honesty
// rule — a control with no automated metric must read "manual evidence required",
// never auto-green or metric-red.

export type EvidenceType = "automated" | "manual" | "not_applicable";
export type ControlStatus = "satisfied" | "partial" | "not_satisfied" | "manual" | "not_applicable";

/** A control is automated when at least one runtime metric maps to it. */
export function controlEvidenceType(hasMappedMetrics: boolean): EvidenceType {
  return hasMappedMetrics ? "automated" : "manual";
}

/** Map an automated control's roll-up status to the client control-status vocab. */
export function controlStatusFrom(
  clauseStatus: "passed" | "failed" | "needs_review" | "not_evaluated",
  evidence: EvidenceType,
): ControlStatus {
  if (evidence === "manual") return "manual";
  if (evidence === "not_applicable") return "not_applicable";
  switch (clauseStatus) {
    case "passed": return "satisfied";
    case "failed": return "not_satisfied";
    case "needs_review": return "partial";
    default: return "partial";
  }
}

const EVIDENCE_META: Record<EvidenceType, { label: string; cls: string }> = {
  automated: { label: "Automated", cls: "border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-900/60 dark:bg-brand-950/40 dark:text-brand-300" },
  manual: { label: "Manual evidence", cls: "border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  not_applicable: { label: "Not applicable", cls: "border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500" },
};

export function EvidenceTypeBadge({ type }: { type: EvidenceType }) {
  const m = EVIDENCE_META[type];
  return <span className={clsx("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]", m.cls)}>{m.label}</span>;
}

const CONTROL_STATUS_META: Record<ControlStatus, { label: string; Icon: LucideIcon; tone: string }> = {
  satisfied: { label: "Satisfied", Icon: CheckCircle2, tone: "text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/60" },
  partial: { label: "Partial", Icon: Clock, tone: "text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900/60" },
  not_satisfied: { label: "Not satisfied", Icon: XCircle, tone: "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900/60" },
  manual: { label: "Manual evidence required", Icon: CircleDashed, tone: "text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700" },
  not_applicable: { label: "Not applicable", Icon: MinusCircle, tone: "text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800" },
};

export function controlStatusMeta(status: ControlStatus) {
  return CONTROL_STATUS_META[status];
}

export function ControlStatusPill({ status }: { status: ControlStatus }) {
  const m = CONTROL_STATUS_META[status];
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold", m.tone)}>
      <m.Icon className="h-3 w-3" aria-hidden />
      {m.label}
    </span>
  );
}
