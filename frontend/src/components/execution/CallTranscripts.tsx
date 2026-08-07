import { useMemo, useState } from "react";
import { AlertTriangle, Terminal } from "lucide-react";
import clsx from "clsx";
import type { LlmCall } from "@/api/governanceApi";
import { CallTranscriptRow } from "@/components/execution/AgentDetailCard";

/**
 * Every LLM call one pipeline layer made, with its full prompt and response.
 *
 * The per-agent Probes tab only ever showed calls whose `agent_name` matched a
 * specialist agent's execution row. On a real run that hid most of the record:
 * Layer 3a evaluator calls are attributed to their tool (deepeval, ragas,
 * presidio) and the council's are attributed to nobody, so on a live TechVest
 * run 30 of 32 stored transcripts rendered nowhere at all — including every
 * target probe that was actually sent.
 *
 * Driven by the caller's already-polled call list rather than its own fetch, so
 * it fills in live as a phase runs.
 */
export function CallTranscripts({
  calls,
  phase,
  title = "Call Transcripts",
  emptyHint,
}: {
  calls: LlmCall[];
  /** Restrict to one pipeline layer. Omit to show the whole run. */
  phase?: string;
  title?: string;
  emptyHint?: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  // Runs recorded before the gateway stamped a phase have none at all. Say so
  // rather than either showing an empty panel — which reads as "this layer made
  // no calls" — or falling back to the unfiltered set, which would repeat the
  // whole run's transcript identically under all four layers.
  const legacyRun = Boolean(phase) && calls.length > 0 && !calls.some((c) => c.phase);

  const scoped = useMemo(() => {
    if (!phase || legacyRun) return phase ? [] : calls;
    return calls.filter((c) => c.phase === phase);
  }, [calls, phase, legacyRun]);

  const groups = useMemo(() => {
    const order: string[] = [];
    const bySource = new Map<string, LlmCall[]>();
    for (const call of scoped) {
      const source = sourceLabel(call);
      if (!bySource.has(source)) {
        bySource.set(source, []);
        order.push(source);
      }
      bySource.get(source)!.push(call);
    }
    return order.map((source) => ({ source, calls: bySource.get(source)! }));
  }, [scoped]);

  const targetCount = scoped.filter((c) => c.call_type === "target").length;
  const errorCount = scoped.filter((c) => c.status !== "success").length;
  const totalTokens = scoped.reduce((sum, c) => sum + (c.total_tokens ?? 0), 0);
  const totalCost = scoped.reduce((sum, c) => sum + (c.estimated_cost_usd ?? 0), 0);

  return (
    <div className="rounded-xl bg-white dark:bg-slate-900 shadow-card ring-1 ring-black/3 dark:ring-white/6">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-700/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-slate-500 dark:text-slate-400" />
          <div>
            <p className="text-[13px] font-semibold text-slate-950 dark:text-white">{title}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Exactly what was sent and what came back — every call this layer made.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill label="calls" value={scoped.length} />
          <Pill label="target probes" value={targetCount} />
          <Pill label="errors" value={errorCount} tone={errorCount ? "red" : "slate"} />
          {totalTokens > 0 && <Pill label="tokens" value={totalTokens} />}
          {totalCost > 0 && <Pill label="cost" value={`$${totalCost.toFixed(4)}`} />}
        </div>
      </div>

      {scoped.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <Terminal className="mx-auto mb-2 h-6 w-6 text-slate-300 dark:text-slate-600" />
          <p className="text-[12px] text-slate-500 dark:text-slate-400">
            {legacyRun
              ? `This run predates per-layer call attribution — its ${calls.length} recorded calls carry no layer. Open a specialist agent's Runtime tab to read them, or start a new run for layer-scoped transcripts.`
              : (emptyHint ?? "No model calls recorded for this layer yet.")}
          </p>
        </div>
      ) : (
        <div className="space-y-4 p-4">
          {groups.map((group) => (
            <div key={group.source} className="space-y-2">
              <div className="flex items-center gap-2">
                <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                  {group.source}
                </p>
                <span className="text-[10px] text-slate-400 dark:text-slate-500">
                  {group.calls.length} call{group.calls.length === 1 ? "" : "s"}
                </span>
                {group.calls.some((c) => c.status !== "success") && (
                  <span className="flex items-center gap-1 text-[10px] font-medium text-red-600 dark:text-red-400">
                    <AlertTriangle className="h-3 w-3" />
                    {group.calls.filter((c) => c.status !== "success").length} failed
                  </span>
                )}
              </div>
              <div className="space-y-2">
                {group.calls.map((call, i) => (
                  <CallTranscriptRow
                    key={call.id}
                    call={call}
                    number={i + 1}
                    open={expanded === call.id}
                    onToggle={() => setExpanded(expanded === call.id ? null : call.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Who made the call. Evaluator calls carry their tool name; the council and the
 *  orchestrator's plan review carry none, so name them from their phase rather
 *  than lumping both under "unattributed". */
function sourceLabel(call: LlmCall): string {
  if (call.agent_name) return call.agent_name.replace(/_/g, " ");
  if (call.phase === "deliberation_council") return "Deliberation Council";
  if (call.phase === "adaptive_orchestrator") return "Adaptive Orchestrator";
  return "Unattributed";
}

function Pill({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: string | number;
  tone?: "slate" | "red";
}) {
  return (
    <span
      className={clsx(
        "rounded border px-2 py-1 text-[10px] font-medium",
        tone === "red"
          ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400"
          : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300",
      )}
    >
      <span className="font-semibold text-slate-900 dark:text-white">{value}</span> {label}
    </span>
  );
}
