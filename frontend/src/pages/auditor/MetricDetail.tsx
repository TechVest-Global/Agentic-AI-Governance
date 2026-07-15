import clsx from "clsx";
import type { MetricConfigFull, MetricResult, RunMetricPlanEntry } from "@/api/governanceApi";
import { frameworkLabel, humanizeDimension, metricOutcome, type MetricOutcome } from "./clientComponents";

/**
 * MetricDetailSections — the shared, definition-first body for an expanded
 * metric, used by both the Compliance/Frameworks clause cards and the
 * Application → Metrics drawer so a metric reads identically everywhere.
 *
 * Every section is backed by a REAL backend field and hidden when that field is
 * absent — nothing is fabricated. Order is client-first: what it means → this
 * run's result → the pass bar → how it's measured → framework crosswalk →
 * evidence, with internal identifiers kept to a muted technical line last.
 */

// 44 of 51 metric configs carry this exact placeholder instead of a real
// definition (their YAML has no description). Treat it as "no definition".
const PLACEHOLDER_DESC = "Governance metric loaded from a validated YAML configuration file.";

function realDescription(config: MetricConfigFull | null): string | null {
  const d = config?.description?.trim();
  if (!d || d === PLACEHOLDER_DESC) return null;
  return d;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
}
function humanizeToken(s: string): string {
  return s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function displayToolToken(s: string | null | undefined): string | null {
  const value = s?.trim();
  if (!value || /mock|simulated|simulation|developer/i.test(value)) return null;
  return value;
}

/** Uppercase micro-label above a chip row (mirrors the mockup's chip-label). */
export function ChipLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 mt-3 text-[11.5px] font-bold uppercase tracking-[0.06em] text-slate-400 dark:text-slate-500">{children}</p>;
}

/** Soft callout box — the neutral "how to read this" panel, or a yellow gate. */
export function InfoBox({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "gate" }) {
  return (
    <div
      className={clsx(
        "rounded-lg border px-3.5 py-3 text-[14px] leading-relaxed",
        tone === "gate"
          ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100"
          : "border-hairline bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-slate-800/50 dark:text-slate-300",
      )}
    >
      {children}
    </div>
  );
}

type ChipVariant = "tool" | "framework" | "characteristic" | "default";

const CHIP_VARIANT: Record<ChipVariant, string> = {
  tool: "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-300",
  framework: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300",
  characteristic: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 dark:border-fuchsia-900/50 dark:bg-fuchsia-950/40 dark:text-fuchsia-300",
  default: "border-hairline bg-slate-100 text-slate-600 dark:border-white/10 dark:bg-slate-800/60 dark:text-slate-300",
};

function Chip({ children, variant = "default" }: { children: React.ReactNode; variant?: ChipVariant }) {
  return <span className={clsx("whitespace-nowrap rounded-full border px-2.5 py-1 text-[12.5px] font-medium", CHIP_VARIANT[variant])}>{children}</span>;
}

export function MetricDetailSections({
  metric, config, plan, showTechnicalFooter = true,
}: {
  metric: MetricResult;
  config: MetricConfigFull | null;
  plan?: RunMetricPlanEntry | null;
  showTechnicalFooter?: boolean;
}) {
  const outcome = metricOutcome(metric);
  const definition = realDescription(config);

  const score = metric.normalized_score;
  const threshold = metric.threshold;
  const scoreStr = score != null ? score.toFixed(2) : null;
  const thresholdStr = threshold != null ? threshold.toFixed(2) : null;

  // How it's measured: the intended tool + optional secondary + scoring formula.
  const scoring = (config?.scoring_config ?? {}) as Record<string, unknown>;
  const formula = asString(scoring.formula);
  const tools = Array.from(
    new Set([displayToolToken(config?.tool_name), displayToolToken(asString(scoring.secondary_tool))].filter((t): t is string => Boolean(t))),
  );

  // Framework crosswalk: framework-level ids from the config (or the run plan).
  const frameworks = config?.framework_ids?.length ? config.framework_ids : plan?.framework_ids ?? [];

  // Evidence: the expected evidence types (config) + this run's linked records.
  const meta = (config?.metadata_json ?? {}) as Record<string, unknown>;
  const evidenceRequired = asStringArray(meta.evidence_required);
  const linkedEvidence = metric.evidence_ids.length;

  // Technical (muted): owner + the tool that actually ran + engine status.
  const owner = config?.primary_agent ?? asString(meta.config_agent_owner) ?? plan?.primary_agent ?? null;
  const runTool = metric.tool_name ?? null;

  return (
    <div className="space-y-1">
      {/* what it means / result — a soft callout so the plain-language read leads */}
      <InfoBox>
        {definition && (
          <>
            <span className="font-semibold text-ink dark:text-white">What it checks:</span> {definition}
            <span className="mt-1.5 block border-t border-hairline dark:border-white/10 pt-1.5" />
          </>
        )}
        <span className="font-semibold text-ink dark:text-white">This run:</span> {resultSentence(outcome, scoreStr, thresholdStr, metric.status)}
      </InfoBox>

      {thresholdStr && (
        <InfoBox tone="gate">
          <span className="font-semibold">Pass threshold:</span> this check passes when the normalized score reaches{" "}
          <span className="font-semibold">{thresholdStr}</span> or above
          {scoreStr && <> — this run scored <span className="font-semibold">{scoreStr}</span></>}.
        </InfoBox>
      )}

      {(tools.length > 0 || formula) && (
        <>
          <ChipLabel>How it's measured</ChipLabel>
          <div className="flex flex-wrap items-center gap-1.5">
            {tools.map((t) => <Chip key={t} variant="tool">{humanizeToken(t)}</Chip>)}
            {formula && <span className="text-[12.5px] text-slate-400">formula <span className="font-mono text-slate-500 dark:text-slate-400">{formula}</span></span>}
          </div>
        </>
      )}

      {frameworks.length > 0 && (
        <>
          <ChipLabel>Framework crosswalk</ChipLabel>
          <div className="flex flex-wrap gap-1.5">
            {frameworks.map((f) => <Chip key={f} variant="framework">{frameworkLabel(f)}</Chip>)}
            <Chip variant="characteristic">{humanizeDimension(config?.dimension ?? metric.dimension)}</Chip>
          </div>
        </>
      )}

      {evidenceRequired.length > 0 && (
        <>
          <ChipLabel>Evidence expected</ChipLabel>
          <div className="flex flex-wrap gap-1.5">
            {evidenceRequired.map((e) => <Chip key={e}>{humanizeToken(e)}</Chip>)}
          </div>
        </>
      )}

      {/* evidence + provenance footer — dashed, muted, like the mockup's telemetry row */}
      {showTechnicalFooter && (owner || runTool || metric.status || linkedEvidence > 0) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-t border-dashed border-hairline dark:border-white/10 pt-2.5 text-[12px] text-slate-400 dark:text-slate-500">
          <span>
            {[
              owner && `Owner: ${humanizeToken(owner)}`,
              metric.status && `Engine status: ${metric.status}`,
              linkedEvidence > 0 ? `${linkedEvidence} evidence record${linkedEvidence === 1 ? "" : "s"} sealed` : "No evidence linked",
            ].filter(Boolean).join(" · ")}
          </span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11.5px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {runTool ? `${runTool} · ${metric.metric_id}` : metric.metric_id}
          </span>
        </div>
      )}
    </div>
  );
}

function resultSentence(outcome: MetricOutcome, score: string | null, threshold: string | null, status: string): string {
  if (outcome === "passed") {
    return score && threshold ? `Scored ${score} against a ${threshold} threshold — this check passed.` : "This check passed.";
  }
  if (outcome === "failed") {
    return score && threshold ? `Scored ${score} against a ${threshold} threshold — below the bar, so it did not pass.` : "This check did not meet its threshold.";
  }
  return `The engine returned "${status || "no decisive result"}", so this check needs review.`;
}
