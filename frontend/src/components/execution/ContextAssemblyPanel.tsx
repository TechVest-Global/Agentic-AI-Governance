import { useEffect, useState } from "react";
import { Loader2, ScanSearch } from "lucide-react";
import { getContextAssembly, type ContextAssemblyRead } from "@/api/governanceApi";
import { DrawerSection, DrawerTable, SeverityPill, StatGrid } from "@/components/execution/DrawerPrimitives";

function titleCase(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Real log-analysis, regulatory-context, and coverage-gap output from the Context Assembly layer. */
export function ContextAssemblyPanel({ runId }: { runId: string | null }) {
  const [ctx, setCtx] = useState<ContextAssemblyRead | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!runId) { setCtx(null); return; }
    setLoading(true);
    getContextAssembly(runId).then(setCtx).finally(() => setLoading(false));
  }, [runId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 justify-center text-[12px] text-slate-500 dark:text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading context assembly…
      </div>
    );
  }

  if (!ctx) {
    return (
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-4 py-8 text-center">
        <ScanSearch className="mx-auto h-6 w-6 text-slate-300 dark:text-slate-600 mb-2" />
        <p className="text-[12.5px] text-slate-500 dark:text-slate-400">
          {runId ? "No context assembly recorded for this run yet." : "No active run selected."}
        </p>
      </div>
    );
  }

  const log = ctx.log_analysis;
  const reg = ctx.regulatory_context;

  return (
    <div>
      <DrawerSection label="Production log analysis">
        {log.empty ? (
          <p className="text-[12.5px] text-slate-500 dark:text-slate-400">No production logs available for this system.</p>
        ) : (
          <StatGrid
            stats={[
              ["Requests", `${log.total_requests}`],
              ["Categories", `${log.distinct_request_categories}`],
              ["PII flagged", `${log.pii_request_count}`],
              ["Flagged", `${log.flagged_request_count}`],
            ]}
          />
        )}
      </DrawerSection>

      {log.distinct_demographic_groups > 0 && (
        <DrawerSection label="Demographic coverage">
          <DrawerTable
            columns={["Group", "Requests"]}
            rows={Object.entries(log.demographic_coverage).map(([k, v]) => [titleCase(k), `${v}`])}
          />
        </DrawerSection>
      )}

      <DrawerSection label="Regulatory context">
        <StatGrid
          stats={[
            ["Selected", `${reg.selected_frameworks.length}`],
            ["Resolved", `${reg.resolved_frameworks.length}`],
            ["Missing", `${reg.missing_frameworks.length}`],
            ["Controls", `${reg.control_count}`],
          ]}
        />
        {reg.missing_frameworks.length > 0 && (
          <p className="mt-2 text-[11.5px] text-amber-700 dark:text-amber-400">
            Missing: {reg.missing_frameworks.map(titleCase).join(", ")}
          </p>
        )}
      </DrawerSection>

      <DrawerSection label={`Coverage gaps (${ctx.gap_count})`}>
        {ctx.coverage_gaps.length === 0 ? (
          <p className="text-[12.5px] text-slate-500 dark:text-slate-400">No coverage gaps detected.</p>
        ) : (
          <DrawerTable
            columns={["Dimension", "Severity", "Description"]}
            rows={ctx.coverage_gaps.map((g) => [titleCase(g.dimension), <SeverityPill key={g.gap_id} severity={g.severity} />, g.description])}
          />
        )}
      </DrawerSection>
    </div>
  );
}
