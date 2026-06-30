import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  Copy,
  Download,
  FileJson,
  FileText,
  Layers,
  Loader2,
  Send,
  ShieldAlert,
  XCircle,
  Zap,
} from "lucide-react";
import clsx from "clsx";
import { agents as mockAgents, auditEvents, findings as mockFindings, liveRuns, systems as mockSystems, applicationContextProfiles, type ApplicationContextProfile } from "@/data/mockData";
import { Badge, toneForStatus } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { MetricCard } from "@/components/ui/MetricCard";
import { useAppStore } from "@/store/useAppStore";
import { useAuthStore } from "@/store/useAuthStore";
import { personaForRole } from "@/lib/persona";
import { ExecutionLayerTrace } from "@/components/execution/ExecutionLayerTrace";
import { RuntimeEventStream } from "@/components/execution/RuntimeEventStream";
import { ArtifactDrawer } from "@/components/execution/ArtifactDrawer";
import { RuntimeArchitecture } from "@/components/execution/RuntimeArchitecture";
import { exportJSON, exportCSV, exportPDF, exportLedger, exportEvidenceBundle } from "@/utils/exports";
import { useGovernanceBackend } from "@/hooks/useGovernanceBackend";
import { useRunProgress, phaseIndex, type AgentProgress } from "@/hooks/useRunProgress";
import type { AuditLedgerEntry, GovernanceReport } from "@/api/governanceApi";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LAYERS = [
  { id: "context_assembly",      label: "Context Assembly",     description: "Ingests model card, intended-use declaration, historical run data, and framework clauses." },
  { id: "adaptive_orchestrator", label: "Evaluation Plan",      description: "Allocates probe budget, selects metrics, registers agents to run." },
  { id: "metric_execution",      label: "Metric Execution",     description: "Runs 44 governance metrics across 10 dimensions via the threshold evaluator." },
  { id: "specialist_agents",     label: "Specialist Agents",    description: "7 model-backed agents run bias, drift, misuse, compliance, quality, explainability, and risk probes." },
  { id: "deliberation_council",  label: "Council Deliberation", description: "Synthesis → Devil's Advocate → Verdict with bounded 3-iteration loop." },
  { id: "action_reporting",      label: "Action Reporting",     description: "Maps findings to framework controls, emits verdict and remediation actions." },
];

const SEVERITY_BORDER: Record<string, string> = {
  Critical: "border-l-red-500",
  High: "border-l-orange-400",
  Medium: "border-l-amber-400",
  Low: "border-l-blue-400",
};

const SEVERITY_BG: Record<string, string> = {
  Critical: "bg-red-50 dark:bg-red-950/30",
  High: "bg-orange-50 dark:bg-orange-950/30",
  Medium: "bg-amber-50 dark:bg-amber-950/20",
  Low: "bg-blue-50 dark:bg-blue-950/20",
};


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRunStatus(status: string): "Running" | "Complete" | "Waiting" | "Failed" {
  if (status === "completed" || status === "report_ready") return "Complete";
  if (status === "failed" || status === "cancelled") return "Failed";
  if (status === "created") return "Waiting";
  return "Running";
}

function agentRoleFor(name: string): string {
  const roles: Record<string, string> = {
    bias_agent:           "Protected-attribute parity",
    quality_agent:        "Instruction-following fidelity",
    misuse_agent:         "Jailbreak & boundary tests",
    drift_agent:          "Baseline divergence",
    compliance_mapper:    "Clause-level mapping",
    risk_scorer:          "Composite risk quantification",
    explainability_agent: "Reasoning fidelity",
  };
  return roles[name] ?? name;
}

function agentDisplayName(name: string): string {
  const labels: Record<string, string> = {
    bias_agent:           "Bias Auditor",
    quality_agent:        "Quality Evaluator",
    misuse_agent:         "Misuse Detector",
    drift_agent:          "Drift Analyst",
    compliance_mapper:    "Compliance Mapper",
    risk_scorer:          "Risk Scorer",
    explainability_agent: "Explainability Agent",
  };
  return labels[name] ?? name;
}

type UiAuditEvent = {
  id: string;
  timestamp: string;
  actor: string;
  type: string;
  description: string;
  hash: string;
  parentHash: string;
};

type UiFinding = {
  id: string;
  agent: string;
  title: string;
  severity: "Critical" | "High" | "Medium" | "Low";
  framework: string;
  evidence: string;
  confidence: number;
};

function titleCase(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function findingSeverity(value: string): UiFinding["severity"] {
  const normalized = value.toLowerCase();
  if (normalized === "critical") return "Critical";
  if (normalized === "high") return "High";
  if (normalized === "low" || normalized === "info") return "Low";
  return "Medium";
}

function mapLedgerEvent(entry: AuditLedgerEntry): UiAuditEvent {
  const created = new Date(entry.created_at);
  const timestamp = Number.isNaN(created.getTime())
    ? entry.created_at
    : created.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const payload = entry.payload ?? {};
  const summary =
    typeof payload.summary === "string"
      ? payload.summary
      : typeof payload.message === "string"
        ? payload.message
        : typeof payload.notes === "string"
          ? payload.notes
          : `${titleCase(entry.event_type)} recorded by ${entry.actor_id ?? entry.actor_type}.`;

  return {
    id: entry.id,
    timestamp,
    actor: entry.actor_id ?? titleCase(entry.actor_type),
    type: entry.event_type,
    description: summary,
    hash: entry.entry_hash,
    parentHash: entry.previous_hash ?? "genesis",
  };
}

function mapBackendFinding(finding: GovernanceReport["findings"][number]): UiFinding {
  return {
    id: finding.id,
    agent: finding.agent_name ? titleCase(finding.agent_name) : titleCase(finding.finding_type),
    title: finding.title,
    severity: findingSeverity(finding.severity),
    framework: finding.framework_refs.length ? finding.framework_refs.join(", ") : finding.dimension,
    evidence: finding.summary,
    confidence: Math.round(finding.confidence * 100),
  };
}

function layerStatus(layerId: string, currentPhase: string, runStatus: string): "done" | "active" | "pending" | "failed" {
  const currentIdx = phaseIndex(currentPhase);
  const layerIdx = phaseIndex(layerId);
  if (runStatus === "failed" && layerIdx === currentIdx) return "failed";
  if (layerIdx < currentIdx) return "done";
  if (layerIdx === currentIdx) return "active";
  return "pending";
}

function LayerIcon({ status }: { status: "done" | "active" | "pending" | "failed" }) {
  if (status === "done")    return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === "active")  return <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />;
  if (status === "failed")  return <XCircle className="h-4 w-4 text-red-500" />;
  return <Circle className="h-4 w-4 text-slate-300" />;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export function LiveRuns() {
  const navigateTo = useAppStore((state) => state.navigateTo);
  const role = useAuthStore((state) => state.user?.role);
  // Auditors watch at altitude: agent status, findings, and progress — but not
  // the runtime traces, probe internals, or links into engine-only pages.
  const isDev = personaForRole(role) === "developer";
  const backend = useGovernanceBackend();
  const [expandedAgent, setExpandedAgent]     = useState<string | null>(null);
  const [expandedEvent, setExpandedEvent]     = useState<string | null>(null);
  const [expandedFinding, setExpandedFinding] = useState<string | null>(null);
  const [copiedHash, setCopiedHash]           = useState<string | null>(null);

  // SSE live progress — uses latest run ID from polling hook
  const runId = backend.latestRun?.id ?? null;
  const { progress, connected } = useRunProgress(runId ?? null);

  // Compose run summary from SSE progress when available, else from REST polling, else from mock
  const liveStatus   = progress?.status ?? backend.latestRun?.status ?? "created";
  const livePhase    = progress?.current_phase ?? backend.latestRun?.current_phase ?? "created";
  const liveProgress = progress?.progress ?? (backend.latestRun ? Math.round(((phaseIndex(livePhase) + 1) / 8) * 100) : 0);
  const liveProbes   = progress?.probe_count ?? backend.report?.counts?.metric_results ?? liveRuns[0].probes;
  const liveFindings = progress?.finding_count ?? backend.report?.counts?.findings ?? liveRuns[0].findings;

  const run = {
    id: backend.latestRun?.id ?? liveRuns[0].id,
    system: backend.report?.ai_system?.name ?? liveRuns[0].system,
    framework: backend.latestRun?.selected_frameworks?.join(" + ") || liveRuns[0].framework,
    status: formatRunStatus(liveStatus),
    progress: liveProgress,
    startedAt: backend.latestRun?.started_at ?? liveRuns[0].startedAt,
    probes: liveProbes,
    findings: liveFindings,
  };

  // Agent list: prefer SSE agents, else REST executions, else mock
  const liveAgents: AgentProgress[] = progress?.agents ?? [];
  const restAgents = backend.agentExecutions;

  function copyHash(hash: string) {
    navigator.clipboard.writeText(hash).catch(() => {});
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 1500);
  }

  const activityEvents: UiAuditEvent[] = backend.ledgerEntries.length
    ? backend.ledgerEntries.map(mapLedgerEvent)
    : auditEvents;
  const displayedFindings: UiFinding[] = backend.findings.length
    ? backend.findings.map(mapBackendFinding)
    : mockFindings;

  return (
    <div className="space-y-5">
      {/* Connection indicator */}
      {runId && (
        <div className={clsx(
          "flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px] font-medium",
          connected
            ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400"
            : "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400"
        )}>
          <div className={clsx("h-2 w-2 rounded-full", connected ? "bg-emerald-500 animate-pulse" : "bg-amber-400")} />
          {connected ? "Live — streaming progress from backend" : "Polling — SSE not connected, using REST fallback"}
        </div>
      )}

      {/* Top metrics */}
      <div className={clsx("grid gap-3", isDev ? "md:grid-cols-4" : "md:grid-cols-3")}>
        {isDev && (
          <div title="Total probes / metric results in this run">
            <MetricCard label="Probes Sent" value={run.probes} icon={Send} tone="blue" />
          </div>
        )}
        <div title="Agents active vs total">
          <MetricCard
            label="Agents Active"
            value={
              liveAgents.length
                ? `${liveAgents.filter(a => a.status === "running").length} / ${liveAgents.length}`
                : restAgents.length
                  ? `${restAgents.filter(a => a.status === "running").length} / ${restAgents.length}`
                  : `0 / 7`
            }
            icon={Bot}
            tone="amber"
          />
        </div>
        <div title="Findings logged so far">
          <MetricCard label="Findings So Far" value={run.findings} icon={ShieldAlert} tone="red" />
        </div>
        <div title="Percentage of pipeline completed">
          <MetricCard label="Pipeline Progress" value={`${run.progress}%`} icon={Activity} tone="green" />
        </div>
      </div>

      {/* System selector + Application Context Profile */}
      <AuditTargetSelector navigateTo={navigateTo} report={backend.report} />

      {/* Export buttons + Execution Layer Trace — developer altitude only */}
      {isDev && (<>
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-semibold text-slate-500 dark:text-slate-400">Execution Layer Trace</p>
        <div className="flex items-center gap-1.5">
          <button onClick={exportPDF} className="flex items-center gap-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700" title="PDF report">
            <FileText className="h-3 w-3" /> PDF
          </button>
          <button onClick={exportJSON} className="flex items-center gap-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700" title="JSON data">
            <FileJson className="h-3 w-3" /> JSON
          </button>
          <button onClick={exportCSV} className="flex items-center gap-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700" title="CSV findings">
            <Download className="h-3 w-3" /> CSV
          </button>
          <button onClick={exportLedger} className="flex items-center gap-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700" title="Ledger">
            <Download className="h-3 w-3" /> Ledger
          </button>
          <button onClick={exportEvidenceBundle} className="flex items-center gap-1.5 rounded border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/40 px-2.5 py-1.5 text-[11px] font-medium text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40" title="Evidence bundle">
            <Download className="h-3 w-3" /> Evidence Bundle
          </button>
        </div>
      </div>

      {/* Execution Layer Trace */}
      <div className="space-y-5">
        <ExecutionLayerTrace />
        <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
          <RuntimeEventStream />
          <div className="space-y-5">
            <RuntimeArchitecture />
            <ArtifactDrawer />
          </div>
        </div>
      </div>
      </>)}

      {/* Agents + Activity log */}
      <div className="grid gap-5 xl:grid-cols-[1fr_1.1fr]">

        {/* Agent status — real data or mock */}
        <Card>
          <CardHeader
            title="Specialist Agent Status"
            eyebrow={
              liveAgents.length
                ? `Live — ${liveAgents.length} agents tracked`
                : restAgents.length
                  ? `Backend — ${restAgents.length} executions`
                  : "Mock data — no run yet"
            }
            action={
              isDev ? (
                <button onClick={() => navigateTo("/agents")} className="text-[11px] font-medium text-blue-700 underline-offset-2 hover:underline">
                  Full intelligence view →
                </button>
              ) : undefined
            }
          />
          <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
            {(liveAgents.length ? liveAgents : restAgents.length ? restAgents.map(e => ({
              name: e.agent_name,
              status: e.status,
              finding_count: e.finding_count ?? 0,
              started_at: e.started_at ?? null,
              completed_at: e.completed_at ?? null,
            })) : mockAgents.map(a => ({
              name: a.name,
              status: a.status === "Running" ? "running" : a.status === "Complete" ? "completed" : "pending",
              finding_count: a.findings,
              started_at: null,
              completed_at: null,
            }))).map((agent) => {
              const key = "name" in agent ? agent.name : (agent as AgentProgress).name;
              const isExpanded = expandedAgent === key;
              const displayName = agentDisplayName(key);
              const role = agentRoleFor(key);
              const st = agent.status;
              return (
                <div key={key}>
                  <button
                    onClick={() => setExpandedAgent(isExpanded ? null : key)}
                    className="grid w-full grid-cols-[1fr_90px_90px_20px] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  >
                    <div>
                      <p className="text-[13px] font-semibold text-slate-950 dark:text-white">{displayName}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">{role}</p>
                    </div>
                    <Badge tone={
                      st === "completed" ? "green" :
                      st === "running"   ? "amber" :
                      st === "failed"    ? "red" : "slate"
                    }>
                      {st === "completed" ? "Complete" : st === "running" ? "Running" : st === "failed" ? "Failed" : "Pending"}
                    </Badge>
                    <div className="text-right">
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">{agent.finding_count} findings</p>
                      <div className="mt-1 h-1.5 rounded bg-slate-200 dark:bg-slate-700">
                        <div
                          className={clsx("h-full rounded", st === "completed" ? "bg-emerald-500" : st === "failed" ? "bg-red-400" : "bg-blue-700")}
                          style={{ width: st === "completed" ? "100%" : st === "running" ? "60%" : "0%" }}
                        />
                      </div>
                    </div>
                    {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />}
                  </button>
                  {isExpanded && (
                    <div className="grid grid-cols-3 gap-3 border-t border-slate-100 dark:border-slate-700/50 bg-slate-50 dark:bg-slate-800/50 px-4 py-3">
                      <Stat label="Status" value={st} />
                      <Stat label="Findings" value={String(agent.finding_count)} />
                      <Stat
                        label="Duration"
                        value={
                          agent.started_at && agent.completed_at
                            ? `${Math.round((new Date(agent.completed_at).getTime() - new Date(agent.started_at).getTime()) / 1000)}s`
                            : agent.started_at ? "Running…" : "—"
                        }
                      />
                      {isDev && (
                        <div className="col-span-3 flex gap-2">
                          <button onClick={() => navigateTo("/agents")} className="flex items-center gap-1.5 rounded border border-blue-300 dark:border-blue-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-[11px] font-medium text-blue-800 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30">
                            <Zap className="h-3 w-3" /> Full agent detail
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        {/* Activity log */}
        <Card>
          <CardHeader
            title="Activity Log"
            eyebrow="Live ledger feed — click event to expand"
            action={
              <button onClick={() => navigateTo("/ledger")} className="text-[11px] font-medium text-blue-700 underline-offset-2 hover:underline">
                Full ledger →
              </button>
            }
          />

          {/* Live phase progression log from SSE */}
          {progress && (
            <div className="border-b border-slate-100 dark:border-slate-700/50 px-4 py-2">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Live pipeline events</p>
              <div className="space-y-1">
                {LAYERS.slice(0, phaseIndex(livePhase) + 1).reverse().map((layer) => {
                  const st = layerStatus(layer.id, livePhase, liveStatus);
                  return (
                    <div key={layer.id} className="flex items-center gap-2">
                      <LayerIcon status={st} />
                      <span className="text-[11px] text-slate-700 dark:text-slate-300">{layer.label}</span>
                      {st === "active" && <span className="rounded bg-blue-100 dark:bg-blue-900/40 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-400">in progress</span>}
                      {st === "done"   && <span className="rounded bg-emerald-100 dark:bg-emerald-900/40 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">done</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Audit events (backend or demo fallback) */}
          <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
            {activityEvents.map((event) => {
              const isExpanded = expandedEvent === event.id;
              return (
                <div key={event.id}>
                  <button
                    onClick={() => setExpandedEvent(isExpanded ? null : event.id)}
                    className="flex w-full items-start gap-2 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  >
                    <div className="mt-0.5 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{event.timestamp}</span>
                        <span className="rounded border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">{event.type}</span>
                        <span className="text-[11px] font-semibold text-slate-950 dark:text-white">{event.actor}</span>
                      </div>
                      <p className="mt-1 text-[12px] leading-5 text-slate-700 dark:text-slate-300">{event.description}</p>
                    </div>
                    {isExpanded ? <ChevronDown className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" /> : <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" />}
                  </button>
                  {isExpanded && (
                    <div className="border-t border-slate-100 dark:border-slate-700/50 bg-slate-50 dark:bg-slate-800/50 px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Hash</p>
                          <p className="font-mono text-[11px] text-slate-950 dark:text-white">{event.hash}</p>
                        </div>
                        <button onClick={() => copyHash(event.hash)} className="flex items-center gap-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-[10px] text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                          <Copy className="h-3 w-3" />
                          {copiedHash === event.hash ? "Copied!" : "Copy"}
                        </button>
                      </div>
                      <p className="mt-2 text-[10px] text-slate-500 dark:text-slate-400">Parent: <span className="font-mono text-slate-700 dark:text-slate-300">{event.parentHash}</span></p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Findings list */}
      <Card>
        <CardHeader
          title="Findings Logged This Run"
          eyebrow={`${run.findings} total — click to expand evidence`}
          action={
            isDev ? (
              <button onClick={() => navigateTo("/council")} className="text-[11px] font-medium text-blue-700 underline-offset-2 hover:underline">
                Council deliberation →
              </button>
            ) : (
              <button onClick={() => navigateTo("/evidence")} className="text-[11px] font-medium text-blue-700 underline-offset-2 hover:underline">
                View evidence →
              </button>
            )
          }
        />
        <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
          {displayedFindings.map((finding) => {
            const isExpanded = expandedFinding === finding.id;
            return (
              <div key={finding.id}>
                <button
                  onClick={() => setExpandedFinding(isExpanded ? null : finding.id)}
                  className={clsx("flex w-full items-start gap-3 border-l-4 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60", SEVERITY_BORDER[finding.severity])}
                >
                  <AlertTriangle className={clsx("mt-0.5 h-4 w-4 shrink-0",
                    finding.severity === "Critical" ? "text-red-600 dark:text-red-400" :
                    finding.severity === "High"     ? "text-orange-500 dark:text-orange-400" : "text-amber-500 dark:text-amber-400"
                  )} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-semibold text-slate-950 dark:text-white">{finding.title}</p>
                      <span className={clsx("rounded px-1.5 py-0.5 text-[10px] font-semibold",
                        finding.severity === "Critical" ? "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400" :
                        finding.severity === "High"     ? "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400" :
                        "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400"
                      )}>{finding.severity}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{finding.agent} · {finding.framework}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300">{finding.confidence}% conf.</span>
                    {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />}
                  </div>
                </button>
                {isExpanded && (
                  <div className={clsx("border-l-4 px-4 py-3", SEVERITY_BORDER[finding.severity], SEVERITY_BG[finding.severity])}>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Evidence</p>
                    <p className="text-[12px] leading-5 text-slate-700 dark:text-slate-300">{finding.evidence}</p>
                    <div className="mt-3 flex gap-2">
                      {isDev ? (
                        <>
                          <button onClick={() => navigateTo("/agents")} className="flex items-center gap-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-[11px] font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
                            <Clock className="h-3 w-3" /> Agent timeline
                          </button>
                          <button onClick={() => navigateTo("/council")} className="flex items-center gap-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-[11px] font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
                            Council deliberation →
                          </button>
                        </>
                      ) : (
                        <button onClick={() => navigateTo("/evidence")} className="flex items-center gap-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-[11px] font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
                          View evidence →
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Result summary when run is complete */}
      {progress?.result_summary && Object.keys(progress.result_summary).length > 0 && (
        <Card>
          <CardHeader title="Run Summary" eyebrow="From backend result_summary" action={<Badge tone="green">Complete</Badge>} />
          <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
            {Object.entries(progress.result_summary).map(([k, v]) => (
              <Stat key={k} label={k.replace(/_/g, " ")} value={formatSummaryValue(v)} />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// Render result_summary values gracefully — the backend includes arrays of
// objects (e.g. agents_run) that would otherwise stringify to "[object Object]".
function formatSummaryValue(v: unknown): string {
  if (v == null) return "—";
  if (Array.isArray(v)) {
    if (v.length === 0) return "0";
    if (typeof v[0] === "object" && v[0] !== null) {
      const named = v
        .map((item) => {
          const o = item as Record<string, unknown>;
          const name = o.agent_name ?? o.name ?? o.id;
          return typeof name === "string" ? name.replace(/_/g, " ") : null;
        })
        .filter(Boolean);
      return named.length ? named.join(", ") : `${v.length} items`;
    }
    return v.map(String).join(", ");
  }
  if (typeof v === "object") return `${Object.keys(v as object).length} fields`;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-0.5 text-[13px] font-semibold text-slate-950 dark:text-white">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit Target Selector + Application Context Profile panel
// ---------------------------------------------------------------------------

function formatContextValue(value: unknown): string {
  if (value == null) return "Not provided";
  if (Array.isArray(value)) {
    if (value.length === 0) return "None";
    return value.map(formatContextValue).join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function contextRows(section: Record<string, unknown>): [string, string][] {
  const rows = Object.entries(section).map(([key, value]) => [titleCase(key), formatContextValue(value)] as [string, string]);
  return rows.length ? rows : [["Status", "No fields provided"]];
}

function buildBackendContextProfile(report: GovernanceReport | null): ApplicationContextProfile | undefined {
  if (!report?.context_profile) return undefined;
  const profile = report.context_profile;
  return {
    systemId: report.ai_system.id,
    version: report.ai_system.model_version ?? "v1",
    frameworks: report.ai_system.selected_frameworks.map((framework) => ({
      name: titleCase(framework),
      desc: "Selected on the registered AI system.",
      active: true,
    })),
    sections: [
      {
        letter: "A",
        title: "Application Identity & Purpose",
        owner: "Orchestrator, Compliance Mapper",
        fields: contextRows(profile.identity_purpose),
      },
      {
        letter: "B",
        title: "Pre-Model Business Rules",
        owner: "Bias Auditor, Misuse Detector, Drift Analyst",
        fields: contextRows(profile.pre_model_controls),
      },
      {
        letter: "C",
        title: "Model Configuration",
        owner: "All probing agents",
        fields: contextRows(profile.model_configuration),
      },
      {
        letter: "D",
        title: "Post-Model Business Rules",
        owner: "Bias Auditor, Misuse Detector, Explainability Agent",
        fields: contextRows(profile.post_model_controls),
      },
      {
        letter: "E",
        title: "Integration Context",
        owner: "Risk Scorer",
        fields: contextRows(profile.integration_context),
      },
    ],
  };
}

function AuditTargetSelector({ navigateTo, report }: { navigateTo: (path: string) => void; report: GovernanceReport | null }) {
  const backendSystem = report?.ai_system ?? null;
  const backendProfile = buildBackendContextProfile(report);
  const [selectedId, setSelectedId] = useState<string>(backendSystem?.id ?? mockSystems[0]?.id ?? "");
  const [expanded, setExpanded]     = useState(false);
  const [activeSection, setActiveSection] = useState<string>("A");

  useEffect(() => {
    if (backendSystem?.id) {
      setSelectedId(backendSystem.id);
      setActiveSection("A");
    }
  }, [backendSystem?.id]);

  const systemOptions = backendSystem
    ? [{ id: backendSystem.id, name: backendSystem.name, version: backendSystem.model_version ?? "v1" }]
    : mockSystems.map((s) => ({ id: s.id, name: s.name, version: s.version }));

  const fallbackSystem = mockSystems.find((s) => s.id === selectedId) ?? mockSystems[0];
  const system = backendSystem && selectedId === backendSystem.id
    ? {
        id: backendSystem.id,
        name: backendSystem.name,
        version: backendSystem.model_version ?? "v1",
        riskTier: titleCase(backendSystem.risk_tier),
        environment: titleCase(backendSystem.deployment_environment),
        applicationType: titleCase(backendSystem.system_type),
      }
    : fallbackSystem;
  const acp: ApplicationContextProfile | undefined =
    backendProfile && selectedId === backendProfile.systemId
      ? backendProfile
      : applicationContextProfiles.find((p) => p.systemId === selectedId);

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
      {/* Header row — selector + expand toggle */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-600/10 dark:bg-brand-600/20">
          <Layers className="h-4 w-4 text-brand-600 dark:text-brand-400" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500 mb-0.5">
            Audit Target
          </p>
          <select
            value={selectedId}
            onChange={(e) => { setSelectedId(e.target.value); setActiveSection("A"); }}
            className="w-full max-w-xs rounded border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-2 py-1 text-[13px] font-semibold text-slate-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-300 dark:focus:ring-brand-700 transition-colors"
          >
            {systemOptions.map((s) => (
              <option key={s.id} value={s.id}>{s.name} — {s.version}</option>
            ))}
          </select>
        </div>

        {/* Quick-glance pills */}
        {system && (
          <div className="hidden md:flex items-center gap-2 flex-wrap">
            {[
              { label: system.riskTier + " Risk", color: system.riskTier === "High" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400" : system.riskTier === "Medium" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400" },
              { label: system.environment, color: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300" },
              { label: system.applicationType, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" },
            ].map((p) => (
              <span key={p.label} className={clsx("rounded px-2 py-0.5 text-[10px] font-semibold", p.color)}>{p.label}</span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => navigateTo("/systems")}
            className="text-[11px] font-medium text-blue-700 dark:text-blue-400 hover:underline underline-offset-2"
          >
            Manage →
          </button>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 rounded border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            {expanded ? "Hide" : "View"} Context Profile
            <ChevronDown className={clsx("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
          </button>
        </div>
      </div>

      {/* Expanded ACP panel */}
      {expanded && acp && (
        <div className="border-t border-slate-200 dark:border-slate-700">
          {/* Callout */}
          <div className="bg-brand-50 dark:bg-brand-950/20 border-b border-brand-100 dark:border-brand-900/40 px-4 py-2.5">
            <p className="text-[11px] leading-5 text-brand-800 dark:text-brand-300">
              <span className="font-semibold">Why this matters.</span> Without this profile, agents test a model in a lab — not in production. The Bias Auditor needs Section B to know which data reaches the model; the Risk Scorer needs Section E to compute blast radius; the Council needs all five sections to produce verdicts that reflect production reality.
            </p>
          </div>

          {/* Section tabs + content */}
          <div className="flex min-h-0">
            {/* Section tab strip */}
            <div className="flex flex-col border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 py-2 shrink-0">
              {acp.sections.map((sec) => (
                <button
                  key={sec.letter}
                  onClick={() => setActiveSection(sec.letter)}
                  className={clsx(
                    "flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors",
                    activeSection === sec.letter
                      ? "bg-white dark:bg-slate-900 border-r-2 border-brand-500 -mr-px"
                      : "hover:bg-white/60 dark:hover:bg-slate-800"
                  )}
                >
                  <span className={clsx(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold",
                    activeSection === sec.letter
                      ? "bg-brand-600 text-white"
                      : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400"
                  )}>{sec.letter}</span>
                  <span className={clsx(
                    "text-[11px] font-medium whitespace-nowrap",
                    activeSection === sec.letter ? "text-slate-900 dark:text-white" : "text-slate-500 dark:text-slate-400"
                  )}>{sec.title}</span>
                </button>
              ))}
            </div>

            {/* Section content */}
            {acp.sections.filter((s) => s.letter === activeSection).map((sec) => (
              <div key={sec.letter} className="flex-1 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-semibold text-slate-900 dark:text-white">{sec.title}</p>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500">{sec.owner}</p>
                  </div>
                  <span className="flex h-6 w-6 items-center justify-center rounded bg-brand-600 text-[11px] font-bold text-white">{sec.letter}</span>
                </div>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {sec.fields.map(([key, val]) => (
                    <div key={key} className="flex items-start justify-between gap-2 rounded border border-slate-100 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-800/50 px-3 py-2">
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 shrink-0">{key}</p>
                      <p className="text-right text-[11px] font-medium text-slate-900 dark:text-white">{val}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Frameworks footer */}
          <div className="border-t border-slate-200 dark:border-slate-700 px-4 py-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Active Frameworks</p>
            <div className="flex flex-wrap gap-2">
              {acp.frameworks.map((fw) => (
                <span
                  key={fw.name}
                  className={clsx(
                    "rounded border px-2.5 py-1 text-[11px] font-medium transition-colors",
                    fw.active
                      ? "border-brand-300 dark:border-brand-700 bg-brand-50 dark:bg-brand-950/30 text-brand-700 dark:text-brand-400"
                      : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-400 dark:text-slate-500 line-through"
                  )}
                  title={fw.desc}
                >
                  {fw.name}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* No ACP registered yet */}
      {expanded && !acp && (
        <div className="border-t border-slate-200 dark:border-slate-700 px-4 py-6 text-center">
          <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-300">No context profile for this system yet</p>
          <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
            Go to <button onClick={() => navigateTo("/systems")} className="text-blue-700 dark:text-blue-400 underline underline-offset-2">AI Systems</button> and open the Context Profile tab to fill it in before running an audit.
          </p>
        </div>
      )}
    </div>
  );
}
