import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Play, X } from "lucide-react";
import { AuditScopeField, WHOLE_APP_SCOPE, type AuditScope } from "@/components/execution/AuditScopeField";
import { useEvaluationRunner } from "@/hooks/useEvaluationRunner";
import type { BackendAISystem, EvaluationRun } from "@/api/governanceApi";

/**
 * Modal for starting an audit against a fixed system, with the audit-scope
 * picker (whole app vs specific functions). Used by the quick "Run Audit"
 * entry points that previously fired a whole-app run immediately.
 */
export function StartAuditModal({
  system,
  runner,
  onClose,
  onRunCreated,
  onStarted,
}: {
  system: BackendAISystem;
  runner: ReturnType<typeof useEvaluationRunner>;
  onClose: () => void;
  onRunCreated?: (run: EvaluationRun) => void;
  onStarted?: (run: EvaluationRun) => void;
}) {
  const [scope, setScope] = useState<AuditScope>(WHOLE_APP_SCOPE);
  const handleScope = useCallback((s: AuditScope) => setScope(s), []);

  const running = runner.status === "running";
  const canStart = scope.valid && !running;

  async function start() {
    if (!canStart) return;
    // Close as soon as the selection is made — the run itself proceeds in the
    // background (its own state lives in the parent's `runner`, not here), and
    // failures still surface via the global runner status indicator.
    onClose();
    const result = await runner.run(system, {
      selectedCapabilities: scope.capabilities,
      onRunCreated,
    });
    if (result) onStarted?.(result);
  }

  // Portaled to <body> so the fixed overlay is viewport-relative, not relative
  // to the page's transformed `animate-rise` wrapper (which would push it off
  // the viewport). max-h caps the card so it never exceeds the screen.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[3px]" onClick={onClose} />
      <div className="relative z-10 flex max-h-[calc(100vh-2rem)] w-full max-w-md flex-col overflow-y-auto rounded-xl bg-white shadow-2xl ring-1 ring-black/10 dark:bg-slate-900 dark:ring-white/10">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div>
            <p className="text-[15px] font-semibold text-slate-950 dark:text-white">Run Audit</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{system.name}</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 px-5 py-4">
          <AuditScopeField systemId={system.id} onChange={handleScope} />
          {runner.status === "error" && runner.error && (
            <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">
              {runner.error}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 rounded border border-slate-300 py-2.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              disabled={!canStart}
              onClick={() => void start()}
              className="flex flex-1 items-center justify-center gap-2 rounded bg-slate-900 py-2.5 text-[13px] font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950"
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {running ? "Running…" : "Start Audit"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
