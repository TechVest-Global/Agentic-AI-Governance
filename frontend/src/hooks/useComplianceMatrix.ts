import { useCallback, useEffect, useState } from "react";
import {
  getFrameworkMap,
  listFrameworkMappings,
  listAISystems,
  listEvaluationRuns,
  type BackendAISystem,
  type FrameworkComplianceMap,
  type FrameworkControlAssessment,
} from "@/api/governanceApi";
import { rollUpControlStatuses, type MatrixStatus } from "@/pages/auditor/clientComponents";

/**
 * Framework × application compliance matrix, derived read-only from live data.
 * For each application we take its most recent run that produced clause-level
 * results (a non-empty framework-compliance map) and roll each framework's
 * controls into a single cell status. We probe newest → older rather than
 * keying on `report_ready`, because real runs reach clause results during
 * council deliberation but currently hang at `council_running` before flipping
 * status (known backend issue). Nothing is written or recomputed server-side.
 */

// How many recent runs per app to probe (newest first) for clause results.
const CLAUSE_PROBE_LIMIT = 4;

export type MatrixApp = { id: string; name: string };

export type MatrixCell = {
  status: MatrixStatus;
  controls: FrameworkControlAssessment[];
};

export type ComplianceMatrix = {
  loading: boolean;
  error: string | null;
  connected: boolean;
  apps: MatrixApp[];
  frameworks: string[];
  /** key = `${frameworkId}|${appId}` */
  cell: (frameworkId: string, appId: string) => MatrixCell;
  refresh: () => void;
};

function keyOf(fw: string, app: string) {
  return `${fw}|${app}`;
}

export function useComplianceMatrix(): ComplianceMatrix {
  const [state, setState] = useState<{
    loading: boolean;
    error: string | null;
    connected: boolean;
    apps: MatrixApp[];
    frameworks: string[];
    cells: Map<string, MatrixCell>;
  }>({ loading: true, error: null, connected: false, apps: [], frameworks: [], cells: new Map() });
  const [token, setToken] = useState(0);
  const refresh = useCallback(() => setToken((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    (async () => {
      try {
        const [systems, runs, frameworkMappings] = await Promise.all([
          listAISystems().catch(() => [] as BackendAISystem[]),
          listEvaluationRuns(50),
          listFrameworkMappings({ limit: 100 }).catch(() => []),
        ]);
        if (cancelled) return;
        const requirementByControl = new Map(
          frameworkMappings.map((mapping) => [
            `${mapping.framework_id}|${mapping.control_ref}`,
            mapping.requirement_text ?? null,
          ]),
        );

        // Recent run ids per application, newest first.
        const runsByApp = new Map<string, string[]>();
        const sortedRuns = [...runs].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        for (const r of sortedRuns) {
          const arr = runsByApp.get(r.ai_system_id) ?? [];
          arr.push(r.id);
          runsByApp.set(r.ai_system_id, arr);
        }

        const nameById = new Map(systems.map((s) => [s.id, s.name]));
        const appIds = Array.from(runsByApp.keys());

        // Per app, probe newest → older until we hit a run with clause results.
        const maps = await Promise.all(
          appIds.map(async (appId) => {
            for (const runId of runsByApp.get(appId)!.slice(0, CLAUSE_PROBE_LIMIT)) {
              const m = await getFrameworkMap(runId).catch(() => null);
              if (m && m.control_count > 0) return m;
            }
            return null;
          }),
        );
        if (cancelled) return;

        const frameworkSet = new Set<string>();
        const cells = new Map<string, MatrixCell>();
        const apps: MatrixApp[] = [];

        appIds.forEach((appId, i) => {
          const map: FrameworkComplianceMap | null = maps[i];
          if (!map) return; // no clause results for this app → omit the column
          apps.push({ id: appId, name: nameById.get(appId) ?? "Application" });
          map.selected_frameworks.forEach((f) => frameworkSet.add(f));
          // Group this app's controls by framework, roll up to one status.
          const byFramework = new Map<string, FrameworkControlAssessment[]>();
          for (const c of map.controls) {
            const control = {
              ...c,
              requirement_text: requirementByControl.get(`${c.framework_id}|${c.control_ref}`) ?? null,
            };
            const arr = byFramework.get(c.framework_id) ?? [];
            arr.push(control);
            byFramework.set(c.framework_id, arr);
          }
          for (const [fw, controls] of byFramework) {
            frameworkSet.add(fw);
            cells.set(keyOf(fw, appId), {
              status: rollUpControlStatuses(controls.map((c) => c.status)),
              controls,
            });
          }
        });

        setState({
          loading: false,
          error: null,
          connected: true,
          apps,
          frameworks: Array.from(frameworkSet).sort(),
          cells,
        });
      } catch (error) {
        if (!cancelled) {
          setState({
            loading: false,
            error: error instanceof Error ? error.message : "Could not load compliance data.",
            connected: false,
            apps: [],
            frameworks: [],
            cells: new Map(),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const cell = useCallback(
    (frameworkId: string, appId: string): MatrixCell =>
      state.cells.get(keyOf(frameworkId, appId)) ?? { status: "not_in_scope", controls: [] },
    [state.cells],
  );

  return {
    loading: state.loading,
    error: state.error,
    connected: state.connected,
    apps: state.apps,
    frameworks: state.frameworks,
    cell,
    refresh,
  };
}
