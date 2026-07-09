import { useEffect, useState } from "react";
import clsx from "clsx";
import { useComplianceMatrix } from "@/hooks/useComplianceMatrix";
import { AuditorPageHeader, AuditorSkeleton, BackendError } from "./components";
import { FrameworkExplorer } from "./FrameworkExplorer";

/**
 * Compliance — clause-first, framework-routed. One page per application: the
 * auditor first sees the frameworks that assessed the app as a grid of cards and
 * chooses which one to open (see FrameworkExplorer). Multiple apps get a switcher
 * on top. Read-only over the real framework-map data.
 */

export function Compliance() {
  const m = useComplianceMatrix();
  const [appId, setAppId] = useState<string | null>(null);

  useEffect(() => {
    if (!appId && m.apps.length) setAppId(m.apps[0].id);
  }, [m.apps, appId]);

  if (m.loading) {
    return <div className="space-y-5"><AuditorPageHeader eyebrow="Assurance" title="Compliance" description="Choose a framework to see how this application is assessed against it, clause by clause." /><AuditorSkeleton rows={3} /></div>;
  }
  if (m.error) {
    return <div className="space-y-5"><AuditorPageHeader eyebrow="Assurance" title="Compliance" /><BackendError message={m.error} onRetry={m.refresh} /></div>;
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

      {appId && (
        <FrameworkExplorer
          key={appId}
          frameworks={m.frameworks}
          controlsFor={(fw) => m.cell(fw, appId).controls}
        />
      )}
    </div>
  );
}
