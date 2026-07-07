import { useEffect, useMemo, useState } from "react";
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Server,
  Lock,
  Zap,
  Coins,
  XCircle,
  AlertTriangle,
  CheckCircle2,
  Play,
  Loader2,
  Eye,
  Activity,
} from "lucide-react";
import clsx from "clsx";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { MetricCard } from "@/components/ui/MetricCard";
import { useAuthStore } from "@/store/useAuthStore";
import { roleCan } from "@/lib/permissions";
import {
  getClientBoundary,
  getLlmCalls,
  runBoundaryTest,
  type BoundaryTestResult,
  type ClientBoundaryStatus,
  type LlmCallLog,
} from "@/api/governanceApi";
import { useActiveRun } from "@/hooks/useActiveRun";

/* ──────────────────────────────────────────────── helpers ── */

function formatCost(usd: number): string {
  if (!usd) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function shortTrace(trace?: string | null): string {
  if (!trace) return "—";
  return trace.length > 10 ? `${trace.slice(0, 8)}…${trace.slice(-2)}` : trace;
}

function clientModeTone(mode: string): "green" | "amber" | "slate" {
  const m = mode.toLowerCase();
  if (m.includes("live") || m.includes("real")) return "green";
  if (m.includes("mock")) return "amber";
  return "slate";
}

function statusTone(status: string): "green" | "red" | "amber" | "slate" {
  const s = status.toLowerCase();
  if (s === "success" || s === "ok" || s === "completed") return "green";
  if (s === "error" || s === "failed") return "red";
  if (s === "warning") return "amber";
  return "slate";
}

/* ──────────────────────────────────────────────── client card ── */

function ClientCard({
  kind,
  provider,
  credentialRef,
  mode,
}: {
  kind: "governance" | "target";
  provider: string;
  credentialRef: string;
  mode: "mock" | "real";
}) {
  const trusted = kind === "governance";
  return (
    <Card className="flex flex-col">
      <CardHeader
        eyebrow={trusted ? "Trusted" : "Untrusted"}
        title={trusted ? "Governance Model Client" : "Target Model Client"}
        action={<Badge tone={mode === "real" ? "green" : "amber"}>{mode === "real" ? "live" : "mock"}</Badge>}
      />
      <div className="flex-1 space-y-3 px-5 py-4">
        <div className="flex items-center gap-3">
          <div
            className={clsx(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
              trusted
                ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
                : "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400",
            )}
          >
            {trusted ? <ShieldCheck className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
          </div>
          <p className="text-[12.5px] font-medium text-slate-700 dark:text-slate-200">
            {trusted ? "Plans, judges, and synthesizes the verdict." : "The audited system under evaluation."}
          </p>
        </div>

        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-[12px]">
          <dt className="flex items-center gap-1.5 text-slate-400 dark:text-slate-500">
            <Server className="h-3.5 w-3.5" /> Provider
          </dt>
          <dd className="font-medium text-slate-700 dark:text-slate-200">{provider}</dd>
          <dt className="flex items-center gap-1.5 text-slate-400 dark:text-slate-500">
            <Lock className="h-3.5 w-3.5" /> Credential
          </dt>
          <dd className="font-mono text-[11.5px] text-slate-600 dark:text-slate-300">{credentialRef}</dd>
        </dl>
      </div>
    </Card>
  );
}

/* ──────────────────────────────────────────────────── page ── */

export function LLMClientBoundary() {
  const role = useAuthStore((s) => s.user?.role);
  const canRunTools = roleCan(role, "canRunSecurityTools");
  const { runId, loading: runsLoading } = useActiveRun();

  const [log, setLog] = useState<LlmCallLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Live mode/provider of the two boundary clients (real vs mock).
  const [boundary, setBoundary] = useState<ClientBoundaryStatus | null>(null);

  // Boundary test state — sends the prompt to the REAL target model.
  const [prompt, setPrompt] = useState("");
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<BoundaryTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getClientBoundary()
      .then((b) => {
        if (!cancelled) setBoundary(b);
      })
      .catch(() => {
        /* cards fall back to sensible defaults if this fails */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!runId) {
        if (!cancelled) {
          setLog(null);
          setError(null);
          setLoading(runsLoading);
        }
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const calls = await getLlmCalls(runId);
        if (!cancelled) setLog(calls);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load LLM telemetry.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId, runsLoading]);

  const recentCalls = useMemo(() => (log ? log.calls.slice(0, 8) : []), [log]);

  const policyFlagCount = useMemo(
    () => (log ? log.calls.reduce((acc, c) => acc + (c.policy_flags?.length ?? 0), 0) : 0),
    [log],
  );

  async function handleRunTest() {
    if (!canRunTools || testRunning) return;
    setTestRunning(true);
    setTestResult(null);
    setTestError(null);
    try {
      // Live: sends the prompt to the real target model and runs the response
      // through the same sanitize -> fence pipeline the audit engine uses.
      setTestResult(await runBoundaryTest(prompt));
    } catch (e) {
      setTestError(e instanceof Error ? e.message : "Boundary test failed.");
    } finally {
      setTestRunning(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Title + description come from the app shell chrome (breadcrumb header),
          same as every other page — no duplicate in-page intro block. */}

      {/* Two clients side by side — live mode/provider from the backend */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ClientCard
          kind="governance"
          provider={boundary?.governance.provider ?? "Governance model client"}
          credentialRef={boundary?.governance.credential_ref ?? "env:AZURE_AI_FOUNDRY_API_KEY"}
          mode={boundary?.governance.mode ?? "mock"}
        />
        <ClientCard
          kind="target"
          provider={boundary?.target.provider ?? "Target model client"}
          credentialRef={boundary?.target.credential_ref ?? "env:TARGET_MODEL_API_KEY"}
          mode={boundary?.target.mode ?? "mock"}
        />
      </div>

      {/* Live telemetry */}
      <Card>
        <CardHeader
          eyebrow="Latest run"
          title="Live boundary telemetry"
          action={
            log ? (
              <Badge tone="slate">
                <Activity className="h-3 w-3" /> run {shortTrace(log.run_id)}
              </Badge>
            ) : undefined
          }
        />
        <div className="px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-slate-500 dark:text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading telemetry…
            </div>
          ) : error ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Telemetry unavailable: {error}. It appears after a run with live judge calls — the boundary still
                holds without it.
              </span>
            </div>
          ) : !log || log.call_count === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <Eye className="h-7 w-7 text-slate-300 dark:text-slate-600" />
              <p className="text-[13px] font-medium text-slate-600 dark:text-slate-300">No LLM telemetry yet</p>
              <p className="max-w-md text-[12px] text-slate-400 dark:text-slate-500">
                Telemetry appears after an evaluation run executes live judge calls. Trigger a run, then return here
                to inspect per-call tokens, cost, latency, and trace IDs.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <MetricCard label="Total Calls" value={log.call_count} icon={Activity} tone="blue" compact />
                <MetricCard
                  label="Live vs Mock"
                  value={`${log.live_call_count} / ${log.mock_call_count}`}
                  icon={Shield}
                  tone="brand"
                  detail="live · mock"
                  compact
                />
                <MetricCard
                  label="Total Tokens"
                  value={formatTokens(log.total_tokens)}
                  icon={Zap}
                  tone="slate"
                  detail={`${formatTokens(log.total_prompt_tokens)} in · ${formatTokens(log.total_completion_tokens)} out`}
                  compact
                />
                <MetricCard
                  label="Est. Cost"
                  value={formatCost(log.estimated_total_cost_usd)}
                  icon={Coins}
                  tone="green"
                  detail="USD"
                  compact
                />
                <MetricCard
                  label="Errors"
                  value={log.error_count}
                  icon={XCircle}
                  tone={log.error_count > 0 ? "red" : "slate"}
                  compact
                />
              </div>

              {/* Recent calls table */}
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full min-w-[640px] text-left text-[12px]">
                  <thead className="bg-slate-50 text-[10.5px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Task</th>
                      <th className="px-3 py-2 font-semibold">Model</th>
                      <th className="px-3 py-2 font-semibold">Mode</th>
                      <th className="px-3 py-2 text-right font-semibold">Latency</th>
                      <th className="px-3 py-2 text-right font-semibold">Tokens</th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                      <th className="px-3 py-2 font-semibold">Trace</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {recentCalls.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                        <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
                          <span className="block max-w-[180px] truncate" title={c.task}>
                            {c.task}
                          </span>
                          {c.agent_name && (
                            <span className="text-[10.5px] text-slate-400 dark:text-slate-500">{c.agent_name}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                          {c.model ?? c.deployment_name ?? "—"}
                        </td>
                        <td className="px-3 py-2">
                          <Badge tone={clientModeTone(c.client_mode)}>{c.client_mode}</Badge>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                          {c.latency_ms != null ? `${c.latency_ms} ms` : "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                          {c.total_tokens != null ? formatTokens(c.total_tokens) : "—"}
                        </td>
                        <td className="px-3 py-2">
                          <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                          {shortTrace(c.trace_id)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Sanitization status */}
      <Card>
        <CardHeader eyebrow="Boundary enforcement" title="Sanitization status" />
        <div className="grid gap-3 px-5 py-4 sm:grid-cols-2">
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-700">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Redactions</p>
              <p className="text-xl font-bold tabular-nums text-slate-900 dark:text-white">{policyFlagCount}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-700">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Prompt-injection warnings
              </p>
              <p className="text-xl font-bold tabular-nums text-slate-900 dark:text-white">{policyFlagCount}</p>
            </div>
          </div>
          {policyFlagCount === 0 && (
            <p className="text-[11.5px] text-slate-400 dark:text-slate-500 sm:col-span-2">
              No policy flags on the latest run — counts derive from{" "}
              <code className="font-mono">policy_flags</code> on recorded calls. Use the boundary test below to
              exercise sanitization directly against the target model.
            </p>
          )}
        </div>
      </Card>

      {/* Boundary test demo */}
      <Card>
        <CardHeader
          eyebrow="Live"
          title="Boundary test"
          action={
            testResult ? (
              testResult.caught_something ? (
                <Badge tone="green">
                  <ShieldCheck className="h-3 w-3" /> Neutralized {testResult.redaction_count} redaction
                  {testResult.redaction_count === 1 ? "" : "s"} · {testResult.warning_count} warning
                  {testResult.warning_count === 1 ? "" : "s"}
                </Badge>
              ) : (
                <Badge tone="slate">
                  <CheckCircle2 className="h-3 w-3" /> Clean — fenced as evidence
                </Badge>
              )
            ) : undefined
          }
        />
        <div className="space-y-4 px-5 py-4">
          <div>
            <label
              htmlFor="boundary-prompt"
              className="mb-1.5 block text-[12px] font-medium text-slate-600 dark:text-slate-300"
            >
              Send a test prompt to the target model
            </label>
            <textarea
              id="boundary-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="e.g. Summarize the customer support transcript."
              className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:ring-brand-900/40"
            />
            <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
              Sends your prompt to the {boundary?.target.mode === "real" ? "live" : ""} target model, then runs
              its response through the real sanitize → fence pipeline the audit engine uses.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void handleRunTest()}
              disabled={!canRunTools || testRunning}
              title={
                canRunTools
                  ? "Run the boundary test"
                  : "Requires the canRunSecurityTools permission (developer role)."
              }
              className={clsx(
                "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium transition-colors",
                canRunTools && !testRunning
                  ? "bg-brand-600 text-white hover:bg-brand-700"
                  : "cursor-not-allowed bg-slate-200 text-slate-400 dark:bg-slate-700 dark:text-slate-500",
              )}
            >
              {testRunning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Running…
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" /> Run boundary test
                </>
              )}
            </button>
            {!canRunTools && (
              <span className="text-[11.5px] text-slate-400 dark:text-slate-500">
                Run actions are gated by permission.
              </span>
            )}
          </div>

          {testError && (
            <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-[12px] text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> {testError}
            </div>
          )}

          {testResult && (
            <div className="space-y-3">
              {/* Live call metadata */}
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <Badge tone={testResult.target_mode === "real" ? "green" : "amber"}>
                  {testResult.target_mode === "real" ? "live target" : "mock target"}
                </Badge>
                <span>{testResult.provider}</span>
                <span className="opacity-50">·</span>
                <span>{testResult.latency_ms} ms</span>
                <span className="opacity-50">·</span>
                <span className="font-mono">{shortTrace(testResult.trace_id)}</span>
              </div>

              {/* 1. Raw */}
              <div className="rounded-lg border border-red-300 bg-red-50/60 dark:border-red-800 dark:bg-red-950/30">
                <div className="flex items-center gap-2 border-b border-red-200 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-red-700 dark:border-red-800/60 dark:text-red-400">
                  <ShieldAlert className="h-3.5 w-3.5" /> 1 · Raw target output (untrusted)
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap break-words px-3 py-2.5 font-mono text-[11.5px] leading-5 text-red-900 dark:text-red-200">
                  {testResult.raw}
                </pre>
              </div>

              {/* 2. Sanitized */}
              <div className="rounded-lg border border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/30">
                <div className="flex items-center gap-2 border-b border-amber-200 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:border-amber-800/60 dark:text-amber-400">
                  <Shield className="h-3.5 w-3.5" /> 2 · Sanitized output
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap break-words px-3 py-2.5 font-mono text-[11.5px] leading-5 text-amber-900 dark:text-amber-200">
                  {testResult.sanitized}
                </pre>
              </div>

              {/* 3. Warnings / redactions */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:border-slate-700 dark:text-slate-300">
                  <AlertTriangle className="h-3.5 w-3.5" /> 3 · Detections ({testResult.redaction_count} redacted ·{" "}
                  {testResult.warning_count} flagged)
                </div>
                {testResult.warnings.length === 0 && testResult.redaction_count === 0 ? (
                  <p className="px-4 py-2.5 text-[12px] text-slate-500 dark:text-slate-400">
                    No secrets or prompt-injection patterns detected in the target's response — it passed through
                    clean and was still fenced as untrusted evidence.
                  </p>
                ) : (
                  <ul className="space-y-1.5 px-4 py-2.5">
                    {testResult.warnings.map((w, i) => (
                      <li key={i} className="flex items-start gap-2 text-[12px] text-slate-700 dark:text-slate-300">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                        <code className="font-mono text-[11px]">{w}</code>
                      </li>
                    ))}
                    {testResult.redaction_count > 0 && (
                      <li className="flex items-start gap-2 text-[12px] text-slate-700 dark:text-slate-300">
                        <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />
                        {testResult.redaction_count} secret pattern
                        {testResult.redaction_count === 1 ? "" : "s"} redacted
                      </li>
                    )}
                  </ul>
                )}
              </div>

              {/* 4. Fenced */}
              <div className="rounded-lg border border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/30">
                <div className="flex items-center gap-2 border-b border-emerald-200 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:border-emerald-800/60 dark:text-emerald-400">
                  <ShieldCheck className="h-3.5 w-3.5" /> 4 · Fenced as evidence (safe for governance use)
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap break-words px-3 py-2.5 font-mono text-[11.5px] leading-5 text-emerald-900 dark:text-emerald-200">
                  {testResult.fenced}
                </pre>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
