import { useEffect, useMemo, useState } from "react";
import {
  Bug,
  Shield,
  ShieldCheck,
  Server,
  Play,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Package,
  Boxes,
  Activity,
  Ban,
} from "lucide-react";
import clsx from "clsx";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { MetricCard } from "@/components/ui/MetricCard";
import { useAuthStore } from "@/store/useAuthStore";
import { roleCan } from "@/lib/permissions";
import {
  getSecurityTools,
  runSecurityTool,
  listAISystems,
  type SecurityToolsStatus,
  type SecurityAdapterStatus,
  type SecurityToolRunResult,
  type BackendAISystem,
} from "@/api/governanceApi";

/* ──────────────────────────────────────────────── helpers ── */

function runStatusTone(status: SecurityToolRunResult["status"]): "green" | "amber" | "red" {
  if (status === "passed") return "green";
  if (status === "warnings") return "amber";
  return "red";
}

function runStatusIcon(status: SecurityToolRunResult["status"]) {
  if (status === "passed") return <CheckCircle2 className="h-3 w-3" />;
  if (status === "warnings") return <AlertTriangle className="h-3 w-3" />;
  return <XCircle className="h-3 w-3" />;
}

function humanizeTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function kindTone(kind: SecurityAdapterStatus["kind"]): "green" | "violet" | "slate" | "neutral" {
  if (kind === "real") return "green";
  if (kind === "tracing") return "violet";
  if (kind === "deterministic") return "slate";
  return "neutral";
}

// Only "real" adapters run a live probe against the target. Tracing,
// deterministic, and not-wired adapters are not runnable from this page.
function isRunnable(adapter: SecurityAdapterStatus): boolean {
  return adapter.kind === "real";
}

/* ──────────────────────────────────────────────── chips ── */

function Chip({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "violet" }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10.5px]",
        tone === "violet"
          ? "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
          : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
      )}
    >
      {children}
    </span>
  );
}

/* ──────────────────────────────────────────────── adapter card ── */

function AdapterCard({
  adapter,
  running,
  canRunTools,
  result,
  error,
  onRun,
}: {
  adapter: SecurityAdapterStatus;
  running: boolean;
  canRunTools: boolean;
  result: SecurityToolRunResult | null;
  error: string | null;
  onRun: (key: string) => void;
}) {
  const runnable = isRunnable(adapter);
  const canClick = canRunTools && runnable && adapter.available && !running;

  return (
    <Card className="flex flex-col">
      <CardHeader
        title={adapter.name}
        action={
          <Badge tone={adapter.available ? "green" : adapter.kind === "not_wired" ? "neutral" : "amber"}>
            {adapter.available
              ? "ready"
              : adapter.kind === "not_wired"
                ? "not wired"
                : adapter.kind === "tracing"
                  ? "inactive"
                  : "unavailable"}
          </Badge>
        }
      />
      <div className="flex flex-1 flex-col gap-3 px-5 py-4">
        <p className="text-[12.5px] leading-5 text-slate-600 dark:text-slate-300">{adapter.description}</p>

        {/* Attribute badges */}
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={kindTone(adapter.kind)}>{adapter.kind}</Badge>
          <Badge tone="slate">{adapter.category}</Badge>
          {adapter.dependency && (
            <Badge tone={adapter.dependency_installed ? "green" : "red"}>
              {adapter.dependency} {adapter.dependency_installed ? "installed" : "missing"}
            </Badge>
          )}
        </div>

        <p className="text-[11.5px] leading-5 text-slate-400 dark:text-slate-500">{adapter.detail}</p>

        {/* Result / status panel */}
        <div className="mt-auto rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800/40">
          {running ? (
            <div className="flex items-center gap-2 text-[12px] text-slate-500 dark:text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Probing live target…
            </div>
          ) : error ? (
            <div className="flex items-start gap-2 text-[12px] text-red-600 dark:text-red-400">
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{error}</span>
            </div>
          ) : result ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Badge tone={runStatusTone(result.status)}>
                  {runStatusIcon(result.status)} {result.raw_status}
                </Badge>
                <span className="text-[10.5px] text-slate-400 dark:text-slate-500">{humanizeTime(result.ran_at)}</span>
              </div>
              <p className="text-[12px] leading-5 text-slate-600 dark:text-slate-300">{result.summary}</p>
              <div className="flex flex-wrap gap-3 text-[11px] text-slate-400 dark:text-slate-500">
                <span>findings: {result.findings_created}</span>
                {result.normalized_score != null && <span>score: {result.normalized_score.toFixed(2)}</span>}
                {result.threshold != null && <span>threshold: {result.threshold.toFixed(2)}</span>}
                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <Server className="h-3 w-3" /> real
                </span>
              </div>
            </div>
          ) : (
            <p className="text-[12px] text-slate-400 dark:text-slate-500">
              {runnable ? "No runs yet — run this adapter against the live target." : "Not runnable from this page."}
            </p>
          )}
        </div>

        {/* Action */}
        {runnable && (
          <button
            type="button"
            onClick={() => onRun(adapter.key)}
            disabled={!canClick}
            title={
              !canRunTools
                ? "Requires the canRunSecurityTools permission."
                : !adapter.available
                  ? "Adapter is not available — check dependency and target configuration."
                  : "Run this adapter against the live target"
            }
            className={clsx(
              "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors",
              canClick
                ? "bg-brand-600 text-white hover:bg-brand-700"
                : "cursor-not-allowed bg-slate-200 text-slate-400 dark:bg-slate-700 dark:text-slate-500",
            )}
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Run real adapter
          </button>
        )}
      </div>
    </Card>
  );
}

/* ──────────────────────────────────────────────────── page ── */

export function SecurityToolAdapters() {
  const role = useAuthStore((s) => s.user?.role);
  const canRunTools = roleCan(role, "canRunSecurityTools");

  const [live, setLive] = useState<SecurityToolsStatus | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, SecurityToolRunResult>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [systems, setSystems] = useState<BackendAISystem[]>([]);
  // "" = let the backend auto-pick a system (prefers a live https endpoint).
  const [selectedSystemId, setSelectedSystemId] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    listAISystems()
      .then((data) => {
        if (!cancelled) setSystems(data);
      })
      .catch(() => {
        /* selector is optional — ignore load failure */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // (Re)load adapter status whenever the selected system changes so target
  // resolution + availability reflect the chosen system. Runs are cleared
  // because a prior result belonged to a different target.
  useEffect(() => {
    let cancelled = false;
    setLive(null);
    setLiveError(null);
    setResults({});
    setErrors({});
    getSecurityTools(selectedSystemId || undefined)
      .then((data) => {
        if (!cancelled) setLive(data);
      })
      .catch((err) => {
        if (!cancelled) setLiveError(err instanceof Error ? err.message : "unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSystemId]);

  const summary = useMemo(() => {
    const adapters = live?.adapters ?? [];
    return {
      total: adapters.length,
      realReady: adapters.filter((a) => a.kind === "real" && a.available).length,
      tracing: adapters.filter((a) => a.kind === "tracing").length,
      notWired: adapters.filter((a) => a.kind === "not_wired").length,
    };
  }, [live]);

  async function handleRun(key: string) {
    if (!canRunTools || runningKey) return;
    setRunningKey(key);
    setErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    try {
      const result = await runSecurityTool(key, selectedSystemId || undefined);
      setResults((prev) => ({ ...prev, [key]: result }));
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [key]: err instanceof Error ? err.message.slice(0, 200) : "run failed",
      }));
    } finally {
      setRunningKey(null);
    }
  }

  return (
    <div className="space-y-5">
      {/* Page intro */}
      <div className="flex items-start gap-3 border-b border-slate-200 pb-5 dark:border-slate-700">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
          <Bug className="h-5 w-5" />
        </div>
        <div className="max-w-3xl space-y-1">
          <h1 className="font-display text-[20px] text-ink dark:text-white">Security Tool Adapters</h1>
          <p className="text-[13px] leading-5 text-slate-600 dark:text-slate-300">
            Live security/evaluation adapters that probe the target system. Each card reflects the real backend
            state — whether its dependency is installed, its config is present, and whether it runs for real. Run
            buttons execute a genuine probe against the live target (no mock mode).
          </p>
        </div>
      </div>

      {/* Target selector + resolved client banner */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
        <label htmlFor="target-system" className="text-[12.5px] font-medium text-ink dark:text-white">
          Target system:
        </label>
        <select
          id="target-system"
          value={selectedSystemId}
          onChange={(e) => setSelectedSystemId(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[12.5px] text-slate-700 focus:border-brand-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
        >
          <option value="">Auto (prefer live endpoint)</option>
          {systems.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.target_endpoint_ref ? "" : " (no endpoint)"}
            </option>
          ))}
        </select>
        {live && (
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[12.5px] text-slate-500 dark:text-slate-400">resolves to</span>
            <Badge tone={live.target_client.live ? "green" : "amber"}>
              {live.target_client.adapter} · {live.target_client.mode}
            </Badge>
          </span>
        )}
        {live && !live.target_client.live && (
          <span className="text-[11.5px] text-slate-400">
            Mock target — pick a system with a live endpoint (or set TARGET_ENDPOINT + TARGET_API_KEY).
          </span>
        )}
      </div>

      {/* Strategy info card */}
      <Card>
        <CardHeader eyebrow="How they fit together" title="Security tool strategy" />
        <div className="space-y-2.5 px-5 py-4 text-[12.5px] leading-5 text-slate-600 dark:text-slate-300">
          <p>
            <strong>Custom Boundary Test runs first</strong> — it validates the Target/Governance client boundary
            (sanitization, fencing, permission enforcement) before any broader scan trusts the harness.
          </p>
          <ul className="ml-4 list-disc space-y-1.5">
            <li>
              <strong>garak</strong> — broad LLM vulnerability scanning across many attack families.
            </li>
            <li>
              <strong>PyRIT</strong> — converter-based adversarial attack generation (Base64/ROT13/leetspeak, etc.),
              run in an isolated interpreter and probed against the live target.
            </li>
            <li>
              <strong>Inspect AI</strong> — agent / tool-use safety evaluation (unsafe-action refusal).
            </li>
            <li>
              <strong>Presidio / RAGAS / DeepEval</strong> — PII leakage, RAG groundedness, and LLM-judge safety.
            </li>
            <li>
              <strong>Langfuse</strong> — tracing/observability: every gateway LLM call is emitted as a span when
              configured.
            </li>
          </ul>
          <p className="text-[11.5px] text-slate-400 dark:text-slate-500">
            Evidently (tabular drift) and promptfoo (Node.js CLI) are catalogued but not wired as target-probing
            adapters.
          </p>
        </div>
      </Card>

      {/* Summary metrics */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Total Adapters" value={summary.total} icon={Boxes} tone="slate" compact />
        <MetricCard label="Real-ready" value={summary.realReady} icon={ShieldCheck} tone="brand" compact />
        <MetricCard label="Tracing" value={summary.tracing} icon={Activity} tone="blue" compact />
        <MetricCard label="Not wired" value={summary.notWired} icon={Ban} tone="amber" compact />
      </div>

      {!canRunTools && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          <Shield className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Run actions are disabled — executing security adapters requires the{" "}
            <code className="font-mono">canRunSecurityTools</code> permission (developer role).
          </span>
        </div>
      )}

      {/* Loading / error states */}
      {liveError && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          Backend adapter status unavailable ({liveError}).
        </div>
      )}
      {!liveError && !live && (
        <div className="flex items-center gap-2 px-1 text-[12.5px] text-slate-500 dark:text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading live adapter status…
        </div>
      )}

      {/* Adapter grid — driven by real backend status */}
      {live && (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {live.adapters.map((adapter) => (
            <AdapterCard
              key={adapter.key}
              adapter={adapter}
              running={runningKey === adapter.key}
              canRunTools={canRunTools}
              result={results[adapter.key] ?? null}
              error={errors[adapter.key] ?? null}
              onRun={handleRun}
            />
          ))}
        </div>
      )}
    </div>
  );
}
