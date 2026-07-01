import { useMemo, useState } from "react";
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
  Zap,
} from "lucide-react";
import clsx from "clsx";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { MetricCard } from "@/components/ui/MetricCard";
import { useAuthStore } from "@/store/useAuthStore";
import { roleCan } from "@/lib/permissions";
import {
  securityToolAdapters,
  type SecurityToolAdapter,
  type SecurityToolResult,
} from "@/data/mockSecurityTools";

/* ──────────────────────────────────────────────── helpers ── */

function statusTone(status: SecurityToolResult["status"]): "green" | "amber" | "red" {
  if (status === "passed") return "green";
  if (status === "warnings") return "amber";
  return "red";
}

function statusIcon(status: SecurityToolResult["status"]) {
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

function isRealReady(a: SecurityToolAdapter): boolean {
  return a.installed && a.executionMode === "real";
}

const MOCK_SUMMARIES = [
  "All probes fenced correctly; no sanitization escapes.",
  "Adapter completed; 1 low-severity payload flagged for review.",
  "Boundary held across all probe families.",
  "Scan finished; permission assertions intact.",
];

function buildMockResult(): SecurityToolResult {
  const warnings = Math.random() < 0.35;
  const findings = warnings ? 1 : 0;
  return {
    ranAt: new Date().toISOString(),
    mode: "mock",
    status: warnings ? "warnings" : "passed",
    summary: warnings
      ? MOCK_SUMMARIES[1]
      : MOCK_SUMMARIES[Math.floor(Math.random() * MOCK_SUMMARIES.length)],
    findingsCreated: findings,
    warningCount: warnings ? 1 : 0,
  };
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
  onRunMock,
}: {
  adapter: SecurityToolAdapter;
  running: boolean;
  canRunTools: boolean;
  onRunMock: (id: string) => void;
}) {
  const realReady = isRealReady(adapter);
  const result = adapter.lastResult;

  return (
    <Card className="flex flex-col">
      <CardHeader
        title={adapter.toolName}
        action={
          adapter.installed ? (
            <Badge tone="green">installed</Badge>
          ) : (
            <Badge tone="neutral">not installed</Badge>
          )
        }
      />
      <div className="flex flex-1 flex-col gap-3 px-5 py-4">
        <p className="text-[12.5px] leading-5 text-slate-600 dark:text-slate-300">{adapter.purpose}</p>

        {/* Attribute badges */}
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="slate">{adapter.dependencyGroup}</Badge>
          <Badge tone={adapter.localMode ? "blue" : "neutral"}>
            {adapter.localMode ? "local mode" : "remote"}
          </Badge>
          <Badge tone={adapter.executionMode === "real" ? "green" : "amber"}>{adapter.executionMode}</Badge>
          <Badge tone={adapter.azureReady ? "violet" : "neutral"}>
            {adapter.azureReady ? "Azure-ready" : "Azure: not yet"}
          </Badge>
        </div>

        {/* Related metrics / finding types */}
        {(adapter.relatedMetrics.length > 0 || adapter.relatedFindingTypes.length > 0) && (
          <div className="space-y-2">
            {adapter.relatedMetrics.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10.5px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Metrics
                </span>
                {adapter.relatedMetrics.map((m) => (
                  <Chip key={m}>{m}</Chip>
                ))}
              </div>
            )}
            {adapter.relatedFindingTypes.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10.5px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Findings
                </span>
                {adapter.relatedFindingTypes.map((f) => (
                  <Chip key={f} tone="violet">
                    {f}
                  </Chip>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Last result */}
        <div className="mt-auto rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800/40">
          {running ? (
            <div className="flex items-center gap-2 text-[12px] text-slate-500 dark:text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Running mock adapter…
            </div>
          ) : result ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Badge tone={statusTone(result.status)}>
                  {statusIcon(result.status)} {result.status}
                </Badge>
                <span className="text-[10.5px] text-slate-400 dark:text-slate-500">{humanizeTime(result.ranAt)}</span>
              </div>
              <p className="text-[12px] leading-5 text-slate-600 dark:text-slate-300">{result.summary}</p>
              <div className="flex gap-3 text-[11px] text-slate-400 dark:text-slate-500">
                <span>findings: {result.findingsCreated}</span>
                {result.warningCount != null && <span>warnings: {result.warningCount}</span>}
                <span>mode: {result.mode}</span>
              </div>
            </div>
          ) : (
            <p className="text-[12px] text-slate-400 dark:text-slate-500">No runs yet — run the mock adapter.</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onRunMock(adapter.id)}
            disabled={!canRunTools || running}
            title={canRunTools ? "Run the adapter in mock mode" : "Requires the canRunSecurityTools permission."}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors",
              canRunTools && !running
                ? "bg-brand-600 text-white hover:bg-brand-700"
                : "cursor-not-allowed bg-slate-200 text-slate-400 dark:bg-slate-700 dark:text-slate-500",
            )}
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Run mock adapter
          </button>
          <button
            type="button"
            disabled={!canRunTools || !realReady}
            title={
              !canRunTools
                ? "Requires the canRunSecurityTools permission."
                : realReady
                  ? "Run the adapter against the real target"
                  : "Configure the adapter to enable real execution."
            }
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors",
              canRunTools && realReady
                ? "border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                : "cursor-not-allowed border-slate-200 text-slate-300 dark:border-slate-700 dark:text-slate-600",
            )}
          >
            <Server className="h-3.5 w-3.5" /> Run real adapter
          </button>
        </div>
      </div>
    </Card>
  );
}

/* ──────────────────────────────────────────────────── page ── */

export function SecurityToolAdapters() {
  const role = useAuthStore((s) => s.user?.role);
  const canRunTools = roleCan(role, "canRunSecurityTools");

  const [adapters, setAdapters] = useState<SecurityToolAdapter[]>(() =>
    securityToolAdapters.map((a) => ({ ...a })),
  );
  const [runningId, setRunningId] = useState<string | null>(null);

  const summary = useMemo(() => {
    const total = adapters.length;
    const installed = adapters.filter((a) => a.installed).length;
    const realReady = adapters.filter(isRealReady).length;
    const mockOnly = adapters.filter((a) => a.executionMode === "mock").length;
    return { total, installed, realReady, mockOnly };
  }, [adapters]);

  function handleRunMock(id: string) {
    if (!canRunTools || runningId) return;
    setRunningId(id);
    setTimeout(() => {
      const result = buildMockResult();
      setAdapters((prev) => prev.map((a) => (a.id === id ? { ...a, lastResult: result } : a)));
      setRunningId(null);
    }, 900);
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
            Adapter interfaces for the security tooling that probes the target system. Each adapter declares whether
            it is installed, runs locally, executes in mock or real mode, and is ready for Azure container execution.
          </p>
        </div>
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
              <strong>garak</strong> — broad LLM vulnerability scanning across many attack families (jailbreaks,
              injection, toxicity, leakage).
            </li>
            <li>
              <strong>PyRIT</strong> — orchestrated adversarial red-team campaigns (multi-turn attacks).
            </li>
            <li>
              <strong>Inspect AI</strong> — multi-step autonomous agent / tool-use evaluation (planning, tool
              selection, side-effect safety).
            </li>
            <li>
              <strong>CyberSecEval</strong> — optional, domain-specific coding/cybersecurity evaluation.
            </li>
            <li>
              <strong>Prompt-injection scanners + policy tests</strong> validate the client boundary and permission
              model.
            </li>
            <li>
              <strong>Tracing</strong> records every model/tool call, trace ID, evidence ID, and latency.
            </li>
          </ul>
          <p className="text-[11.5px] text-slate-400 dark:text-slate-500">
            Heavy scanners install via the optional <code className="font-mono">requirements-security.txt</code>{" "}
            dependency group; core boundary, policy, and tracing adapters ship in the base install.
          </p>
        </div>
      </Card>

      {/* Summary metrics */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Total Adapters" value={summary.total} icon={Boxes} tone="slate" compact />
        <MetricCard label="Installed" value={summary.installed} icon={Package} tone="green" compact />
        <MetricCard label="Real-ready" value={summary.realReady} icon={ShieldCheck} tone="brand" compact />
        <MetricCard label="Mock-only" value={summary.mockOnly} icon={Zap} tone="amber" compact />
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

      {/* Adapter grid */}
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {adapters.map((adapter) => (
          <AdapterCard
            key={adapter.id}
            adapter={adapter}
            running={runningId === adapter.id}
            canRunTools={canRunTools}
            onRunMock={handleRunMock}
          />
        ))}
      </div>
    </div>
  );
}
