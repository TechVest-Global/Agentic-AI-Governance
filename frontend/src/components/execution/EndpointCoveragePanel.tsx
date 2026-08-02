import { useEffect, useState } from "react";
import { AlertTriangle, Server } from "lucide-react";
import clsx from "clsx";
import { getEndpointCoverage, type EndpointCoverageSummary } from "@/api/governanceApi";
import { Card, CardHeader } from "@/components/ui/Card";

/**
 * Which audited surface received which probes.
 *
 * A system registered with several capability endpoints is several independent
 * audit surfaces, but a run only ever reported one "probes sent" total across
 * all of them — so a run that fired every probe at one endpoint and none at
 * another looked identical to one that covered both. Registered endpoints that
 * received nothing are listed first and called out, because an unprobed surface
 * is the finding here, not a footnote.
 */
export function EndpointCoveragePanel({ runId }: { runId: string | null }) {
  const [coverage, setCoverage] = useState<EndpointCoverageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) {
      setCoverage(null);
      return;
    }
    let cancelled = false;
    getEndpointCoverage(runId)
      .then((data) => { if (!cancelled) { setCoverage(data); setError(null); } })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load coverage.");
      });
    return () => { cancelled = true; };
  }, [runId]);

  if (!runId) return null;
  if (error) {
    return (
      <Card>
        <CardHeader title="Endpoint Coverage" />
        <p className="p-4 text-[12.5px] text-slate-500 dark:text-slate-400">{error}</p>
      </Card>
    );
  }
  if (!coverage || coverage.endpoints.length === 0) return null;

  const unprobed = coverage.unprobed_endpoint_count;
  const totalProbes = coverage.endpoints.reduce((n, e) => n + e.probes_sent, 0);
  const totalRequests = coverage.endpoints.reduce((n, e) => n + e.requests_made, 0);

  return (
    <Card>
      <CardHeader
        title="Endpoint Coverage"
        eyebrow={`${totalProbes} probe${totalProbes === 1 ? "" : "s"} across ${coverage.endpoints.length} endpoint${coverage.endpoints.length === 1 ? "" : "s"}`}
      />

      {unprobed > 0 && (
        <div className="mx-4 mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900/50 dark:bg-amber-900/20">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-[12px] leading-relaxed text-amber-800 dark:text-amber-300">
            <span className="font-semibold">
              {unprobed} of {coverage.registered_endpoint_count} registered endpoint
              {coverage.registered_endpoint_count === 1 ? "" : "s"} received no probes.
            </span>{" "}
            This run says nothing about their behaviour — it should not be read as
            covering those surfaces.
          </p>
        </div>
      )}

      <div className="overflow-x-auto px-4 pb-4">
        <table className="w-full min-w-[640px] text-left text-[12.5px]">
          <thead>
            <tr className="border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:border-slate-700 dark:text-slate-500">
              <th className="py-2 pr-3 font-bold">Endpoint</th>
              <th className="py-2 pr-3 text-right font-bold">Probes</th>
              <th className="py-2 pr-3 text-right font-bold">Errors</th>
              <th className="py-2 pr-3 text-right font-bold">Skipped</th>
              {/* Separate from Probes on purpose: retries mean one probe can be
                  several requests, and merging the two makes both numbers lie. */}
              <th className="py-2 pr-3 text-right font-bold">Requests</th>
              <th className="py-2 font-bold">Agents</th>
            </tr>
          </thead>
          <tbody>
            {coverage.endpoints.map((e) => {
              const touched = e.probes_sent + e.probes_failed > 0;
              return (
                <tr
                  key={e.endpoint_ref ?? "unattributed"}
                  className="border-b border-slate-100 align-top last:border-0 dark:border-slate-800"
                >
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-1.5">
                      <Server className="h-3 w-3 shrink-0 text-slate-400 dark:text-slate-500" />
                      <span className="font-semibold text-slate-700 dark:text-slate-200">
                        {e.capability_name ?? (e.endpoint_ref ? "Unregistered endpoint" : "Unattributed")}
                      </span>
                      {!e.registered && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                          {e.endpoint_ref ? "unregistered" : "pre-upgrade"}
                        </span>
                      )}
                      {e.modality && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                          {e.modality}
                        </span>
                      )}
                    </div>
                    {/* Rendered lowercase and monospaced: this is a URL, not a
                        title. It used to arrive glued onto the probe name and
                        got title-cased into "Http://Localhost:8001/...". */}
                    <p className="mt-0.5 break-all font-mono text-[10.5px] lowercase text-slate-400 dark:text-slate-500">
                      {e.endpoint_ref ?? "no endpoint recorded for these calls"}
                    </p>
                    {e.sample_error && (
                      <p className="mt-1 break-words text-[11px] text-red-600 dark:text-red-400">
                        {e.sample_error}
                      </p>
                    )}
                  </td>
                  <td
                    className={clsx(
                      "py-2 pr-3 text-right font-semibold tabular-nums",
                      touched
                        ? "text-slate-700 dark:text-slate-200"
                        : "text-amber-600 dark:text-amber-400",
                    )}
                  >
                    {e.probes_sent}
                  </td>
                  <td
                    className={clsx(
                      "py-2 pr-3 text-right tabular-nums",
                      e.probes_failed > 0
                        ? "font-semibold text-red-600 dark:text-red-400"
                        : "text-slate-400 dark:text-slate-500",
                    )}
                  >
                    {e.probes_failed}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-slate-400 dark:text-slate-500">
                    {e.probes_skipped}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-slate-400 dark:text-slate-500">
                    {e.requests_made}
                  </td>
                  <td className="py-2 text-[11px] text-slate-500 dark:text-slate-400">
                    {e.agents.length ? e.agents.join(", ") : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {totalRequests > totalProbes && (
          <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
            {totalRequests} HTTP requests for {totalProbes} probes — the difference is
            retries after transient failures.
          </p>
        )}
      </div>
    </Card>
  );
}
