import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Database,
  GitBranch,
  Layers,
  Loader2,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import clsx from "clsx";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { MetricCard } from "@/components/ui/MetricCard";
import {
  listGovernanceState,
  verifyGovernanceState,
  type ChainVerification,
  type GovernanceStateEntry,
} from "@/api/governanceApi";
import { useActiveRun } from "@/hooks/useActiveRun";

const ALL = "__all__";

function humanize(value: string): string {
  return value
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function shortHash(hash: string | null | undefined): string {
  if (!hash) return "—";
  return hash.length > 12 ? `${hash.slice(0, 12)}…` : hash;
}

function sourceTone(source: string): "blue" | "violet" | "amber" | "green" | "slate" {
  const key = source.toLowerCase();
  if (key.includes("orchestrat")) return "violet";
  if (key.includes("agent")) return "blue";
  if (key.includes("council") || key.includes("verdict")) return "amber";
  if (key.includes("metric") || key.includes("evidence")) return "green";
  return "slate";
}

export function GovernanceStatePage() {
  const { runId, loading: runsLoading } = useActiveRun();

  const [entries, setEntries] = useState<GovernanceStateEntry[]>([]);
  const [verification, setVerification] = useState<ChainVerification | null>(null);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entriesError, setEntriesError] = useState<string | null>(null);

  const [phaseFilter, setPhaseFilter] = useState<string>(ALL);
  const [sourceFilter, setSourceFilter] = useState<string>(ALL);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadRun = useCallback(async (activeRunId: string) => {
    if (!activeRunId) return;
    setEntriesLoading(true);
    setEntriesError(null);
    setExpandedId(null);
    setPhaseFilter(ALL);
    setSourceFilter(ALL);
    try {
      const [stateEntries, chain] = await Promise.all([
        listGovernanceState(activeRunId, 200),
        verifyGovernanceState(activeRunId),
      ]);
      setEntries(stateEntries);
      setVerification(chain);
    } catch (err) {
      setEntries([]);
      setVerification(null);
      setEntriesError(err instanceof Error ? err.message : "Failed to load governance state.");
    } finally {
      setEntriesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (runId) void loadRun(runId);
  }, [runId, loadRun]);

  const orderedEntries = useMemo(
    () => [...entries].sort((a, b) => a.sequence_number - b.sequence_number),
    [entries],
  );

  const phases = useMemo(
    () => Array.from(new Set(orderedEntries.map((e) => e.phase))).sort(),
    [orderedEntries],
  );
  const sources = useMemo(
    () => Array.from(new Set(orderedEntries.map((e) => e.source))).sort(),
    [orderedEntries],
  );

  const visibleEntries = useMemo(
    () =>
      orderedEntries.filter(
        (e) =>
          (phaseFilter === ALL || e.phase === phaseFilter) &&
          (sourceFilter === ALL || e.source === sourceFilter),
      ),
    [orderedEntries, phaseFilter, sourceFilter],
  );

  const selectClass =
    "h-9 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 text-[12px] text-slate-900 dark:text-white outline-none focus:border-blue-500";

  return (
    <div className="space-y-5">
      {/* Intro */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-700 pb-5">
        <div className="max-w-2xl space-y-1">
          <p className="text-[13px] leading-5 text-slate-600 dark:text-slate-300">
            The governance state chain is an append-only, hash-linked record of every event in an evaluation run.
            Each entry references the previous entry's hash, so any run can be deterministically reconstructed and
            any tampering is immediately detectable.
          </p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            The active run (selected from the header switcher) loads its state chain (up to 200 entries) and verifies chain integrity.
          </p>
        </div>
      </div>

      {!runsLoading && runId === null && (
        <Card>
          <div className="px-5 py-10 text-center text-[13px] text-slate-500 dark:text-slate-400">
            No evaluation runs exist yet. Create and run an evaluation to populate the governance state chain.
          </div>
        </Card>
      )}

      {runId && (
        <>
          {/* Chain integrity banner */}
          <ChainBanner loading={entriesLoading} error={entriesError} verification={verification} />

          {/* Summary metrics */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricCard
              label="Entries"
              value={entriesLoading ? "—" : orderedEntries.length}
              icon={Database}
              tone="blue"
              detail="Append-only state records"
            />
            <MetricCard
              label="Phases"
              value={entriesLoading ? "—" : phases.length}
              icon={Layers}
              tone="brand"
              detail="Distinct run phases"
            />
            <MetricCard
              label="Sources"
              value={entriesLoading ? "—" : sources.length}
              icon={GitBranch}
              tone="slate"
              detail="Distinct event sources"
            />
            <MetricCard
              label="Chain Status"
              value={
                entriesLoading
                  ? "…"
                  : verification
                    ? verification.valid
                      ? "Valid"
                      : "Invalid"
                    : "Unknown"
              }
              icon={verification && !verification.valid ? ShieldX : ShieldCheck}
              tone={verification ? (verification.valid ? "green" : "red") : "slate"}
              detail={
                verification ? `${verification.entry_count} entries verified` : "Verification unavailable"
              }
            />
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                Phase
              </span>
              <select
                value={phaseFilter}
                onChange={(e) => setPhaseFilter(e.target.value)}
                disabled={entriesLoading || phases.length === 0}
                className={clsx(selectClass, "w-56")}
              >
                <option value={ALL}>All phases</option>
                {phases.map((phase) => (
                  <option key={phase} value={phase}>
                    {humanize(phase)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                Source
              </span>
              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                disabled={entriesLoading || sources.length === 0}
                className={clsx(selectClass, "w-56")}
              >
                <option value={ALL}>All sources</option>
                {sources.map((source) => (
                  <option key={source} value={source}>
                    {humanize(source)}
                  </option>
                ))}
              </select>
            </label>
            {!entriesLoading && visibleEntries.length !== orderedEntries.length && (
              <span className="pb-2 text-[11px] text-slate-500 dark:text-slate-400">
                Showing {visibleEntries.length} of {orderedEntries.length} entries
              </span>
            )}
          </div>

          {/* State chain table */}
          <Card>
            <CardHeader
              title="Governance State Chain"
              eyebrow={`Hash-linked entries · ordered by sequence${entriesLoading ? " · loading" : ""}`}
            />

            {entriesLoading && (
              <div className="flex items-center justify-center gap-2 px-5 py-12 text-[13px] text-slate-500 dark:text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading state chain…
              </div>
            )}

            {!entriesLoading && entriesError && (
              <div className="flex items-start gap-3 px-5 py-8 text-[13px] text-red-700 dark:text-red-400">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{entriesError}</span>
              </div>
            )}

            {!entriesLoading && !entriesError && visibleEntries.length === 0 && (
              <div className="px-5 py-10 text-center text-[13px] text-slate-500 dark:text-slate-400">
                {orderedEntries.length === 0
                  ? "This run has no governance state entries yet."
                  : "No entries match the current filters."}
              </div>
            )}

            {!entriesLoading && !entriesError && visibleEntries.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                      <th className="px-4 py-2.5 font-semibold">#</th>
                      <th className="px-4 py-2.5 font-semibold">Entry Type</th>
                      <th className="px-4 py-2.5 font-semibold">Source</th>
                      <th className="px-4 py-2.5 font-semibold">Phase</th>
                      <th className="px-4 py-2.5 font-semibold">Created</th>
                      <th className="px-4 py-2.5 font-semibold">Prev Hash</th>
                      <th className="px-4 py-2.5 font-semibold">Entry Hash</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                    {visibleEntries.map((entry) => {
                      const isExpanded = expandedId === entry.id;
                      return (
                        <Fragment key={entry.id}>
                          <tr
                            onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                            className="cursor-pointer text-[12px] text-slate-700 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
                          >
                            <td className="px-4 py-3 font-mono font-semibold text-slate-900 dark:text-white tabular-nums">
                              {entry.sequence_number}
                            </td>
                            <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                              {humanize(entry.entry_type)}
                            </td>
                            <td className="px-4 py-3">
                              <Badge tone={sourceTone(entry.source)}>{humanize(entry.source)}</Badge>
                            </td>
                            <td className="px-4 py-3">
                              <Badge tone="slate">{humanize(entry.phase)}</Badge>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-slate-500 dark:text-slate-400">
                              {new Date(entry.created_at).toLocaleString()}
                            </td>
                            <td className="px-4 py-3 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                              {shortHash(entry.previous_hash)}
                            </td>
                            <td className="px-4 py-3 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                              {shortHash(entry.entry_hash)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {isExpanded ? (
                                <ChevronDown className="ml-auto h-4 w-4 text-slate-400 dark:text-slate-500" />
                              ) : (
                                <ChevronRight className="ml-auto h-4 w-4 text-slate-400 dark:text-slate-500" />
                              )}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-slate-50 dark:bg-slate-800/60">
                              <td colSpan={8} className="px-4 py-4">
                                <div className="grid gap-4 lg:grid-cols-2">
                                  <div className="space-y-2">
                                    <div>
                                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                        Previous Hash
                                      </p>
                                      <p className="mt-1 break-all font-mono text-[11px] text-slate-700 dark:text-slate-300">
                                        {entry.previous_hash ?? "GENESIS (chain root)"}
                                      </p>
                                    </div>
                                    <div>
                                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                        Entry Hash
                                      </p>
                                      <p className="mt-1 break-all font-mono text-[11px] text-slate-900 dark:text-white">
                                        {entry.entry_hash}
                                      </p>
                                    </div>
                                    <div>
                                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                        Entry ID
                                      </p>
                                      <p className="mt-1 break-all font-mono text-[11px] text-slate-500 dark:text-slate-400">
                                        {entry.id}
                                      </p>
                                    </div>
                                  </div>
                                  <div>
                                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                      Payload
                                    </p>
                                    <pre className="mt-1 max-h-72 overflow-auto rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-slate-700 dark:text-slate-300">
                                      {entry.payload
                                        ? JSON.stringify(entry.payload, null, 2)
                                        : "No payload recorded for this entry."}
                                    </pre>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function ChainBanner({
  loading,
  error,
  verification,
}: {
  loading: boolean;
  error: string | null;
  verification: ChainVerification | null;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-5 py-4">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" />
        <p className="text-[13px] font-medium text-slate-600 dark:text-slate-300">Verifying chain integrity…</p>
      </div>
    );
  }

  if (error || !verification) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-5 py-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div>
          <p className="text-[13px] font-semibold text-amber-800 dark:text-amber-300">Chain verification unavailable</p>
          <p className="mt-0.5 text-[12px] text-amber-700 dark:text-amber-400">
            {error ?? "The verification endpoint did not return a result for this run."}
          </p>
        </div>
      </div>
    );
  }

  if (verification.valid) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 px-5 py-4">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <div>
          <p className="text-[13px] font-semibold text-emerald-800 dark:text-emerald-300">
            Chain valid — {verification.entry_count} {verification.entry_count === 1 ? "entry" : "entries"} verified
          </p>
          <p className="mt-0.5 text-[12px] text-emerald-700 dark:text-emerald-400">
            Every entry's hash links correctly to its predecessor. No tampering detected.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-5 py-4">
      <ShieldX className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
      <div>
        <p className="text-[13px] font-semibold text-red-800 dark:text-red-300">
          Chain INVALID — integrity check failed
        </p>
        <p className="mt-0.5 text-[12px] text-red-700 dark:text-red-400">
          {verification.reason ?? "Hash mismatch detected in the state chain."}
          {verification.failed_sequence != null && (
            <> First failure at sequence #{verification.failed_sequence}.</>
          )}
          {verification.failed_entry_id && (
            <> Failed entry: <span className="font-mono">{verification.failed_entry_id}</span>.</>
          )}
        </p>
      </div>
    </div>
  );
}
