import { useEffect, useState } from "react";
import clsx from "clsx";
import { useComplianceMatrix } from "@/hooks/useComplianceMatrix";
import { useAuditorApplication } from "@/hooks/useAuditorApplication";
import { AuditorPageHeader, AuditorSkeleton, BackendError } from "./components";
import { ControlAssurance } from "./ControlAssurance";

/**
 * Compliance — framework-routed, per application. One page per app rendering the
 * shared <FrameworkExplorer>: a grid of the frameworks that assessed the app
 * (each a lens over the same underlying checks, with passed/failed/warning/
 * manual counts), then drill into a framework to see its clauses + mapped metric
 * results. Multiple apps get a switcher on top; a single app opens straight in.
 * Read-only over the real framework-map data.
 */

export function Compliance() {
  const m = useComplianceMatrix();
  const [appId, setAppId] = useState<string | null>(null);
  const app = useAuditorApplication(appId);

  useEffect(() => {
    if (!appId && m.apps.length) setAppId(m.apps[0].id);
  }, [m.apps, appId]);

  if (m.loading || (appId && app.loading)) {
    return <div className="space-y-5"><AuditorPageHeader eyebrow="Assurance" title="Compliance" description="Choose a framework to see how this application is assessed against it, clause by clause." /><AuditorSkeleton rows={3} /></div>;
  }
  if (m.error) {
    return <div className="space-y-5"><AuditorPageHeader eyebrow="Assurance" title="Compliance" /><BackendError message={m.error} onRetry={m.refresh} /></div>;
  }
  if (app.error) {
    return <div className="space-y-5"><AuditorPageHeader eyebrow="Assurance" title="Compliance" /><BackendError message={app.error} onRetry={app.refresh} /></div>;
  }
  if (m.apps.length === 0) {
    return (
      <div className="space-y-5">
        <AuditorPageHeader eyebrow="Assurance" title="Compliance" connected={m.connected} onRefresh={m.refresh} />
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-10 text-center text-[13px] text-slate-500 dark:text-slate-400">
          No assessed applications with framework mappings yet.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <AuditorPageHeader
        eyebrow="Assurance"
        title="Compliance"
        description="Choose a framework to see how this application is assessed against it, clause by clause."
        connected={m.connected}
        onRefresh={m.refresh}
      />

      {/* app switcher (only when >1 app) */}
      {m.apps.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {m.apps.map((a) => (
            <button
              key={a.id}
              onClick={() => setAppId(a.id)}
              className={clsx(
                "rounded-full px-3 py-1 text-[12px] font-medium transition-colors",
                appId === a.id ? "bg-brand-600 text-white" : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 ring-1 ring-black/5 dark:ring-white/10 hover:bg-slate-50 dark:hover:bg-slate-700",
              )}
            >
              {a.name}
            </button>
          ))}
        </div>
      )}

      {appId && app.system && app.report ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-hairline dark:border-white/10 bg-white dark:bg-slate-900 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">Selected application</p>
            <p className="mt-1 text-[15px] font-semibold text-ink dark:text-white">{app.system.name}</p>
          </div>
          <ControlAssurance
            key={appId}
            frameworks={app.system.selected_frameworks.length ? app.system.selected_frameworks : m.frameworks}
            metricResults={app.report.metric_results}
            lastAssessed={app.assessedRun?.created_at ?? null}
            plan={app.report.metric_plan?.metrics ?? []}
            runId={app.report.run.id}
          />
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-10 text-center text-[13px] text-slate-500 dark:text-slate-400">
          Select an assessed application to view compliance.
        </div>
      )}
    </div>
  );
}
