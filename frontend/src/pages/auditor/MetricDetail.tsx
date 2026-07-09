import clsx from "clsx";
import type { MetricConfigFull, MetricResult, RunMetricPlanEntry } from "@/api/governanceApi";
import { frameworkLabel, humanizeDimension, metricOutcome, metricOutcomeMeta, type MetricOutcome } from "./clientComponents";

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

function OutcomeChip({ outcome }: { outcome: MetricOutcome }) {
  const meta = metricOutcomeMeta(outcome);
  const tone =
    outcome === "passed"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
      : outcome === "failed"
        ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
        : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300";
  return <span className={clsx("w-fit rounded-full border px-2 py-0.5 text-[11px] font-semibold", tone)}>{meta.label}</span>;
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-hairline dark:border-white/10 bg-slate-50 dark:bg-slate-800/60 px-2 py-0.5 text-[11px] text-slate-600 dark:text-slate-300">{children}</span>;
}

export function MetricDetailSections({
  metric, config, plan,
}: {
  metric: MetricResult;
  config: MetricConfigFull | null;
  plan?: RunMetricPlanEntry | null;
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
    new Set([config?.tool_name, asString(scoring.secondary_tool)].filter((t): t is string => Boolean(t))),
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
    <div className="space-y-4">
      {definition && (
        <Section label="What it means">
          <p className="text-[13px] leading-relaxed text-slate-700 dark:text-slate-300">{definition}</p>
        </Section>
      )}

      <Section label="Result this run">
        <div className="flex flex-wrap items-center gap-2">
          <OutcomeChip outcome={outcome} />
          <span className="text-[13px] text-slate-600 dark:text-slate-300">{resultSentence(outcome, scoreStr, thresholdStr, metric.status)}</span>
        </div>
      </Section>

      {thresholdStr && (
        <Section label="Pass threshold">
          <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
            This check passes when the normalized score is at or above <span className="font-semibold text-ink dark:text-white">{thresholdStr}</span>
            {scoreStr && <> — this run scored <span className="font-semibold text-ink dark:text-white">{scoreStr}</span></>}.
          </p>
        </Section>
      )}

      {(tools.length > 0 || formula) && (
        <Section label="How it's measured">
          <div className="flex flex-wrap items-center gap-1.5">
            {tools.map((t) => <Chip key={t}>{humanizeToken(t)}</Chip>)}
            {formula && <span className="text-[11px] text-slate-400">Formula: <span className="font-mono text-slate-500 dark:text-slate-400">{formula}</span></span>}
          </div>
        </Section>
      )}

      {frameworks.length > 0 && (
        <Section label="Framework crosswalk">
          <div className="flex flex-wrap gap-1.5">
            {frameworks.map((f) => <Chip key={f}>{frameworkLabel(f)}</Chip>)}
          </div>
        </Section>
      )}

      {(evidenceRequired.length > 0 || linkedEvidence > 0) && (
        <Section label="Evidence">
          {evidenceRequired.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {evidenceRequired.map((e) => <Chip key={e}>{humanizeToken(e)}</Chip>)}
            </div>
          )}
          <p className={clsx("text-[12px] text-slate-500 dark:text-slate-400", evidenceRequired.length > 0 && "mt-1.5")}>
            {linkedEvidence > 0 ? `${linkedEvidence} evidence record${linkedEvidence === 1 ? "" : "s"} sealed for this run.` : "No evidence records linked for this run."}
          </p>
        </Section>
      )}

      {(owner || runTool || metric.status) && (
        <p className="border-t border-hairline dark:border-white/10 pt-3 text-[11px] text-slate-400">
          {[
            owner && `Owner: ${humanizeToken(owner)}`,
            runTool && `Ran via ${runTool}`,
            metric.status && `Engine status: ${metric.status}`,
            `ID ${metric.metric_id}`,
          ].filter(Boolean).join(" · ")}
        </p>
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
