import { useEffect, useId, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { listMetricConfigs, type FrameworkControlAssessment, type MetricConfigFull, type MetricResult } from "@/api/governanceApi";
import { frameworkLabel, humanizeDimension, metricOutcome, type MetricOutcome } from "./clientComponents";
import { InfoBox, MetricDetailSections } from "./MetricDetail";

const OUTCOME_PILL: Record<MetricOutcome, { label: string; cls: string; dot: string; edge: string }> = {
  passed: { label: "Passed", cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300", dot: "bg-emerald-500", edge: "border-l-emerald-400" },
  failed: { label: "Failed", cls: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300", dot: "bg-red-500", edge: "border-l-red-400" },
  needs_review: { label: "Needs review", cls: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300", dot: "bg-amber-500", edge: "border-l-amber-400" },
};

/**
 * FrameworkExplorer — the app-scoped, framework-routed compliance view shared by
 * the Compliance page and the Application record. The auditor first sees the
 * frameworks that assessed the app as a grid of cards and picks one; selecting a
 * framework drills into its clauses (status-edge cards that expand to the clause
 * definition, why it failed, the metric checks that assessed it, and evidence).
 * A lateral framework switcher + "back to frameworks" keep movement cheap.
 *
 * Data-in only: the caller supplies the framework list and a controlsFor(fw)
 * accessor. All clause/metric copy comes from real engine output — not the
 * reference mockup's simulated blurbs.
 */

type StatusFilter = "all" | "failed" | "needs_review" | "passed";
type ClauseStatus = FrameworkControlAssessment["status"];

const STATUS_UI: Record<ClauseStatus, { label: string; edge: string; text: string; bg: string }> = {
  failed: { label: "Not satisfied", edge: "border-l-red-500", text: "text-red-700 dark:text-red-300", bg: "bg-red-50 dark:bg-red-950/40" },
  needs_review: { label: "Needs review", edge: "border-l-amber-500", text: "text-amber-700 dark:text-amber-300", bg: "bg-amber-50 dark:bg-amber-950/40" },
  passed: { label: "Satisfied", edge: "border-l-emerald-500", text: "text-emerald-700 dark:text-emerald-300", bg: "bg-emerald-50 dark:bg-emerald-950/40" },
  not_evaluated: { label: "Not evaluated", edge: "border-l-slate-300 dark:border-l-slate-600", text: "text-slate-500 dark:text-slate-400", bg: "bg-slate-50 dark:bg-slate-800/50" },
};

const FILTER_ORDER: StatusFilter[] = ["all", "failed", "needs_review", "passed"];
const FILTER_LABEL: Record<StatusFilter, string> = { all: "All", failed: "Failed", needs_review: "Needs review", passed: "Passed" };
const CONTROL_SORT: Record<ClauseStatus, number> = { failed: 0, needs_review: 1, passed: 2, not_evaluated: 3 };

/**
 * Factual, framework-level descriptions of what each standard governs. Genuine
 * descriptions of real public frameworks — not fabricated data / not the mockup's
 * invented blurbs — to give the auditor context when choosing a framework.
 */
const FRAMEWORK_DESC: Record<string, string> = {
  eu_ai_act: "EU regulation for high-risk AI — risk management, transparency, human oversight and technical documentation.",
  iso_42001: "International standard for an AI management system (AIMS) — governance, controls and continual improvement.",
  nist_ai_rmf: "US voluntary framework organised around four functions: Govern, Map, Measure, Manage.",
  owasp_llm_top_10: "The ten most critical security risks for LLM applications, from prompt injection to data leakage.",
  sr_11_7: "US supervisory guidance on model risk management — development, validation and governance.",
  oecd: "Intergovernmental principles for trustworthy AI.",
  hipaa: "US health-data privacy and security rules.",
  mitre_atlas: "Adversarial threat landscape for AI systems.",
};

export function frameworkDesc(id: string): string {
  return FRAMEWORK_DESC[id.toLowerCase()] ?? "Framework controls assessed against this application.";
}

/**
 * How each framework organises the SAME underlying checks — its control
 * structure. Shown as the card eyebrow so the auditor sees that the frameworks
 * are lenses over one evidence set, not separate assessments.
 */
const FRAMEWORK_LENS: Record<string, string> = {
  eu_ai_act: "Grouped by article",
  iso_42001: "Grouped by control objective",
  nist_ai_rmf: "Grouped by function",
  oecd: "Grouped by principle",
  owasp_llm_top_10: "Grouped by risk category",
  sr_11_7: "Grouped by control area",
  hipaa: "Grouped by safeguard",
  mitre_atlas: "Grouped by tactic",
};

function frameworkLens(id: string): string {
  return FRAMEWORK_LENS[id.toLowerCase()] ?? "Grouped by control";
}

/** The honest "same underlying checks, organised per framework" explainer. */
export function FrameworkIntro() {
  return (
    <div className="rounded-xl border border-brand-200/70 dark:border-brand-900/50 bg-brand-50/50 dark:bg-brand-950/20 px-4 py-3 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
      Every framework below is assessed from the <strong className="font-semibold text-ink dark:text-white">same underlying metric checks</strong> for this
      application — each one simply organises those checks under its own control structure (clauses, articles, functions or principles). Pick a framework to see its clauses.
    </div>
  );
}

export function FrameworkExplorer({
  frameworks,
  controlsFor,
  intro = true,
  heading,
}: {
  frameworks: string[];
  controlsFor: (fw: string) => FrameworkControlAssessment[];
  /** Show the "same underlying checks" explainer above the grid. */
  intro?: boolean;
  /**
   * Optional app header for the grid landing: name + subtitle and an HONEST
   * headline stat — the share of assessed checks that PASSED (a real ratio, not
   * a synthetic "weighted conformance" score, per spec §7). If `checksPassed`
   * is omitted it's derived from the framework-mapped metric results.
   */
  heading?: { name?: string; subtitle?: string; checksPassed?: { passed: number; total: number } };
}) {
  // Which framework's clause detail is open. null = show the framework grid.
  const [selectedFw, setSelectedFw] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [catalog, setCatalog] = useState<MetricConfigFull[]>([]);

  useEffect(() => {
    let cancelled = false;
    listMetricConfigs({ limit: 200 }).then((c) => { if (!cancelled) setCatalog(c); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // If the chosen framework leaves the list (e.g. app switch), drop to the grid.
  useEffect(() => {
    if (selectedFw && !frameworks.includes(selectedFw)) setSelectedFw(null);
  }, [frameworks, selectedFw]);

  const controlsByFw = useMemo(() => {
    const map = new Map<string, FrameworkControlAssessment[]>();
    for (const fw of frameworks) map.set(fw, controlsFor(fw));
    return map;
  }, [frameworks, controlsFor]);

  const catalogById = useMemo(() => {
    const map = new Map<string, MetricConfigFull>();
    for (const c of catalog) map.set(c.metric_id, c);
    return map;
  }, [catalog]);

  const allControls = useMemo(
    () => frameworks.flatMap((fw) => controlsByFw.get(fw) ?? []),
    [frameworks, controlsByFw],
  );

  const summary = useMemo(() => ({
    total: allControls.length,
    satisfied: allControls.filter((c) => c.status === "passed").length,
    partial: allControls.filter((c) => c.status === "needs_review").length,
    notSatisfied: allControls.filter((c) => c.status === "failed").length,
  }), [allControls]);

  const blocking = useMemo(() => {
    for (const fw of frameworks) {
      const failed = (controlsByFw.get(fw) ?? []).find((c) => c.status === "failed");
      if (failed) return { fw, control: failed };
    }
    return null;
  }, [frameworks, controlsByFw]);

  // Per-framework counts are of the real METRIC CHECKS the framework's controls
  // were assessed by (deduped across its controls) — the same evidence set,
  // organised under this framework. `manual` = controls with no automated metric
  // (documentary evidence), shown honestly rather than hidden (§2).
  function frameworkStats(fw: string) {
    const controls = controlsByFw.get(fw) ?? [];
    const seen = new Set<string>();
    let passed = 0;
    let failed = 0;
    let needsReview = 0;
    for (const c of controls) {
      for (const mr of c.metric_results ?? []) {
        if (seen.has(mr.metric_id)) continue;
        seen.add(mr.metric_id);
        const o = metricOutcome(mr);
        if (o === "passed") passed += 1;
        else if (o === "failed") failed += 1;
        else needsReview += 1;
      }
    }
    const manual = controls.filter((c) => (c.metric_ids?.length ?? 0) === 0).length;
    return { assessed: controls.length, passed, failed, needsReview, manual };
  }

  // App-wide checks-passed ratio for the header stat: distinct metric checks
  // across every framework-mapped control (falls back to caller-supplied count).
  const appChecks = useMemo(() => {
    if (heading?.checksPassed) return heading.checksPassed;
    const seen = new Set<string>();
    let passed = 0;
    for (const fw of frameworks) {
      for (const c of controlsByFw.get(fw) ?? []) {
        for (const mr of c.metric_results ?? []) {
          if (seen.has(mr.metric_id)) continue;
          seen.add(mr.metric_id);
          if (metricOutcome(mr) === "passed") passed += 1;
        }
      }
    }
    return { passed, total: seen.size };
  }, [heading, frameworks, controlsByFw]);

  function openFramework(fw: string) {
    setSelectedFw(fw);
    setFilter("all");
  }

  const activeControls = (selectedFw ? controlsByFw.get(selectedFw) : undefined) ?? [];
  const filteredControls = [...activeControls]
    .filter((c) => filter === "all" || c.status === filter)
    .sort((a, b) => (CONTROL_SORT[a.status] ?? 9) - (CONTROL_SORT[b.status] ?? 9));
  const firstFailRef = filteredControls.find((c) => c.status === "failed")?.control_ref ?? null;

  const filterCounts: Record<StatusFilter, number> = {
    all: activeControls.length,
    failed: activeControls.filter((c) => c.status === "failed").length,
    needs_review: activeControls.filter((c) => c.status === "needs_review").length,
    passed: activeControls.filter((c) => c.status === "passed").length,
  };

  if (frameworks.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-[13px] text-slate-500 dark:text-slate-400">
        No frameworks are assigned to this application.
      </div>
    );
  }

  if (selectedFw === null) {
    /* ── framework selection: the auditor picks which framework to open ── */
    const pct = appChecks.total ? Math.round((appChecks.passed / appChecks.total) * 100) : 0;
    return (
      <div className="space-y-5">
        {/* app header + honest headline stat (checks passed — NOT conformance) */}
        {heading && (
          <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-hairline dark:border-white/10 bg-white dark:bg-slate-900 p-5">
            <div className="min-w-0">
              {heading.name && <h2 className="font-display text-[19px] leading-tight text-ink dark:text-white">{heading.name}</h2>}
              {heading.subtitle && <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">{heading.subtitle}</p>}
            </div>
            {appChecks.total > 0 && (
              <div className="text-right">
                <p className="font-display text-[26px] font-semibold leading-none text-ink dark:text-white tabular-nums">{pct}%</p>
                <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">of {appChecks.total} checks passed</p>
              </div>
            )}
          </div>
        )}

        {intro && <FrameworkIntro />}

        {blocking ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-[13px] text-red-800 dark:text-red-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden />
            <span>
              <strong>Not satisfied:</strong> {blocking.control.control_title ?? blocking.control.control_ref} ({frameworkLabel(blocking.fw)}) —{" "}
              {blocking.control.failed_metric_count} check(s) failed.{" "}
              <button onClick={() => openFramework(blocking.fw)} className="font-semibold underline decoration-red-400 underline-offset-2 hover:text-red-900 dark:hover:text-red-200">
                Open {frameworkLabel(blocking.fw)}
              </button>
            </span>
          </div>
        ) : summary.total > 0 ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3 text-[13px] text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
            <span>No blocking clauses for this application.</span>
          </div>
        ) : null}

        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Frameworks assessed</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {frameworks.map((fw) => (
              <FrameworkCard key={fw} fw={fw} stats={frameworkStats(fw)} onOpen={() => openFramework(fw)} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ── framework detail: clauses + metrics for the chosen framework ── */
  return (
    <div className="space-y-5">
      <button
        onClick={() => setSelectedFw(null)}
        className="inline-flex items-center gap-1.5 text-[12px] font-medium text-slate-500 dark:text-slate-400 hover:text-ink dark:hover:text-white"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to frameworks
      </button>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[17px] font-semibold text-ink dark:text-white">{frameworkLabel(selectedFw)}</h2>
        <span className="text-[12px] text-slate-500 dark:text-slate-400">{frameworkDesc(selectedFw)}</span>
      </div>

      {/* lateral framework switcher — jump between frameworks without going back */}
      <FrameworkTabs
        frameworks={frameworks}
        active={selectedFw}
        onChange={(f) => { setSelectedFw(f); setFilter("all"); }}
        failCountFor={(fw) => (controlsByFw.get(fw) ?? []).filter((c) => c.status === "failed").length}
        clauseCountFor={(fw) => (controlsByFw.get(fw) ?? []).length}
      />

      {/* filter pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTER_ORDER.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={clsx(
              "rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors",
              filter === f
                ? "bg-brand-600 text-white"
                : "bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 ring-1 ring-black/5 dark:ring-white/10 hover:bg-slate-50 dark:hover:bg-slate-700",
            )}
          >
            {FILTER_LABEL[f]} ({filterCounts[f]})
          </button>
        ))}
      </div>

      {/* clause cards */}
      <div className="space-y-2.5">
        {activeControls.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-[13px] text-slate-500 dark:text-slate-400">
            No clauses assessed against {frameworkLabel(selectedFw)} for this application.
          </div>
        ) : filteredControls.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-[13px] text-slate-500 dark:text-slate-400">
            No clauses match this filter.
          </div>
        ) : (
          filteredControls.map((c) => (
            <ClauseCard key={c.control_ref} control={c} catalogById={catalogById} defaultOpen={c.control_ref === firstFailRef} />
          ))
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────── framework card ── */

function FrameworkCard({
  fw, stats, onOpen,
}: {
  fw: string;
  stats: { assessed: number; passed: number; failed: number; needsReview: number; manual: number };
  onOpen: () => void;
}) {
  const assessed = stats.assessed > 0;
  const status: ClauseStatus = stats.failed > 0 ? "failed" : stats.needsReview > 0 ? "needs_review" : assessed ? "passed" : "not_evaluated";
  const ui = STATUS_UI[status];
  return (
    <button
      onClick={assessed ? onOpen : undefined}
      disabled={!assessed}
      className={clsx(
        "flex h-full flex-col rounded-2xl border border-l-4 border-hairline dark:border-white/10 bg-white dark:bg-slate-900 p-5 text-left transition-colors",
        ui.edge,
        assessed ? "hover:bg-slate-50 dark:hover:bg-slate-800/60" : "cursor-default opacity-70",
      )}
    >
      <div className="flex w-full items-start justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-600 dark:text-brand-400">{frameworkLens(fw)}</p>
        {assessed && <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" aria-hidden />}
      </div>

      <h3 className="mt-1 text-[15px] font-semibold text-ink dark:text-white">{frameworkLabel(fw)}</h3>
      <p className="mt-1.5 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">{frameworkDesc(fw)}</p>

      {assessed ? (
        <>
          <div className="mt-4 grid grid-cols-4 gap-2">
            <CardStat n={stats.passed} label="passed" tone="text-emerald-600 dark:text-emerald-400" />
            <CardStat n={stats.failed} label="failed" tone="text-red-600 dark:text-red-400" />
            <CardStat n={stats.needsReview} label="warning" tone="text-amber-600 dark:text-amber-400" />
            <CardStat n={stats.manual} label="manual" tone="text-slate-500 dark:text-slate-400" />
          </div>
          <div className="mt-3 flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            {stats.passed > 0 && <div className="bg-emerald-500" style={{ flex: stats.passed }} />}
            {stats.needsReview > 0 && <div className="bg-amber-500" style={{ flex: stats.needsReview }} />}
            {stats.failed > 0 && <div className="bg-red-500" style={{ flex: stats.failed }} />}
          </div>
        </>
      ) : (
        <p className="mt-4 text-[12px] text-slate-400 dark:text-slate-500">Not assessed for this application.</p>
      )}
    </button>
  );
}

function CardStat({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div>
      <p className={clsx("font-display text-[18px] font-semibold leading-none tabular-nums", tone)}>{n}</p>
      <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">{label}</p>
    </div>
  );
}

/* ─────────────────────────────────────────────────── framework tabs ── */

function FrameworkTabs({
  frameworks, active, onChange, failCountFor, clauseCountFor,
}: {
  frameworks: string[];
  active: string | null;
  onChange: (fw: string) => void;
  failCountFor: (fw: string) => number;
  clauseCountFor: (fw: string) => number;
}) {
  const groupId = useId();
  function onKeyDown(e: React.KeyboardEvent, idx: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const next = (idx + dir + frameworks.length) % frameworks.length;
    onChange(frameworks[next]);
    document.getElementById(`${groupId}-${frameworks[next]}`)?.focus();
  }
  return (
    <div role="tablist" aria-label="Frameworks" className="flex flex-wrap gap-1 border-b border-hairline dark:border-white/10">
      {frameworks.map((fw, i) => {
        const selected = fw === active;
        const fails = failCountFor(fw);
        const clauses = clauseCountFor(fw);
        return (
          <button
            key={fw}
            id={`${groupId}-${fw}`}
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(fw)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={clsx(
              "relative -mb-px flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors",
              selected ? "border-brand-500 text-ink dark:text-white" : "border-transparent text-slate-500 dark:text-slate-400 hover:text-ink dark:hover:text-slate-200",
            )}
          >
            {frameworkLabel(fw)}
            {fails > 0 ? (
              <span className="rounded-full bg-red-100 dark:bg-red-950/60 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-300">{fails} failed</span>
            ) : clauses === 0 ? (
              <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">—</span>
            ) : (
              <span className="rounded-full bg-emerald-100 dark:bg-emerald-950/50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">ok</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ────────────────────────────────────────────────────── clause card ── */

function ClauseCard({
  control, catalogById, defaultOpen,
}: {
  control: FrameworkControlAssessment;
  catalogById: Map<string, MetricConfigFull>;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const ui = STATUS_UI[control.status];
  const metrics = control.metric_results ?? [];
  return (
    <div className={clsx("overflow-hidden rounded-xl border border-l-4 border-hairline dark:border-white/10 bg-white dark:bg-slate-900", ui.edge)}>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <span className="shrink-0 rounded-md bg-slate-800 px-2 py-1 font-mono text-[11.5px] font-bold text-white dark:bg-slate-700">{control.control_ref}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-ink dark:text-white">{control.control_title ?? "Clause"}</p>
          <p className="mt-0.5 text-[12.5px] text-slate-500 dark:text-slate-400">
            {control.passed_metric_count} passed · {control.failed_metric_count} failed · {control.pending_metric_count} pending
            {control.finding_count > 0 && ` · ${control.finding_count} findings`}
          </p>
        </div>
        <span className={clsx("shrink-0 rounded-full px-2.5 py-1 text-[12px] font-bold uppercase tracking-[0.02em]", ui.bg, ui.text)}>{ui.label}</span>
        <ChevronRight className={clsx("h-4 w-4 shrink-0 text-slate-400 transition-transform", open && "rotate-90")} aria-hidden />
      </button>

      {open && (
        <div className="space-y-2.5 border-t border-hairline dark:border-white/10 bg-slate-50/50 dark:bg-slate-950/30 px-4 py-4">
          <InfoBox>
            <span className="font-semibold text-ink dark:text-white">What this means:</span> {plainLanguageClause(control)}
          </InfoBox>

          {control.requirement_text && (
            <InfoBox tone="gate">
              <span className="font-semibold">Clause requirement:</span> {control.requirement_text}
            </InfoBox>
          )}

          <Section label="Checks that assessed this clause">
            {metrics.length === 0 ? (
              control.metric_ids.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {control.metric_ids.map((id) => (
                    <span key={id} className="rounded border border-hairline dark:border-white/10 px-2 py-0.5 font-mono text-[10px] text-slate-500 dark:text-slate-400">{id}</span>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-slate-400">No metric checks mapped.</p>
              )
            ) : (
              <div className="space-y-1.5">
                {metrics.map((mr) => <MetricRow key={mr.id} metric={mr} config={catalogById.get(mr.metric_id) ?? null} />)}
              </div>
            )}
          </Section>

          {control.evidence_requirements.length > 0 && (
            <Section label="Evidence">
              <p className="text-[12px] text-slate-500 dark:text-slate-400">{control.evidence_requirements.join(", ")}</p>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function MetricRow({ metric, config }: { metric: MetricResult; config: MetricConfigFull | null }) {
  const [open, setOpen] = useState(false);
  const outcome = metricOutcome(metric);
  const pill = OUTCOME_PILL[outcome];
  const score = metric.normalized_score;
  return (
    <div className={clsx("overflow-hidden rounded-lg border border-l-[3px] border-hairline dark:border-white/10 bg-white dark:bg-slate-900", pill.edge)}>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
        <span className="shrink-0 rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-500 dark:text-slate-400">{metric.metric_id}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-slate-800 dark:text-slate-200">{config?.name ?? metric.metric_id}</p>
          <p className="truncate text-[12px] text-slate-400">{humanizeDimension(config?.dimension ?? metric.dimension)}</p>
        </div>
        <span className="shrink-0 font-mono text-[13px] font-semibold text-slate-600 dark:text-slate-300">
          {score != null ? score.toFixed(2) : "—"}
          {metric.threshold != null && <span className="text-slate-300 dark:text-slate-600"> / {metric.threshold.toFixed(2)}</span>}
        </span>
        <span className={clsx("flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-bold uppercase tracking-[0.02em]", pill.cls)}>
          <span className={clsx("h-1.5 w-1.5 rounded-full", pill.dot)} aria-hidden />
          {pill.label}
        </span>
        <ChevronRight className={clsx("h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform", open && "rotate-90")} aria-hidden />
      </button>
      {open && (
        <div className="border-t border-hairline dark:border-white/10 bg-slate-50/60 dark:bg-slate-950/30 px-3.5 py-3.5">
          <MetricDetailSections metric={metric} config={config} />
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function plainLanguageClause(c: FrameworkControlAssessment): string {
  const title = c.control_title ?? c.control_ref;
  const total = c.metric_ids.length || c.passed_metric_count + c.failed_metric_count + c.pending_metric_count;
  const findings = c.finding_count
    ? ` ${c.finding_count} finding${c.finding_count === 1 ? " was" : "s were"} raised alongside it.`
    : "";
  const plural = (n: number) => (n === 1 ? "" : "s");
  switch (c.status) {
    case "passed":
      return `Every automated check mapped to this clause met its threshold — ${c.passed_metric_count} of ${total} passed with no open findings. ${title} is satisfied for this application.`;
    case "failed":
      return `${c.failed_metric_count} of ${total} check${plural(c.failed_metric_count)} mapped to this clause scored below the bar, so ${title.toLowerCase()} is not satisfied.${findings} These gaps must be closed before the application can be considered compliant against this clause.`;
    case "needs_review":
      return `${title} can't be decided automatically yet — ${c.pending_metric_count} check${plural(c.pending_metric_count)} ${c.pending_metric_count === 1 ? "is" : "are"} still pending or inconclusive. A reviewer needs to confirm the outcome before this clause can pass.`;
    default:
      return `No automated checks ran against this clause in this assessment, so ${title.toLowerCase()} has not been evaluated yet.`;
  }
}
