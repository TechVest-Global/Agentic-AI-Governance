import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  FileSearch,
  Fingerprint,
  ServerCrash,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import clsx from "clsx";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useActiveRun } from "@/hooks/useActiveRun";
import { listEvidence, type EvidenceRecord } from "@/api/governanceApi";

type PassFilter = "all" | "passed" | "failed";

export function Evidence() {
  const { runId, loading: runsLoading } = useActiveRun();
  const [evidence, setEvidence] = useState<EvidenceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [passFilter, setPassFilter] = useState<PassFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  // Load evidence whenever the active run changes.
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    async function loadEvidence(activeRunId: string) {
      setLoading(true);
      setError(null);
      try {
        const records = await listEvidence(activeRunId, { limit: 100 });
        if (!cancelled) setEvidence(records);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load evidence.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadEvidence(runId);
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const sourceTypes = useMemo(
    () => Array.from(new Set(evidence.map((e) => e.source_type).filter(Boolean))).sort(),
    [evidence],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return evidence.filter((e) => {
      if (passFilter === "passed" && e.passed !== true) return false;
      if (passFilter === "failed" && e.passed !== false) return false;
      if (sourceFilter !== "all" && e.source_type !== sourceFilter) return false;
      if (!q) return true;
      return (
        e.source_name?.toLowerCase().includes(q) ||
        e.source_type?.toLowerCase().includes(q) ||
        e.tool_name?.toLowerCase().includes(q) ||
        e.trace_id?.toLowerCase().includes(q)
      );
    });
  }, [evidence, search, passFilter, sourceFilter]);

  const counts = useMemo(() => {
    const passed = evidence.filter((e) => e.passed === true).length;
    const failed = evidence.filter((e) => e.passed === false).length;
    return { total: evidence.length, passed, failed };
  }, [evidence]);

  if (error && !runId) {
    return <EvidenceError message={error} />;
  }

  if (!runsLoading && !runId) {
    return <EvidenceEmpty />;
  }

  return (
    <div className="space-y-5">
      {/* Intro */}
      <div className="border-b border-slate-200 dark:border-slate-700 pb-5">
        <div className="max-w-2xl">
          <h1 className="font-display text-[22px] text-ink dark:text-white">Evidence Records</h1>
          <p className="mt-1 text-[13px] leading-5 text-slate-600 dark:text-slate-400">
            The audit-grade proof layer. Every finding and metric result is backed by an evidence record showing
            its source, the scored result against its threshold, and a sensitivity classification — all traceable
            by ID.
          </p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryStat icon={FileSearch} label="Evidence Records" value={counts.total} tone="slate" />
        <SummaryStat icon={CheckCircle2} label="Passed Threshold" value={counts.passed} tone="green" />
        <SummaryStat icon={XCircle} label="Below Threshold" value={counts.failed} tone="red" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <FileSearch className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by source, tool, or trace ID…"
            className="h-9 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 pl-9 pr-3 text-[12px] text-slate-900 dark:text-slate-100 outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:focus:ring-brand-700/40"
          />
        </div>
        <FilterPills
          options={[["all", "All"], ["passed", "Passed"], ["failed", "Failed"]]}
          value={passFilter}
          onChange={(v) => setPassFilter(v as PassFilter)}
        />
        {sourceTypes.length > 1 && (
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="h-9 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 text-[12px] text-slate-700 dark:text-slate-300 outline-none focus:border-brand-500"
          >
            <option value="all">All sources</option>
            {sourceTypes.map((s) => (
              <option key={s} value={s}>{titleCase(s)}</option>
            ))}
          </select>
        )}
      </div>

      {/* Table */}
      <Card>
        <CardHeader
          title="Evidence Trail"
          eyebrow={`${filtered.length} of ${evidence.length} record${evidence.length === 1 ? "" : "s"}`}
        />
        {loading ? (
          <TableSkeleton />
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-[14px] font-semibold text-slate-700 dark:text-slate-300">
              {evidence.length === 0 ? "No evidence recorded for this run yet" : "No records match your filters"}
            </p>
            <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
              {evidence.length === 0
                ? "Evidence is produced when metrics and specialist agents execute against the target system."
                : "Try clearing the search or filters."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-2.5">Source</th>
                  <th className="px-4 py-2.5">Tool</th>
                  <th className="px-4 py-2.5">Score / Threshold</th>
                  <th className="px-4 py-2.5">Result</th>
                  <th className="px-4 py-2.5">Sensitivity</th>
                  <th className="px-4 py-2.5">Recorded</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((record) => (
                  <EvidenceRow key={record.id} record={record} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ row --- */

function EvidenceRow({ record }: { record: EvidenceRecord }) {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(record.payload || record.trace_id);
  return (
    <>
      <tr
        onClick={() => hasDetail && setOpen((v) => !v)}
        className={clsx(
          "border-b border-slate-100 dark:border-slate-700/50",
          hasDetail && "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60",
        )}
      >
        <td className="px-4 py-3">
          <p className="font-medium text-slate-950 dark:text-white">{record.source_name || "—"}</p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
            {titleCase(record.source_type)}
          </p>
        </td>
        <td className="px-4 py-3">
          {record.tool_name ? (
            <span className="font-mono text-[11px] text-slate-700 dark:text-slate-300">{record.tool_name}</span>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </td>
        <td className="px-4 py-3 tabular-nums">
          {record.normalized_score != null ? (
            <span className="text-slate-900 dark:text-slate-100">
              {fmt(record.normalized_score)}
              {record.threshold != null && (
                <span className="text-slate-400 dark:text-slate-500"> / {fmt(record.threshold)}</span>
              )}
            </span>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </td>
        <td className="px-4 py-3">
          <ResultBadge passed={record.passed} />
        </td>
        <td className="px-4 py-3">
          <SensitivityTag value={record.sensitivity} />
        </td>
        <td className="px-4 py-3 text-[11px] text-slate-500 dark:text-slate-400">{fmtDate(record.created_at)}</td>
        <td className="px-4 py-3 text-right">
          {hasDetail && (
            <ChevronDown className={clsx("inline h-4 w-4 text-slate-400 transition-transform", open && "rotate-180")} />
          )}
        </td>
      </tr>
      {open && hasDetail && (
        <tr className="border-b border-slate-100 dark:border-slate-700/50 bg-slate-50/60 dark:bg-slate-800/40">
          <td colSpan={7} className="px-4 py-4">
            {record.trace_id && (
              <p className="mb-3 flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-400">
                <Fingerprint className="h-3.5 w-3.5" />
                Trace ID: <span className="font-mono text-slate-800 dark:text-slate-200">{record.trace_id}</span>
              </p>
            )}
            {record.payload && (
              <pre className="max-h-72 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 text-[11px] leading-5 text-slate-700 dark:text-slate-300">
                {JSON.stringify(record.payload, null, 2)}
              </pre>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/* -------------------------------------------------------------- pieces --- */

function SummaryStat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof FileSearch;
  label: string;
  value: number;
  tone: "slate" | "green" | "red";
}) {
  const toneText =
    tone === "green" ? "text-emerald-500" : tone === "red" ? "text-red-500" : "text-slate-400";
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">{label}</p>
        <Icon className={clsx("h-4 w-4", toneText)} />
      </div>
      <p className="mt-1.5 text-3xl font-bold tabular-nums text-slate-900 dark:text-white">{value}</p>
    </Card>
  );
}

function FilterPills({
  options,
  value,
  onChange,
}: {
  options: Array<[string, string]>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 p-0.5">
      {options.map(([val, label]) => (
        <button
          key={val}
          onClick={() => onChange(val)}
          className={clsx(
            "rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors",
            value === val
              ? "bg-slate-900 text-white dark:bg-brand-700"
              : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ResultBadge({ passed }: { passed?: boolean | null }) {
  if (passed === true) return <Badge tone="green">Passed</Badge>;
  if (passed === false) return <Badge tone="red">Failed</Badge>;
  return <Badge tone="neutral">N/A</Badge>;
}

function SensitivityTag({ value }: { value?: string | null }) {
  if (!value) return <span className="text-slate-400">—</span>;
  const tone =
    value === "restricted" || value === "high"
      ? "red"
      : value === "confidential" || value === "medium"
        ? "amber"
        : "slate";
  return <Badge tone={tone as "red" | "amber" | "slate"}>{titleCase(value)}</Badge>;
}

function TableSkeleton() {
  return (
    <div className="space-y-2 p-4">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-10 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
      ))}
    </div>
  );
}

function EvidenceEmpty() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 text-center shadow-card">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 dark:bg-brand-950/40 text-brand-600">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <h2 className="mt-4 font-display text-[18px] text-ink dark:text-white">No evidence yet</h2>
        <p className="mt-2 text-[13px] text-slate-500 dark:text-slate-400">
          Evidence records appear here once a governance evaluation run executes its metrics and specialist agents.
        </p>
      </div>
    </div>
  );
}

function EvidenceError({ message }: { message: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 text-center shadow-card">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 dark:bg-red-950/40 text-red-500">
          <ServerCrash className="h-6 w-6" />
        </div>
        <h2 className="mt-4 font-display text-[18px] text-ink dark:text-white">Backend unavailable</h2>
        <p className="mt-2 text-[13px] text-slate-500 dark:text-slate-400">Could not reach the governance API.</p>
        <code className="mt-3 block truncate rounded bg-slate-50 dark:bg-slate-800 px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400">
          {message}
        </code>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- utils --- */

function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, "");
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
