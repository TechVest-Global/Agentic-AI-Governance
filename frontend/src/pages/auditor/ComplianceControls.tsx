import { useEffect, useId, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, Send } from "lucide-react";
import clsx from "clsx";
import { listMetricConfigs, type FrameworkControlAssessment, type MetricConfigFull } from "@/api/governanceApi";
import {
  ControlStatusPill,
  EvidenceTypeBadge,
  controlEvidenceType,
  controlStatusFrom,
  frameworkLabel,
  humanizeDimension,
  metricOutcome,
  metricOutcomeMeta,
  type ControlStatus,
  type EvidenceType,
} from "./clientComponents";

/**
 * ComplianceControls — controls-first Compliance view for one application
 * (AUDITOR_MASTER_SPEC §4.2). A framework tab-strip; under each framework, all
 * of its controls as rows labelled by evidence type (Automated / Manual / NA)
 * and status (Satisfied / Partial / Not satisfied / Manual evidence required /
 * NA), grouped by control objective, with filter pills, a coverage summary, a
 * blocking banner, and per-control expand → requirement + evidence + mapped
 * metric results + a "Request from developer" action. Read-only over real
 * framework-map data; never fabricates coverage (honesty rule §2).
 */

type Filter = "all" | "not_satisfied" | "partial" | "satisfied" | "manual" | "not_applicable";
const FILTER_ORDER: Filter[] = ["all", "not_satisfied", "partial", "satisfied", "manual", "not_applicable"];
const FILTER_LABEL: Record<Filter, string> = {
  all: "All",
  not_satisfied: "Not satisfied",
  partial: "Partial",
  satisfied: "Satisfied",
  manual: "Manual",
  not_applicable: "Not applicable",
};
const STATUS_SORT: Record<ControlStatus, number> = {
  not_satisfied: 0, partial: 1, manual: 2, not_applicable: 3, satisfied: 4,
};

type ControlView = {
  control: FrameworkControlAssessment;
  evidence: EvidenceType;
  status: ControlStatus;
};

export function ComplianceControls({
  frameworks,
  controlsFor,
  onRequest,
}: {
  frameworks: string[];
  controlsFor: (fw: string) => FrameworkControlAssessment[];
  /** Structured request to the developer, scoped to a control (§5 action 2). */
  onRequest?: (ctx: { framework: string; controlRef: string; controlTitle: string }) => void;
}) {
  const [tab, setTab] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [catalog, setCatalog] = useState<MetricConfigFull[]>([]);

  useEffect(() => {
    let cancelled = false;
    listMetricConfigs({ limit: 200 }).then((c) => { if (!cancelled) setCatalog(c); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const catalogById = useMemo(() => {
    const m = new Map<string, MetricConfigFull>();
    for (const c of catalog) m.set(c.metric_id, c);
    return m;
  }, [catalog]);

  const viewsByFw = useMemo(() => {
    const map = new Map<string, ControlView[]>();
    for (const fw of frameworks) {
      const views = controlsFor(fw).map((control) => {
        const evidence = controlEvidenceType(control.metric_ids.length > 0);
        return { control, evidence, status: controlStatusFrom(control.status, evidence) };
      });
      map.set(fw, views);
    }
    return map;
  }, [frameworks, controlsFor]);

  // Default to the first framework that has a not-satisfied control, else the first.
  useEffect(() => {
    if (tab && frameworks.includes(tab)) return;
    if (!frameworks.length) return;
    const firstBad = frameworks.find((fw) => (viewsByFw.get(fw) ?? []).some((v) => v.status === "not_satisfied"));
    setTab(firstBad ?? frameworks[0]);
  }, [frameworks, viewsByFw, tab]);

  if (!frameworks.length) {
    return <Empty>No frameworks are assigned to this application.</Empty>;
  }

  const views = (tab ? viewsByFw.get(tab) : undefined) ?? [];
  const counts: Record<Filter, number> = {
    all: views.length,
    not_satisfied: views.filter((v) => v.status === "not_satisfied").length,
    partial: views.filter((v) => v.status === "partial").length,
    satisfied: views.filter((v) => v.status === "satisfied").length,
    manual: views.filter((v) => v.status === "manual").length,
    not_applicable: views.filter((v) => v.status === "not_applicable").length,
  };
  const automatedCount = views.filter((v) => v.evidence === "automated").length;
  const manualCount = views.filter((v) => v.evidence === "manual").length;
  const blocking = views.find((v) => v.status === "not_satisfied") ?? null;

  const filtered = views
    .filter((v) => filter === "all" || v.status === filter)
    .sort((a, b) => (STATUS_SORT[a.status] - STATUS_SORT[b.status]) || a.control.control_ref.localeCompare(b.control.control_ref));

  // Group filtered controls by objective (control_category).
  const groups = new Map<string, ControlView[]>();
  for (const v of filtered) {
    const key = objectiveLabel(v.control.control_category);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(v);
  }

  return (
    <div className="space-y-4">
      <FrameworkTabStrip
        frameworks={frameworks}
        active={tab}
        onChange={(fw) => { setTab(fw); setFilter("all"); }}
        badCountFor={(fw) => (viewsByFw.get(fw) ?? []).filter((v) => v.status === "not_satisfied").length}
        controlCountFor={(fw) => (viewsByFw.get(fw) ?? []).length}
      />

      {blocking ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-[13px] text-red-800 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden />
          <span>
            <strong>Not satisfied:</strong> {blocking.control.control_ref} {blocking.control.control_title ?? ""} — {blocking.control.failed_metric_count} check(s) failed. Resolve this to move toward compliance.
          </span>
        </div>
      ) : views.length > 0 ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3 text-[13px] text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
          <span>No blocking controls for {tab ? frameworkLabel(tab) : "this framework"}.</span>
        </div>
      ) : null}

      {/* coverage summary (§4.2) */}
      <p className="text-[12px] text-slate-500 dark:text-slate-400">
        {views.length} control{views.length === 1 ? "" : "s"} applicable · {automatedCount} automated · {manualCount} manual
      </p>

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
            {FILTER_LABEL[f]} ({counts[f]})
          </button>
        ))}
      </div>

      {/* controls grouped by objective */}
      {filtered.length === 0 ? (
        <Empty>No controls match this filter.</Empty>
      ) : (
        <div className="space-y-5">
          {[...groups.entries()].map(([objective, rows]) => (
            <div key={objective}>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{objective}</p>
              <div className="space-y-2">
                {rows.map((v) => (
                  <ControlRow
                    key={v.control.control_ref}
                    view={v}
                    catalogById={catalogById}
                    onRequest={onRequest && tab ? () => onRequest({ framework: tab, controlRef: v.control.control_ref, controlTitle: v.control.control_title ?? v.control.control_ref }) : undefined}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* honesty note — manual/documentary controls aren't in the engine yet */}
      <p className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 px-3 py-2 text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
        Only controls with automated metric coverage are shown. Manual/documentary controls (e.g. AI-policy, roles &amp; responsibilities, impact-assessment process) are not yet represented in the engine and will appear here — labelled “manual evidence required” — once the developer side adds them.
      </p>
    </div>
  );
}

/* ───────────────────────────────────────────────────── framework tabs ── */

function FrameworkTabStrip({
  frameworks, active, onChange, badCountFor, controlCountFor,
}: {
  frameworks: string[];
  active: string | null;
  onChange: (fw: string) => void;
  badCountFor: (fw: string) => number;
  controlCountFor: (fw: string) => number;
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
        const bad = badCountFor(fw);
        const total = controlCountFor(fw);
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
            {bad > 0 ? (
              <span className="rounded-full bg-red-100 dark:bg-red-950/60 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-300">{bad}</span>
            ) : total === 0 ? (
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

/* ─────────────────────────────────────────────────────────── control ── */

function ControlRow({
  view, catalogById, onRequest,
}: {
  view: ControlView;
  catalogById: Map<string, MetricConfigFull>;
  onRequest?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState(false);
  const { control, evidence, status } = view;
  const metrics = control.metric_results ?? [];
  const edge =
    status === "not_satisfied" ? "border-l-red-500"
      : status === "partial" ? "border-l-amber-500"
        : status === "satisfied" ? "border-l-emerald-500"
          : "border-l-slate-300 dark:border-l-slate-600";
  return (
    <div className={clsx("overflow-hidden rounded-xl border border-l-4 border-hairline dark:border-white/10 bg-white dark:bg-slate-900", edge)}>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <ChevronRight className={clsx("h-4 w-4 shrink-0 text-slate-400 transition-transform", open && "rotate-90")} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-ink dark:text-white">
            <span className="font-mono text-[11px] text-slate-400">{control.control_ref}</span>{" "}
            {control.control_title ?? "Control"}
          </p>
          {evidence === "automated" && (
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              {control.passed_metric_count} passed · {control.failed_metric_count} failed · {control.pending_metric_count} pending
            </p>
          )}
        </div>
        <EvidenceTypeBadge type={evidence} />
        <ControlStatusPill status={status} />
      </button>

      {open && (
        <div className="space-y-4 border-t border-hairline dark:border-white/10 px-4 py-4 pl-11">
          {control.requirement_text && (
            <Section label="Requirement">
              <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">{control.requirement_text}</p>
            </Section>
          )}

          {control.evidence_requirements.length > 0 && (
            <Section label="Evidence required">
              <p className="text-[12px] text-slate-500 dark:text-slate-400">{control.evidence_requirements.join(", ")}</p>
            </Section>
          )}

          <Section label={evidence === "automated" ? "Mapped metrics & results" : "Coverage"}>
            {evidence !== "automated" ? (
              <p className="text-[12px] text-slate-500 dark:text-slate-400">
                This control requires manual/documentary evidence — it is not assessed by automated metrics.
              </p>
            ) : metrics.length === 0 ? (
              <p className="text-[12px] text-slate-400">No metric results returned for this run.</p>
            ) : (
              <div className="space-y-1.5">
                {metrics.map((mr) => {
                  const outcome = metricOutcome(mr);
                  const meta = metricOutcomeMeta(outcome);
                  const cfg = catalogById.get(mr.metric_id);
                  return (
                    <div key={mr.id} className="grid grid-cols-[1fr_92px_88px] items-center gap-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 px-2.5 py-2 text-[12px]">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-800 dark:text-slate-200">{cfg?.name ?? mr.metric_id}</p>
                        <p className="truncate font-mono text-[10px] text-slate-400">{mr.metric_id} · {humanizeDimension(cfg?.dimension ?? mr.dimension)}</p>
                      </div>
                      <span className={clsx("text-right font-semibold", meta.tone)}>{meta.label}</span>
                      <span className="text-right font-mono text-[11px] text-slate-500 dark:text-slate-400">
                        {mr.normalized_score != null ? mr.normalized_score.toFixed(2) : "n/a"}
                        {mr.threshold != null ? ` / ${mr.threshold.toFixed(2)}` : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          {/* Structured request to the developer (§5 action 2). Only functional
              when a real handler is wired; without a backend request endpoint
              the button is disabled rather than falsely confirming "sent"
              (honesty rule §2/§7 — never imply an action that didn't happen). */}
          {requested ? (
            <p className="inline-flex items-center gap-1.5 text-[12px] font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
              Request sent to the developer for {control.control_ref}.
            </p>
          ) : onRequest ? (
            <button
              onClick={() => { setRequested(true); onRequest(); }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-hairline dark:border-slate-700 px-3 py-1.5 text-[12px] font-medium text-slate-600 dark:text-slate-300 hover:border-brand-300 dark:hover:border-brand-700 hover:text-ink dark:hover:text-white"
            >
              <Send className="h-3.5 w-3.5" aria-hidden />
              Request from developer
            </button>
          ) : (
            <button
              type="button"
              disabled
              aria-disabled
              title="Developer requests aren't available yet — this needs a backend request endpoint."
              className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-hairline dark:border-slate-700 px-3 py-1.5 text-[12px] font-medium text-slate-400 dark:text-slate-500"
            >
              <Send className="h-3.5 w-3.5" aria-hidden />
              Request from developer
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── util ── */

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-[13px] text-slate-500 dark:text-slate-400">
      {children}
    </div>
  );
}

function objectiveLabel(category?: string | null): string {
  if (!category) return "Controls";
  return category.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
