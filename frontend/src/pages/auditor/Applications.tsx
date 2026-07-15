import { useMemo, useState } from "react";
import { ArrowRight, Boxes, Search } from "lucide-react";
import clsx from "clsx";
import { useAppStore } from "@/store/useAppStore";
import { useSelectionStore } from "@/store/useSelectionStore";
import { useAuditorWorkspace, type ReviewItem } from "@/hooks/useAuditorWorkspace";
import type { BackendAISystem } from "@/api/governanceApi";
import { AuditorPageHeader, BackendError } from "./components";
import {
  ChecksDonut,
  StatTile,
  VerdictPill,
  frameworkLabel,
  verdictToClient,
  type ClientVerdictKey,
} from "./clientComponents";

/**
 * Applications — the client's home. A flat, deduplicated list of the AI
 * applications in the portfolio, each showing its current assurance status.
 * (Fixes the old Overview, which repeated the same system once per run.)
 * Read-only over live backend data.
 */

const IN_FLIGHT = new Set([
  "created", "context_assembly", "planned", "metrics_running", "agents_running", "council_running",
]);

type AppEntry = {
  system: BackendAISystem;
  /** The run whose verdict we display: latest report-bearing, else latest run. */
  source: ReviewItem | null;
  runInFlight: boolean;
  verdictKey: ClientVerdictKey;
  openFindings: number;
  /** Real metric-check breakdown from the assessed run (null when not assessed). */
  metrics: ReviewItem["metrics"];
};

export function Applications() {
  const navigateTo = useAppStore((s) => s.navigateTo);
  const setSelectedSystemId = useSelectionStore((s) => s.setSelectedSystemId);
  const ws = useAuditorWorkspace();

  const [query, setQuery] = useState("");
  const [verdictFilter, setVerdictFilter] = useState<"all" | ClientVerdictKey>("all");
  const [riskFilter, setRiskFilter] = useState<"all" | "high" | "medium" | "low">("all");
  const [frameworkFilter, setFrameworkFilter] = useState<string>("all");

  // One entry per application. The displayed verdict comes from the latest
  // REPORT-BEARING run (the assessed state), so the card matches the record;
  // the latest run of any status only decides the in-progress / not-assessed
  // fallback when there's no assessed run yet.
  const entries = useMemo<AppEntry[]>(() => {
    const assessedByApp = new Map<string, ReviewItem>();
    const latestByApp = new Map<string, ReviewItem>();
    for (const item of ws.reviewItems) {
      const la = latestByApp.get(item.systemId);
      if (!la || item.createdAt > la.createdAt) latestByApp.set(item.systemId, item);
      // "Assessed" = the run produced a verdict (not merely report_ready) — real
      // runs hang at council_running with a verdict before flipping status.
      if (item.verdict != null) {
        const as = assessedByApp.get(item.systemId);
        if (!as || item.createdAt > as.createdAt) assessedByApp.set(item.systemId, item);
      }
    }
    return ws.systemsInScope.map((system) => {
      const assessed = assessedByApp.get(system.id) ?? null;
      const latest = latestByApp.get(system.id) ?? null;
      const runInFlight = Boolean(!assessed && latest && IN_FLIGHT.has(latest.status));
      const source = assessed ?? latest;
      const verdictKey = verdictToClient(assessed?.verdict?.label ?? null, {
        actionTier: assessed?.verdict?.action_tier,
        hasTerminalRun: Boolean(assessed),
        runInFlight,
      }).key;
      return {
        system,
        source,
        runInFlight,
        verdictKey,
        openFindings: assessed?.openFindings ?? 0,
        metrics: assessed?.metrics ?? null,
      };
    });
  }, [ws.systemsInScope, ws.reviewItems]);

  const allFrameworks = useMemo(
    () => Array.from(new Set(entries.flatMap((e) => e.system.selected_frameworks))).sort(),
    [entries],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (q && !`${e.system.name} ${e.system.system_type} ${e.system.owner}`.toLowerCase().includes(q)) return false;
      if (verdictFilter !== "all" && e.verdictKey !== verdictFilter) return false;
      if (riskFilter !== "all" && e.system.risk_tier !== riskFilter) return false;
      if (frameworkFilter !== "all" && !e.system.selected_frameworks.includes(frameworkFilter)) return false;
      return true;
    });
  }, [entries, query, verdictFilter, riskFilter, frameworkFilter]);

  const posture = useMemo(() => {
    const count = (k: ClientVerdictKey) => entries.filter((e) => e.verdictKey === k).length;
    return {
      total: entries.length,
      assessed: entries.filter((e) => e.verdictKey !== "not_assessed" && e.verdictKey !== "in_progress").length,
      compliant: count("compliant"),
      conditional: count("conditional"),
      notCompliant: count("not_compliant"),
      underReview: count("under_review"),
    };
  }, [entries]);

  function open(appId: string) {
    setSelectedSystemId(appId);
    navigateTo("/application");
  }

  if (ws.loading) {
    return (
      <div className="space-y-6">
        <AuditorPageHeader eyebrow="Assurance" title="Applications" description="The AI applications in your portfolio and their current assurance status." />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-[74px] animate-pulse rounded-xl border border-hairline dark:border-white/10 bg-slate-50 dark:bg-slate-800/40" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[248px] animate-pulse rounded-2xl border border-hairline dark:border-white/10 bg-slate-50 dark:bg-slate-800/40" />
          ))}
        </div>
      </div>
    );
  }
  if (ws.error) {
    return (
      <div className="space-y-5">
        <AuditorPageHeader eyebrow="Assurance" title="Applications" />
        <BackendError message={ws.error} onRetry={ws.refresh} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AuditorPageHeader
        eyebrow="Assurance"
        title="Applications"
        description="The AI applications in your portfolio and their current assurance status."
        connected={ws.connected}
        onRefresh={ws.refresh}
      />

      {/* posture strip — calm stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile label="Applications assessed" value={`${posture.assessed}/${posture.total}`} />
        <StatTile label="Compliant" value={posture.compliant} tone="good" />
        <StatTile label="Conditional" value={posture.conditional} tone={posture.conditional ? "warn" : "default"} />
        <StatTile label="Not compliant" value={posture.notCompliant} tone={posture.notCompliant ? "danger" : "default"} />
        <StatTile label="Under review" value={posture.underReview} />
      </div>

      {/* filter bar */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search applications…"
            aria-label="Search applications"
            className="h-9 w-full rounded-lg border border-hairline dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 text-[13px] text-ink dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-200 dark:focus:ring-brand-700/40"
          />
        </div>
        <FilterSelect label="Verdict" value={verdictFilter} onChange={(v) => setVerdictFilter(v as typeof verdictFilter)}
          options={[["all", "All verdicts"], ["compliant", "Compliant"], ["conditional", "Conditional"], ["not_compliant", "Not compliant"], ["under_review", "Under review"], ["not_assessed", "Not assessed"]]} />
        <FilterSelect label="Risk" value={riskFilter} onChange={(v) => setRiskFilter(v as typeof riskFilter)}
          options={[["all", "All risk"], ["high", "High"], ["medium", "Medium"], ["low", "Low"]]} />
        <FilterSelect label="Framework" value={frameworkFilter} onChange={setFrameworkFilter}
          options={[["all", "All frameworks"], ...allFrameworks.map((f) => [f, frameworkLabel(f)] as [string, string])]} />
      </div>

      {/* list */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-10 text-center">
          <Boxes className="mx-auto mb-3 h-7 w-7 text-slate-400" aria-hidden />
          <p className="text-[14px] font-semibold text-ink dark:text-white">
            {entries.length === 0 ? "No applications in scope yet" : "No applications match these filters"}
          </p>
          <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">
            {entries.length === 0
              ? "Applications appear here once they've been registered and assessed on the engineering side."
              : "Try clearing a filter to see more."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((e) => (
              <ApplicationCard key={e.system.id} entry={e} onOpen={() => open(e.system.id)} />
            ))}
          </div>
          <p className="pt-1 text-[12px] text-slate-400 dark:text-slate-500">
            {filtered.length} of {entries.length} application{entries.length === 1 ? "" : "s"}
          </p>
        </div>
      )}
    </div>
  );
}

const RISK_BADGE: Record<string, { label: string; cls: string }> = {
  high: { label: "High risk", cls: "text-red-700 bg-red-50 dark:text-red-300 dark:bg-red-950/40" },
  medium: { label: "Medium risk", cls: "text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/40" },
  low: { label: "Low risk", cls: "text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40" },
};

function RiskBadge({ tier }: { tier: string }) {
  const m = RISK_BADGE[tier?.toLowerCase()] ?? { label: tier || "Unknown risk", cls: "text-slate-500 bg-slate-100 dark:text-slate-400 dark:bg-slate-800" };
  return (
    <span className={clsx("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em]", m.cls)}>
      {m.label}
    </span>
  );
}

function ApplicationCard({ entry, onOpen }: { entry: AppEntry; onOpen: () => void }) {
  const { system, source, runInFlight, verdictKey, openFindings, metrics } = entry;
  const assessed = source?.verdict != null;
  const meta = verdictToClient(assessed ? source!.verdict!.label : null, {
    actionTier: assessed ? source!.verdict!.action_tier : null,
    hasTerminalRun: assessed,
    runInFlight,
  });
  const frameworks = system.selected_frameworks ?? [];

  return (
    <button
      onClick={onOpen}
      className="group flex h-full w-full flex-col rounded-2xl border border-hairline dark:border-white/10 bg-white dark:bg-slate-900 p-5 text-left transition-all hover:border-brand-300 dark:hover:border-brand-700 hover:shadow-[0_8px_28px_-14px_rgba(15,23,42,0.18)]"
    >
      {/* identity: name + subtype/owner + risk */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold leading-snug text-ink dark:text-white">{system.name}</p>
          <p className="mt-1 truncate text-[12px] text-slate-500 dark:text-slate-400">
            <span className="capitalize">{system.system_type.replace(/[_-]/g, " ")}</span>
            {system.owner && <> · {system.owner}</>}
          </p>
        </div>
        <RiskBadge tier={system.risk_tier} />
      </div>

      {/* verdict — the authoritative status */}
      <div className="mt-3.5">
        <VerdictPill meta={meta} size="sm" />
      </div>

      {/* score — one compact visual (donut) + calm counts; no redundant bar */}
      {metrics ? (
        <div className="mt-4 flex items-center gap-4">
          <ChecksDonut metrics={metrics} size={62} />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Checks passed</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <Count dot="bg-emerald-500" n={metrics.passed} label="passed" />
              <Count dot="bg-red-500" n={metrics.failed} label="failed" />
              <Count dot="bg-amber-500" n={metrics.needsReview} label="review" />
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">
              {metrics.passed} of {metrics.total} checks passed
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 px-3.5 py-3.5 text-[12px] text-slate-400 dark:text-slate-500">
          <Boxes className="h-4 w-4 shrink-0" aria-hidden />
          {verdictKey === "in_progress" ? "Assessment in progress — checks pending." : "No checks assessed yet."}
        </div>
      )}

      {/* footer — frameworks, then a hairline-divided findings + Open row */}
      <div className="mt-auto pt-4">
        {frameworks.length > 0 && (
          <div className="flex min-w-0 flex-wrap gap-1">
            {frameworks.slice(0, 3).map((f) => <Chip key={f}>{frameworkLabel(f)}</Chip>)}
            {frameworks.length > 3 && <Chip>+{frameworks.length - 3}</Chip>}
          </div>
        )}
        <div className={clsx(
          "flex items-center justify-between gap-3",
          frameworks.length > 0 && "mt-3 border-t border-hairline dark:border-white/10 pt-3",
        )}>
          <span className="text-[11px] text-slate-400 dark:text-slate-500">
            {verdictKey === "not_assessed"
              ? " "
              : openFindings > 0
                ? `${openFindings} open finding${openFindings === 1 ? "" : "s"}`
                : "No open findings"}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[12px] font-semibold text-brand-700 dark:text-brand-400">
            Open
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </div>
      </div>
    </button>
  );
}

/** Compact "● 22 passed" count — small dot, bold figure, muted label. */
function Count({ dot, n, label }: { dot: string; n: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
      <span className={clsx("h-1.5 w-1.5 rounded-full", dot)} aria-hidden />
      <span className="font-semibold tabular-nums text-ink dark:text-slate-200">{n}</span>
      {label}
    </span>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:text-slate-400">
      {children}
    </span>
  );
}

function FilterSelect({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="h-9 rounded-lg border border-hairline dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 text-[12px] font-medium text-slate-600 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-200 dark:focus:ring-brand-700/40"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </select>
  );
}
