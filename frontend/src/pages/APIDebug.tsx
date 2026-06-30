import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Link2,
  Loader2,
  Play,
  Server,
  ShieldCheck,
  Terminal,
  UserCircle2,
  XCircle,
} from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { listAISystems, listEvaluationRuns } from "@/api/governanceApi";
import { useAuthStore } from "@/store/useAuthStore";
import { personaForRole } from "@/lib/persona";
import { permissionsFor } from "@/lib/permissions";
import type { Permission } from "@/types";

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ??
  "http://127.0.0.1:8000/api/v1";

const IS_LOCAL = API_BASE.includes("127.0.0.1") || API_BASE.includes("localhost");

type ProbeState = "checking" | "ok" | "down";

type Probe = {
  key: string;
  label: string;
  description: string;
  status: ProbeState;
  latencyMs: number | null;
  detail?: string;
};

const INITIAL_PROBES: Probe[] = [
  { key: "health", label: "Health", description: "GET /health", status: "checking", latencyMs: null },
  { key: "version", label: "Version", description: "GET /version", status: "checking", latencyMs: null },
  { key: "ai-systems", label: "AI Systems", description: "listAISystems()", status: "checking", latencyMs: null },
  { key: "eval-runs", label: "Evaluation Runs", description: "listEvaluationRuns(1)", status: "checking", latencyMs: null },
];

const PERMISSION_LABELS: Record<Permission, string> = {
  canViewTechnicalConfig: "View technical configuration",
  canEditAISystem: "Edit AI systems",
  canRunEvaluation: "Run evaluations",
  canRunSecurityTools: "Run security tools",
  canReviewFindings: "Review findings",
  canExportReports: "Export reports",
};

const ROUTE_MAP: Array<{ page: string; endpoints: string }> = [
  { page: "AI Systems", endpoints: "GET/POST /ai-systems · GET /ai-systems/{id} · /capabilities · /context-profile" },
  { page: "Evaluation Runs", endpoints: "GET/POST /evaluation-runs · GET /evaluation-runs/{id} · /start · /cancel" },
  { page: "Evidence", endpoints: "GET /evaluation-runs/{id}/evidence" },
  { page: "Metric Results", endpoints: "GET /evaluation-runs/{id}/metric-results" },
  { page: "Findings", endpoints: "GET /evaluation-runs/{id}/findings" },
  { page: "Verdicts", endpoints: "GET /evaluation-runs/{id}/verdict · /council/deliberate" },
  { page: "Reports", endpoints: "GET /evaluation-runs/{id}/report" },
  { page: "Compliance", endpoints: "GET /evaluation-runs/{id}/framework-map · GET /framework-mappings" },
  { page: "Audit Ledger", endpoints: "GET /evaluation-runs/{id}/ledger · /ledger/verify" },
  { page: "Governance State", endpoints: "GET /evaluation-runs/{id}/state · /state/verify" },
  { page: "Metrics Config", endpoints: "GET /metrics" },
  { page: "LLM Boundary", endpoints: "GET /evaluation-runs/{id}/llm-calls" },
];

const INSPECTOR_PATHS = ["/health", "/version", "/ai-systems", "/evaluation-runs?limit=5"] as const;

type InspectorResult = {
  status: number | null;
  statusText: string;
  latencyMs: number;
  body: string;
  error: string | null;
};

async function timedFetch(url: string): Promise<{ res: Response; latencyMs: number }> {
  const start = performance.now();
  const res = await fetch(url);
  return { res, latencyMs: Math.round(performance.now() - start) };
}

export function APIDebug() {
  const [probes, setProbes] = useState<Probe[]>(INITIAL_PROBES);

  const user = useAuthStore((s) => s.user);
  const role = user?.role ?? "Guest";
  const persona = personaForRole(user?.role);
  const permissions = permissionsFor(persona);

  const [selectedPath, setSelectedPath] = useState<string>(INSPECTOR_PATHS[0]);
  const [inspecting, setInspecting] = useState(false);
  const [inspectorResult, setInspectorResult] = useState<InspectorResult | null>(null);

  const updateProbe = useCallback((key: string, patch: Partial<Probe>) => {
    setProbes((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }, []);

  const runProbes = useCallback(async () => {
    setProbes(INITIAL_PROBES);

    // Raw fetch probes.
    for (const path of ["/health", "/version"] as const) {
      const key = path === "/health" ? "health" : "version";
      try {
        const { res, latencyMs } = await timedFetch(`${API_BASE}${path}`);
        updateProbe(key, {
          status: res.ok ? "ok" : "down",
          latencyMs,
          detail: `HTTP ${res.status}`,
        });
      } catch (err) {
        updateProbe(key, {
          status: "down",
          latencyMs: null,
          detail: err instanceof Error ? err.message : "Network error",
        });
      }
    }

    // Typed client connectivity checks.
    try {
      const start = performance.now();
      const systems = await listAISystems();
      updateProbe("ai-systems", {
        status: "ok",
        latencyMs: Math.round(performance.now() - start),
        detail: `${systems.length} systems`,
      });
    } catch (err) {
      updateProbe("ai-systems", {
        status: "down",
        latencyMs: null,
        detail: err instanceof Error ? err.message : "Request failed",
      });
    }

    try {
      const start = performance.now();
      const runs = await listEvaluationRuns(1);
      updateProbe("eval-runs", {
        status: "ok",
        latencyMs: Math.round(performance.now() - start),
        detail: `${runs.length} run${runs.length === 1 ? "" : "s"} returned`,
      });
    } catch (err) {
      updateProbe("eval-runs", {
        status: "down",
        latencyMs: null,
        detail: err instanceof Error ? err.message : "Request failed",
      });
    }
  }, [updateProbe]);

  useEffect(() => {
    void runProbes();
  }, [runProbes]);

  const sendInspectorRequest = useCallback(async () => {
    setInspecting(true);
    setInspectorResult(null);
    const start = performance.now();
    try {
      const res = await fetch(`${API_BASE}${selectedPath}`);
      const latencyMs = Math.round(performance.now() - start);
      const raw = await res.text();
      let body = raw;
      try {
        body = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        /* not JSON — keep raw text */
      }
      if (body.length > 4000) body = `${body.slice(0, 4000)}\n… (truncated)`;
      setInspectorResult({ status: res.status, statusText: res.statusText, latencyMs, body, error: null });
    } catch (err) {
      setInspectorResult({
        status: null,
        statusText: "",
        latencyMs: Math.round(performance.now() - start),
        body: "",
        error: err instanceof Error ? err.message : "Network error",
      });
    } finally {
      setInspecting(false);
    }
  }, [selectedPath]);

  const selectClass =
    "h-9 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 text-[12px] text-slate-900 dark:text-white outline-none focus:border-blue-500";

  return (
    <div className="space-y-5">
      {/* Intro */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-700 pb-5">
        <div className="max-w-2xl space-y-1">
          <p className="text-[13px] leading-5 text-slate-600 dark:text-slate-300">
            Integration status for the governance backend — live connectivity probes, the current user's effective
            permissions, the page-to-endpoint contract, and an ad-hoc request inspector for safe GET endpoints.
          </p>
          <p className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400 dark:text-slate-500">
            <Server className="h-3.5 w-3.5" />
            <span className="font-mono text-slate-600 dark:text-slate-300">{API_BASE}</span>
          </p>
        </div>
        <Badge tone={IS_LOCAL ? "amber" : "blue"}>
          <Link2 className="h-3 w-3" />
          {IS_LOCAL ? "Local / mock-friendly" : "Remote"}
        </Badge>
      </div>

      {/* Health tiles */}
      <Card>
        <CardHeader
          title="Connectivity"
          eyebrow="Endpoint health probes"
          action={
            <button
              onClick={() => void runProbes()}
              className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-300 transition-colors hover:border-slate-500 dark:hover:border-slate-500"
            >
              Re-run probes
            </button>
          }
        />
        <div className="grid grid-cols-1 gap-px bg-slate-100 dark:bg-slate-800 sm:grid-cols-2 lg:grid-cols-4">
          {probes.map((probe) => (
            <div key={probe.key} className="bg-white dark:bg-slate-900 px-4 py-3.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[12px] font-semibold text-slate-900 dark:text-white">{probe.label}</p>
                {probe.status === "checking" && (
                  <Badge tone="amber">
                    <Loader2 className="h-3 w-3 animate-spin" /> Checking
                  </Badge>
                )}
                {probe.status === "ok" && (
                  <Badge tone="green">
                    <CheckCircle2 className="h-3 w-3" /> OK
                  </Badge>
                )}
                {probe.status === "down" && (
                  <Badge tone="red">
                    <XCircle className="h-3 w-3" /> Down
                  </Badge>
                )}
              </div>
              <p className="mt-1 font-mono text-[11px] text-slate-500 dark:text-slate-400">{probe.description}</p>
              <div className="mt-2 flex items-center justify-between text-[11px]">
                <span className="text-slate-400 dark:text-slate-500">
                  {probe.latencyMs != null ? `${probe.latencyMs} ms` : "—"}
                </span>
                {probe.detail && (
                  <span className="truncate pl-2 text-slate-500 dark:text-slate-400" title={probe.detail}>
                    {probe.detail}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Current user / permissions */}
        <Card>
          <CardHeader title="Session & Permissions" eyebrow="Current user persona" />
          <div className="px-5 py-4">
            <div className="flex items-start gap-3">
              <UserCircle2 className="mt-0.5 h-9 w-9 text-slate-300 dark:text-slate-600" />
              <div className="space-y-1">
                <p className="text-[13px] font-semibold text-slate-900 dark:text-white">
                  {user?.name ?? "Not signed in"}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">{user?.email ?? "—"}</p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Badge tone="slate">Role: {role}</Badge>
                  <Badge tone={persona === "auditor" ? "violet" : "blue"}>
                    <ShieldCheck className="h-3 w-3" /> Persona: {persona}
                  </Badge>
                </div>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                    <th className="py-2 pr-3 font-semibold">Permission</th>
                    <th className="py-2 font-semibold">Granted</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                  {(Object.keys(permissions) as Permission[]).map((key) => (
                    <tr key={key} className="text-[12px] text-slate-700 dark:text-slate-300">
                      <td className="py-2 pr-3">{PERMISSION_LABELS[key]}</td>
                      <td className="py-2">
                        <Badge tone={permissions[key] ? "green" : "slate"}>
                          {permissions[key] ? "Yes" : "No"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>

        {/* Request inspector */}
        <Card>
          <CardHeader title="Request Inspector" eyebrow="Safe GET endpoints" />
          <div className="px-5 py-4 space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  Endpoint
                </span>
                <select
                  value={selectedPath}
                  onChange={(e) => setSelectedPath(e.target.value)}
                  className={`${selectClass} w-64`}
                >
                  {INSPECTOR_PATHS.map((path) => (
                    <option key={path} value={path}>
                      GET {path}
                    </option>
                  ))}
                </select>
              </label>
              <button
                onClick={() => void sendInspectorRequest()}
                disabled={inspecting}
                className="flex h-9 items-center gap-1.5 rounded bg-slate-900 dark:bg-slate-100 px-3 text-[12px] font-medium text-white dark:text-slate-900 transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {inspecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                {inspecting ? "Sending…" : "Send"}
              </button>
            </div>

            <p className="break-all font-mono text-[11px] text-slate-400 dark:text-slate-500">
              {API_BASE}
              {selectedPath}
            </p>

            {inspectorResult && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  {inspectorResult.error ? (
                    <Badge tone="red">
                      <XCircle className="h-3 w-3" /> Error
                    </Badge>
                  ) : (
                    <Badge
                      tone={
                        inspectorResult.status && inspectorResult.status < 400 ? "green" : "red"
                      }
                    >
                      HTTP {inspectorResult.status} {inspectorResult.statusText}
                    </Badge>
                  )}
                  <span className="text-slate-400 dark:text-slate-500">{inspectorResult.latencyMs} ms</span>
                </div>
                <pre className="max-h-72 overflow-auto rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-700 dark:text-slate-300">
                  {inspectorResult.error ?? inspectorResult.body ?? "(empty response)"}
                </pre>
              </div>
            )}

            {!inspectorResult && !inspecting && (
              <p className="text-[12px] text-slate-400 dark:text-slate-500">
                Pick an endpoint and send a request to inspect the live response.
              </p>
            )}
          </div>
        </Card>
      </div>

      {/* Route → endpoint map */}
      <Card>
        <CardHeader title="Route → Endpoint Map" eyebrow="Frontend page to backend contract" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                <th className="px-5 py-2.5 font-semibold">Page</th>
                <th className="px-5 py-2.5 font-semibold">Endpoints</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
              {ROUTE_MAP.map((row) => (
                <tr key={row.page} className="text-[12px] text-slate-700 dark:text-slate-300">
                  <td className="px-5 py-2.5 font-medium text-slate-900 dark:text-white">
                    <span className="inline-flex items-center gap-1.5">
                      <Terminal className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600" />
                      {row.page}
                    </span>
                  </td>
                  <td className="px-5 py-2.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    {row.endpoints}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
