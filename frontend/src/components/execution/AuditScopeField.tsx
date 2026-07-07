import { useEffect, useState } from "react";
import clsx from "clsx";
import { listCapabilities, type BackendAISystemCapability } from "@/api/governanceApi";

export type AuditScope = {
  mode: "app" | "functions";
  // Capability endpoint_refs to probe. Empty when mode === "app".
  capabilities: string[];
  // False when "functions" is chosen but nothing is selected (blocks starting).
  valid: boolean;
};

export const WHOLE_APP_SCOPE: AuditScope = { mode: "app", capabilities: [], valid: true };

/**
 * Lets an auditor scope a run to the whole application (base endpoint) or a
 * chosen subset of a system's callable functions. Loads the system's
 * capabilities itself and reports the current scope up via onChange. Renders
 * nothing interactive for systems with <= 1 endpoint (whole-app is implied).
 */
export function AuditScopeField({
  systemId,
  onChange,
}: {
  systemId: string | null;
  onChange: (scope: AuditScope) => void;
}) {
  const [capabilities, setCapabilities] = useState<BackendAISystemCapability[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"app" | "functions">("app");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Load capabilities whenever the system changes; reset to whole-app scope.
  useEffect(() => {
    setMode("app");
    setSelected(new Set());
    setCapabilities([]);
    onChange(WHOLE_APP_SCOPE);
    if (!systemId) return;
    let cancelled = false;
    setLoading(true);
    listCapabilities(systemId)
      .then((caps) => {
        if (!cancelled) setCapabilities(caps.filter((c) => c.enabled));
      })
      .catch(() => {
        if (!cancelled) setCapabilities([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // onChange is expected to be stable (useCallback) from the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemId]);

  // Report scope up whenever the user's choice changes.
  useEffect(() => {
    if (mode === "app") {
      onChange(WHOLE_APP_SCOPE);
    } else {
      const caps = Array.from(selected);
      onChange({ mode: "functions", capabilities: caps, valid: caps.length > 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selected]);

  function toggle(endpointRef: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(endpointRef)) next.delete(endpointRef);
      else next.add(endpointRef);
      return next;
    });
  }

  if (!systemId) return null;

  return (
    <div className="space-y-2">
      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
        Audit scope
      </label>
      {loading ? (
        <p className="text-[11px] text-slate-400">Loading functions…</p>
      ) : capabilities.length <= 1 ? (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          This system exposes{" "}
          {capabilities.length === 1 ? "a single endpoint" : "no separate functions"} — the whole
          application will be audited.
        </p>
      ) : (
        <>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode("app")}
              className={clsx(
                "flex-1 rounded border px-3 py-2 text-[11px] font-medium transition-colors",
                mode === "app"
                  ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/40 dark:text-blue-300"
                  : "border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800",
              )}
            >
              Entire application
            </button>
            <button
              type="button"
              onClick={() => setMode("functions")}
              className={clsx(
                "flex-1 rounded border px-3 py-2 text-[11px] font-medium transition-colors",
                mode === "functions"
                  ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/40 dark:text-blue-300"
                  : "border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800",
              )}
            >
              Specific functions
            </button>
          </div>
          {mode === "functions" && (
            <div className="max-h-44 space-y-1 overflow-y-auto rounded border border-slate-200 p-2 dark:border-slate-700">
              {capabilities.map((c) => (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[11px] text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(c.endpoint_ref)}
                    onChange={() => toggle(c.endpoint_ref)}
                    className="h-3.5 w-3.5"
                  />
                  <span className="font-medium">{c.name}</span>
                  <span className="ml-auto font-mono text-[10px] text-slate-400">
                    {c.http_method} {c.endpoint_ref}
                  </span>
                </label>
              ))}
              <p className="px-2 pt-1 text-[10px] text-slate-400">
                {selected.size} of {capabilities.length} selected
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
