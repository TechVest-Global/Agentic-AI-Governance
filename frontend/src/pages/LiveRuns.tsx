import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bot,
  ChevronDown,
  Clock,
  Download,
  FileJson,
  FileText,
  Layers,
  ScanSearch,
  Send,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import clsx from "clsx";
import type { ApplicationContextProfile } from "@/data/mockData";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { MetricCard } from "@/components/ui/MetricCard";
import { useAppStore } from "@/store/useAppStore";
import { useAuthStore } from "@/store/useAuthStore";
import { personaForRole } from "@/lib/persona";
import { EndpointCoveragePanel } from "@/components/execution/EndpointCoveragePanel";
import { AgentDetailCard, AgentGlyph, buildAgentsFromBackend, type AgentTab } from "@/components/execution/AgentDetailCard";
import { CallTranscripts } from "@/components/execution/CallTranscripts";
import { AdaptiveOrchestratorPanel } from "@/components/execution/AdaptiveOrchestratorPanel";
import { ContextAssemblyPanel } from "@/components/execution/ContextAssemblyPanel";
import { DeliberationCouncilPanel } from "@/components/execution/DeliberationCouncilPanel";
import { LiveRunSidebar, type CouncilMemberId } from "@/components/execution/LiveRunSidebar";
import { MetricPlanApprovalModal } from "@/components/execution/MetricPlanApprovalModal";
import { RunSwitcher } from "@/components/layout/RunSwitcher";
import { RuntimeEventStream } from "@/components/execution/RuntimeEventStream";
import { ArtifactDrawer } from "@/components/execution/ArtifactDrawer";
import {
  buildComplianceReport,
  exportAuditLedgerJSON,
  exportEvidenceBundleJSON,
  exportReportCSV,
  exportReportJSON,
  exportReportPDF,
} from "@/utils/complianceReport";
import { useGovernanceBackend } from "@/hooks/useGovernanceBackend";
import { useRunProgress, phaseIndex, type AgentProgress } from "@/hooks/useRunProgress";
import { MODEL_CALLING_LAYERS, PIPELINE_STEPS, layerStatus } from "@/pages/pipelineSteps";
import { metricBlurb, metricName } from "@/data/metricCatalog";
import type { AuditLedgerEntry, CouncilIteration, FindingToolCall, FrameworkComplianceMap, GovernanceReport, LlmCall } from "@/api/governanceApi";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRunStatus(status: string): "Running" | "Complete" | "Waiting" | "Failed" {
  if (status === "completed" || status === "report_ready") return "Complete";
  if (status === "failed" || status === "cancelled") return "Failed";
  if (status === "created") return "Waiting";
  return "Running";
}

type UiFinding = {
  id: string;
  agent: string;
  /** Raw backend agent_name (e.g. "risk_scorer") for matching LLM-call attribution. */
  agentKey?: string;
  title: string;
  severity: "Critical" | "High" | "Medium" | "Low";
  framework: string;
  evidence: string;
  confidence: number;
  summary?: string;
  recommendedAction?: string | null;
  dimension?: string;
  metricId?: string | null;
  toolCalls?: FindingToolCall[];
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

function mapBackendFinding(finding: GovernanceReport["findings"][number]): UiFinding {
  return {
    id: finding.id,
    agent: finding.agent_name ? titleCase(finding.agent_name) : titleCase(finding.finding_type),
    agentKey: finding.agent_name ?? undefined,
    title: finding.title,
    severity: findingSeverity(finding.severity),
    framework: finding.framework_refs.length ? finding.framework_refs.join(", ") : finding.dimension,
    evidence: finding.summary,
    confidence: Math.round(finding.confidence * 100),
    summary: finding.summary,
    recommendedAction: finding.recommended_action,
    dimension: finding.dimension,
    metricId: (finding.payload?.metric_id as string | null | undefined) ?? null,
    toolCalls: finding.payload?.tool_calls ?? [],
  };
}


// ---------------------------------------------------------------------------
// Step detail panel — always-visible right column reflecting the selected step
// ---------------------------------------------------------------------------

/** Shown in the detail panel for any step until a run actually exists. */
function NoRunMessage() {
  return (
    <div className="flex h-full min-h-80 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 dark:border-slate-700 px-6 text-center">
      <ScanSearch className="h-6 w-6 text-slate-300 dark:text-slate-600" />
      <p className="text-[13px] font-semibold text-slate-600 dark:text-slate-300">Run the audit to view details</p>
      <p className="max-w-xs text-[12px] leading-relaxed text-slate-400 dark:text-slate-500">
        This layer's information will appear here once a governance run starts.
      </p>
    </div>
  );
}

/** Shown for a layer the run has not reached yet — prevents stale/placeholder
 *  content (e.g. the metric table) from appearing before the layer is active. */
function NotStartedMessage({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-80 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 dark:border-slate-700 px-6 text-center">
      <Clock className="h-6 w-6 text-slate-300 dark:text-slate-600" />
      <p className="text-[13px] font-semibold text-slate-600 dark:text-slate-300">Not started yet</p>
      <p className="max-w-xs text-[12px] leading-relaxed text-slate-400 dark:text-slate-500">
        The <span className="font-medium">{label}</span> layer hasn't run yet. It will populate here once the run reaches this stage.
      </p>
    </div>
  );
}

/** One expandable finding row on the Action & Reporting panel: the header keeps
 *  the compact look; expanding reveals how the conclusion was reached — the
 *  agent's written analysis, real tool evidence, the probes that agent sent to
 *  the target system, and the recommended remediation. */
function ExpandableFindingCard({
  finding,
  index,
  llmCalls,
}: {
  finding: UiFinding;
  index: number;
  llmCalls: LlmCall[];
}) {
  const [expanded, setExpanded] = useState(false);

  // Probes this finding's agent sent to the audited system (target calls
  // attributed to the agent by the LLM gateway).
  const agentProbes = useMemo(
    () =>
      finding.agentKey
        ? llmCalls.filter((c) => c.call_type === "target" && c.agent_name === finding.agentKey)
        : [],
    [llmCalls, finding.agentKey],
  );
  const probeSamples = agentProbes.filter((c) => c.prompt_text).slice(0, 3);
  const hasDetail = Boolean(
    finding.summary || finding.recommendedAction || (finding.toolCalls?.length ?? 0) || agentProbes.length,
  );

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
      <button
        onClick={() => hasDetail && setExpanded((v) => !v)}
        className={clsx("flex w-full items-start gap-3 p-4 text-left", hasDetail && "cursor-pointer")}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 dark:bg-slate-700 text-[12px] font-bold text-white">{index + 1}</span>
        <div className="min-w-0 flex-1">
          <h4 className="text-[13px] font-semibold text-slate-950 dark:text-white">{finding.title}</h4>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{finding.severity} · {finding.agent} · {finding.framework}</p>
        </div>
        <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 shrink-0">{finding.confidence}%</span>
        {hasDetail && (
          <ChevronDown
            className={clsx(
              "mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform",
              expanded && "rotate-180",
            )}
          />
        )}
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-slate-100 dark:border-slate-800 px-4 py-3 pl-14">
          {finding.summary && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Why this was flagged</p>
              <p className="mt-1 text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">{finding.summary}</p>
            </div>
          )}

          {(finding.toolCalls?.length ?? 0) > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Tool evidence</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {finding.toolCalls!.map((tc, i) => (
                  <span
                    key={`${tc.metric_id}-${i}`}
                    title={metricBlurb(tc.metric_id, metricName(tc.metric_id))}
                    className={clsx(
                      "inline-flex cursor-help items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px]",
                      tc.passed === false
                        ? "border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400"
                        : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300",
                    )}
                  >
                    {tc.tool_name} · {metricName(tc.metric_id) !== tc.metric_id ? `${tc.metric_id} (${metricName(tc.metric_id)})` : tc.metric_id}
                    {typeof tc.normalized_score === "number" && ` · ${tc.normalized_score.toFixed(2)}`}
                    {tc.passed === false ? " · failed" : tc.passed === true ? " · passed" : ""}
                  </span>
                ))}
              </div>
            </div>
          )}

          {agentProbes.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Probes sent by {finding.agent} ({agentProbes.length} to the target system)
              </p>
              {probeSamples.length > 0 ? (
                <div className="mt-1.5 space-y-1.5">
                  {probeSamples.map((probe) => (
                    <div key={probe.id} className="rounded-md border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 px-2.5 py-2">
                      <p className="text-[11px] leading-snug text-slate-600 dark:text-slate-300">
                        <span className="font-semibold text-slate-500 dark:text-slate-400">→ </span>
                        {probe.prompt_text!.length > 220 ? `${probe.prompt_text!.slice(0, 220)}…` : probe.prompt_text}
                      </p>
                      {probe.response_text && (
                        <p className="mt-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                          <span className="font-semibold">← </span>
                          {probe.response_text.length > 220 ? `${probe.response_text.slice(0, 220)}…` : probe.response_text}
                        </p>
                      )}
                    </div>
                  ))}
                  {agentProbes.length > probeSamples.length && (
                    <p className="text-[10px] text-slate-400 dark:text-slate-500">
                      +{agentProbes.length - probeSamples.length} more — see the agent's Probes tab in Specialist Agents.
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  {agentProbes.length} probe call{agentProbes.length === 1 ? "" : "s"} recorded (transcripts not stored for this run) — see the agent's Probes tab in Specialist Agents.
                </p>
              )}
            </div>
          )}

          {finding.recommendedAction && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Recommended action</p>
              <p className="mt-1 text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">{finding.recommendedAction}</p>
            </div>
          )}

          {(finding.metricId || finding.dimension) && (
            <p
              className="text-[10px] text-slate-400 dark:text-slate-500"
              title={finding.metricId ? metricBlurb(finding.metricId, metricName(finding.metricId)) : undefined}
            >
              {finding.metricId
                ? `Triggered by metric ${finding.metricId}${metricName(finding.metricId) !== finding.metricId ? ` (${metricName(finding.metricId)})` : ""}`
                : ""}
              {finding.metricId && finding.dimension ? " · " : ""}
              {finding.dimension ? `dimension: ${finding.dimension}` : ""}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function PipelineStepContent({
  step,
  navigateTo,
  report,
  frameworkMap,
  liveArtifactData,
  intelligenceAgents,
  displayedFindings,
  llmCalls,
  runId,
  currentPhase,
  runStatus,
  selectedAgentId,
  selectedCouncilMemberId,
  ledgerEntries,
  councilIterations,
}: {
  step: (typeof PIPELINE_STEPS)[number];
  navigateTo: (path: string) => void;
  report: GovernanceReport | null;
  frameworkMap: FrameworkComplianceMap | null;
  liveArtifactData: Parameters<typeof ArtifactDrawer>[0]["liveData"];
  intelligenceAgents: ReturnType<typeof buildAgentsFromBackend>;
  displayedFindings: UiFinding[];
  llmCalls: LlmCall[];
  runId: string | null;
  currentPhase: string;
  runStatus: string;
  selectedAgentId: string | null;
  selectedCouncilMemberId: CouncilMemberId | null;
  ledgerEntries: AuditLedgerEntry[];
  councilIterations: CouncilIteration[];
}) {
  if (!runId) {
    return <NoRunMessage />;
  }

  if (step.id === "created") {
    return <AuditTargetSelector navigateTo={navigateTo} report={report} startExpanded />;
  }

  // Gate every non-setup layer on whether the run has actually reached it. A
  // layer that is still "pending" shows a "not started" state instead of stale
  // placeholder content (the metric table used to render mock rows regardless).
  if (layerStatus(step.id, currentPhase, runStatus) === "pending") {
    return <NotStartedMessage label={step.label} />;
  }

  // Every layer gets the same three-part runtime detail: the tamper-evident
  // event trail, the full prompt/response transcript of the model calls that
  // layer made, and its generated artifacts. The transcript used to exist only
  // inside a specialist agent's Probes tab, which meant the Layer 3a evaluator
  // probes and the council's reasoning — most of a run's calls — were stored
  // and served but rendered nowhere.
  const runtimeDetail = (
    <div className="space-y-4">
      <RuntimeEventStream entries={ledgerEntries} phaseFilter={step.id === "created" ? undefined : step.id} />
      {MODEL_CALLING_LAYERS.has(step.id) && (
        <CallTranscripts
          calls={llmCalls}
          phase={step.id}
          title={`${step.label} — Model Calls`}
          emptyHint={`No model calls recorded for ${step.label} yet.`}
        />
      )}
      <ArtifactDrawer liveData={liveArtifactData} layerFilter={step.eventLayer ?? undefined} />
    </div>
  );

  if (step.id === "metric_execution") {
    // Real metric results for this run, enriched with human name/owner/budget
    // from the run's metric plan. No fabricated rows — an empty result set shows
    // an explicit in-progress/empty state.
    const planByMetric = new Map(
      (report?.metric_plan?.metrics ?? []).map((m) => [m.metric_id, m]),
    );
    const rows = (report?.metric_results ?? []).map((r) => {
      const plan = planByMetric.get(r.metric_id);
      return {
        id: r.id,
        metricId: r.metric_id,
        name: plan?.name ?? r.metric_id,
        owner: plan?.primary_agent ?? r.tool_name ?? "—",
        budget: plan?.probe_budget ?? null,
        status: r.status,
        passed: r.passed,
      };
    });
    // Colour the pill by the status it actually displays — not by `passed`, which
    // is a separate concept (did the score meet the threshold) and would otherwise
    // render a "failed" execution in green when the metric happened to pass.
    const statusTone = (status: string) => {
      if (status === "passed" || status === "completed") return "green" as const;
      if (status === "failed" || status === "error") return "red" as const;
      if (status === "running" || status === "pending") return "amber" as const;
      return "slate" as const;
    };
    return (
      <div className="space-y-4">
        {rows.length === 0 ? (
          <p className="text-[12px] text-slate-500 dark:text-slate-400">
            Metric execution in progress — no results recorded yet.
          </p>
        ) : (
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                  <th className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-slate-400">Metric</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-slate-400">Owner</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-slate-400">Budget</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-slate-400">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2 font-medium text-slate-900 dark:text-white">{m.name}</td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{m.owner}</td>
                    <td className="px-3 py-2 font-mono text-slate-600 dark:text-slate-400">{m.budget != null ? `${m.budget} pts` : "—"}</td>
                    <td className="px-3 py-2">
                      <Badge tone={statusTone(m.status)}>{m.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {runtimeDetail}
      </div>
    );
  }

  if (step.id === "specialist_agents") {
    const selected = selectedAgentId ? intelligenceAgents.find((a) => a.id === selectedAgentId) : undefined;
    return (
      <div className="space-y-4">
        {/* Which audited surface received what, across every agent. Sits above
            the per-agent detail because coverage is a property of the run, not
            of any one agent — an endpoint nobody probed is invisible from
            inside each agent's own transcript. */}
        <EndpointCoveragePanel runId={runId} />
        {intelligenceAgents.length === 0 ? (
          <p className="text-[12px] text-slate-500 dark:text-slate-400">No agent executions recorded for this run yet.</p>
        ) : selected ? (
          <SelectedAgentDetail agent={selected} runId={runId} />
        ) : (
          <p className="text-[12px] text-slate-500 dark:text-slate-400">Select an agent from the sidebar to view its detail.</p>
        )}
        {runtimeDetail}
      </div>
    );
  }

  if (step.id === "deliberation_council") {
    return (
      <div className="space-y-4">
        <DeliberationCouncilPanel
          report={report}
          selectedMemberId={selectedCouncilMemberId}
          councilIterations={councilIterations}
        />
        {runtimeDetail}
      </div>
    );
  }

  if (step.id === "action_reporting") {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/20 px-4 py-3">
          <p className="text-[12px] text-slate-600 dark:text-slate-400">
            This panel shows this run's findings inline. For the full compliance report — framework
            mapping, evidence package, and export — open the dedicated Reports page.
          </p>
          <button
            onClick={() => navigateTo("/reports")}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-[12px] font-semibold text-white hover:bg-brand-700"
          >
            <FileText className="h-3.5 w-3.5" />
            View Full Compliance Report
          </button>
        </div>
        {displayedFindings.length === 0 ? (
          <p className="text-[12px] text-slate-500 dark:text-slate-400">No findings recorded for this run yet.</p>
        ) : (
          <div className="space-y-2">
            {displayedFindings.map((finding, i) => (
              <ExpandableFindingCard key={finding.id} finding={finding} index={i} llmCalls={llmCalls} />
            ))}
          </div>
        )}
        <ExportBar report={report} frameworkMap={frameworkMap} ledgerEntries={ledgerEntries} />
        {runtimeDetail}
      </div>
    );
  }

  if (step.id === "adaptive_orchestrator") {
    return (
      <div className="space-y-4">
        <AdaptiveOrchestratorPanel runId={runId} />
        {runtimeDetail}
      </div>
    );
  }

  // context_assembly
  return (
    <div className="space-y-4">
      <ContextAssemblyPanel runId={runId} />
      {runtimeDetail}
    </div>
  );
}

/** Export buttons driven by the live run — every file reflects the selected
 *  system/run, assembled from backend data (prototype fallback only when the
 *  backend is entirely unavailable). */
function ExportBar({
  report,
  frameworkMap,
  ledgerEntries,
}: {
  report: GovernanceReport | null;
  frameworkMap: FrameworkComplianceMap | null;
  ledgerEntries: AuditLedgerEntry[];
}) {
  const structured = useMemo(
    () => buildComplianceReport(report, frameworkMap),
    [report, frameworkMap],
  );
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button onClick={() => exportReportPDF(structured)} className="flex items-center gap-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
        <FileText className="h-3 w-3" /> PDF
      </button>
      <button onClick={() => exportReportJSON(structured)} className="flex items-center gap-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
        <FileJson className="h-3 w-3" /> JSON
      </button>
      <button onClick={() => exportReportCSV(structured)} className="flex items-center gap-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
        <Download className="h-3 w-3" /> CSV
      </button>
      <button onClick={() => exportAuditLedgerJSON(ledgerEntries, structured)} className="flex items-center gap-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
        <Download className="h-3 w-3" /> Ledger
      </button>
      <button onClick={() => exportEvidenceBundleJSON(report, structured)} className="flex items-center gap-1.5 rounded border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/40 px-2.5 py-1.5 text-[11px] font-medium text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40">
        <Download className="h-3 w-3" /> Evidence Bundle
      </button>
    </div>
  );
}

/** The currently-selected specialist agent's full detail card (agent list itself lives in the sidebar). */
function SelectedAgentDetail({
  agent,
  runId,
}: {
  agent: ReturnType<typeof buildAgentsFromBackend>[number];
  runId: string | null;
}) {
  const [tab, setTab] = useState<AgentTab>("Overview");
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="flex items-center gap-3 bg-blue-50 dark:bg-blue-950/30 px-4 py-3">
        <AgentGlyph agent={agent} />
        <p className="flex-1 text-[13px] font-semibold text-blue-800 dark:text-blue-300">{agent.name}</p>
        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{agent.probes} · {agent.confidence || "—"}%</span>
        <Badge tone={agent.status === "Complete" ? "green" : agent.status === "Running" ? "amber" : "slate"}>{agent.status}</Badge>
      </div>
      <AgentDetailCard agent={agent} runId={runId} activeTab={tab} onTabChange={setTab} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export function LiveRuns() {
  const navigateTo = useAppStore((state) => state.navigateTo);
  const role = useAuthStore((state) => state.user?.role);
  const approverName = useAuthStore((state) => state.user?.name) ?? null;
  // Auditors watch at altitude: agent status, findings, and progress — but not
  // the runtime traces, probe internals, or links into engine-only pages.
  const isDev = personaForRole(role) === "developer";
  const backend = useGovernanceBackend();
  // null = no explicit user choice yet, so the panel follows the live run phase automatically.
  const [selectedStep, setSelectedStep]       = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedCouncilMemberId, setSelectedCouncilMemberId] = useState<CouncilMemberId | null>(null);
  // Metric-plan approval modal — opened from the awaiting-approval banner so the
  // reviewer approves (or hand-picks metrics) without leaving the run canvas.
  const [showApprovalModal, setShowApprovalModal] = useState(false);

  // SSE live progress — uses latest run ID from polling hook
  const runId = backend.latestRun?.id ?? null;
  const { progress, connected } = useRunProgress(runId ?? null);

  // Compose run summary from SSE progress when available, else from REST polling, else from mock
  const liveStatus   = progress?.status ?? backend.latestRun?.status ?? "created";
  const livePhase    = progress?.current_phase ?? backend.latestRun?.current_phase ?? "created";
  const liveProgress = progress?.progress ?? (backend.latestRun ? Math.round(((phaseIndex(livePhase) + 1) / 8) * 100) : 0);
  // Live values only — no mock fallback. Without a run everything reads zero/empty.
  const liveProbes   = progress?.probe_count ?? backend.report?.counts?.metric_results ?? 0;
  const liveFindings = progress?.finding_count ?? backend.report?.counts?.findings ?? 0;
  const liveResultSummary = progress?.result_summary ?? backend.latestRun?.result_summary ?? undefined;

  const run = {
    id: backend.latestRun?.id ?? null,
    system: backend.report?.ai_system?.name ?? "—",
    framework: backend.latestRun?.selected_frameworks?.join(" + ") || "—",
    status: formatRunStatus(liveStatus),
    progress: liveProgress,
    startedAt: backend.latestRun?.started_at ?? null,
    probes: liveProbes,
    findings: liveFindings,
  };

  // Agent list: prefer SSE agents, else REST executions, else mock.
  // A run can contain multiple execution rows per agent (re-probes) — keep only the latest.
  const liveAgents: AgentProgress[] = progress?.agents ?? [];
  const restAgents = useMemo(() => {
    const latestByName = new Map<string, (typeof backend.agentExecutions)[number]>();
    for (const execution of backend.agentExecutions) {
      const existing = latestByName.get(execution.agent_name);
      if (!existing || (execution.started_at ?? "") > (existing.started_at ?? "")) {
        latestByName.set(execution.agent_name, execution);
      }
    }
    return Array.from(latestByName.values());
  }, [backend.agentExecutions]);

  // "Agents Active" tile. Numerator = agents not yet in a terminal state
  // (running/pending); denominator = total agents this run activated. Prefer
  // the SSE snapshot, then REST executions, then the evaluation plan's activated
  // agent count — so a freshly-started run shows "0 / N" (N = planned) rather
  // than a hardcoded fallback that never matched reality.
  const agentsActiveLabel = useMemo(() => {
    const isActive = (status: string) =>
      status !== "completed" && status !== "failed" && status !== "cancelled";
    if (liveAgents.length) {
      return `${liveAgents.filter(a => isActive(a.status)).length} / ${liveAgents.length}`;
    }
    if (restAgents.length) {
      return `${restAgents.filter(a => isActive(a.status)).length} / ${restAgents.length}`;
    }
    const planned = backend.evaluationPlan?.activated_agents?.length ?? 0;
    return `0 / ${planned}`;
  }, [liveAgents, restAgents, backend.evaluationPlan]);

  // Full agent intelligence detail (Overview/Probes/Evidence/Frameworks/Remediation/Runtime),
  // built from the same backend executions + findings — keyed by agent id.
  const intelligenceAgents = useMemo(
    () => buildAgentsFromBackend(
      backend.agentExecutions,
      backend.findings,
      backend.evaluationPlan?.activated_agents ?? [],
      backend.contextAssembly,
      backend.llmCalls,
    ),
    [backend.agentExecutions, backend.findings, backend.evaluationPlan, backend.contextAssembly, backend.llmCalls],
  );

  // Live findings only — an empty run shows the explicit empty state, not mock rows.
  const displayedFindings: UiFinding[] = backend.findings.map(mapBackendFinding);

  const liveArtifactData = backend.latestRun
    ? {
        run: backend.latestRun,
        report: backend.report,
        agentExecutions: backend.agentExecutions,
        findings: backend.findings,
        executionArtifacts: backend.executionArtifacts,
      }
    : null;

  // Which step is showing in the detail panel: an explicit user click wins; otherwise,
  // while a run is active, follow the live phase automatically. A completed run
  // lands on Action & Reporting ("completed" is not a pipeline step — without
  // this mapping the panel snapped back to Run Setup when the run finished).
  const livePanelPhase = livePhase === "completed" ? "action_reporting" : livePhase;
  const effectiveStep = selectedStep ?? (runId ? livePanelPhase : "created");
  const currentStepDef = PIPELINE_STEPS.find((s) => s.id === effectiveStep) ?? PIPELINE_STEPS[0];

  // Reset drops the run selection in the shared store (see useSelectionStore);
  // this drops the page's own per-run UI state alongside it, so the canvas
  // returns to "pick a target and run an audit" instead of keeping a pipeline
  // step and agent highlighted for a run that is no longer on screen.
  function handleResetView() {
    setSelectedStep(null);
    setSelectedAgentId(null);
    setSelectedCouncilMemberId(null);
    setShowApprovalModal(false);
  }

  // Clicking the already-selected agent toggles its detail closed.
  function handleSelectAgent(id: string) {
    setSelectedAgentId((current) => (current === id ? null : id));
    setSelectedStep("specialist_agents");
  }

  // Same toggle behavior for council members.
  function handleSelectCouncilMember(id: CouncilMemberId) {
    setSelectedCouncilMemberId((current) => (current === id ? null : id));
    setSelectedStep("deliberation_council");
  }

  return (
    <div className={clsx("gap-5", isDev ? "xl:grid xl:grid-cols-[260px_1fr]" : "space-y-5")}>
      {/* Metric-plan approval modal — in-canvas, no navigation. Rendered at the
          root so it stays open across the run leaving the 'planned' state. */}
      {showApprovalModal && backend.latestRun && (
        <MetricPlanApprovalModal
          run={backend.latestRun}
          approverName={approverName}
          onClose={() => setShowApprovalModal(false)}
          onApproved={() => {
            setShowApprovalModal(false);
            backend.refresh();
          }}
        />
      )}

      {isDev && (
        <div className="hidden xl:block">
          <LiveRunSidebar
            currentPhase={livePhase}
            runStatus={liveStatus}
            selectedStep={effectiveStep}
            onSelectStep={setSelectedStep}
            agents={intelligenceAgents}
            selectedAgentId={selectedAgentId}
            onSelectAgent={handleSelectAgent}
            selectedCouncilMemberId={selectedCouncilMemberId}
            onSelectCouncilMember={handleSelectCouncilMember}
            resultSummary={liveResultSummary}
            onReset={handleResetView}
          />
        </div>
      )}

      <div className="space-y-5 min-w-0">
        {/* Run switcher — pick which evaluation run this workspace is looking at */}
        <div className="flex items-center justify-between gap-3">
          <RunSwitcher alwaysVisible />
        </div>

        {/* Connection indicator — reflects the live-stream state without alarming
            copy when a run has simply finished (nothing left to stream). */}
        {runId && (() => {
          const isTerminal = ["completed", "failed", "cancelled"].includes(liveStatus);
          const tone = connected ? "live" : isTerminal ? "done" : "polling";
          const toneClass = {
            live: "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400",
            done: "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 text-slate-600 dark:text-slate-400",
            polling: "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400",
          }[tone];
          const dotClass = { live: "bg-emerald-500 animate-pulse", done: "bg-slate-400", polling: "bg-amber-400" }[tone];
          const label = {
            live: "Live — streaming progress from backend",
            done: "Run complete — showing final results",
            polling: "Refreshing every 4s — reconnecting to live updates",
          }[tone];
          return (
            <div className={clsx(
              "flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px] font-medium",
              toneClass,
            )}>
              <div className={clsx("h-2 w-2 rounded-full", dotClass)} />
              {label}
            </div>
          );
        })()}

        {/* Metric-plan approval gate: the run paused after planning and needs a
            reviewer's sign-off before probes run. Surface it prominently with a
            jump to the Metric Plan page where the Approve action lives. */}
        {runId && liveStatus === "planned" && !backend.latestRun?.plan_approved_at && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/40">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="text-[12px] font-semibold text-amber-800 dark:text-amber-300">
                  Metric plan awaiting approval
                </p>
                <p className="text-[11px] text-amber-700 dark:text-amber-400/90">
                  The orchestrator built this run&apos;s plan and paused. Review and approve it to start metric execution.
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowApprovalModal(true)}
              className="inline-flex items-center gap-1.5 rounded bg-amber-600 px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-amber-700"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Review &amp; approve plan
            </button>
          </div>
        )}

        {/* Top metrics */}
        <div className={clsx("grid gap-3", isDev ? "md:grid-cols-4" : "md:grid-cols-3")}>
          {isDev && (
            <MetricCard label="Probes Sent" value={run.probes} icon={Send} tone="blue" />
          )}
          <MetricCard
            label="Agents Active"
            value={agentsActiveLabel}
            icon={Bot}
            tone="amber"
          />
          <MetricCard label="Findings So Far" value={run.findings} icon={ShieldAlert} tone="red" />
          <MetricCard label="Pipeline Progress" value={`${run.progress}%`} icon={Activity} tone="green" />
        </div>

        {/* On smaller screens without the sidebar, the pipeline navigator collapses here */}
        <div className="xl:hidden">
          <LiveRunSidebar
            currentPhase={livePhase}
            runStatus={liveStatus}
            selectedStep={effectiveStep}
            onSelectStep={setSelectedStep}
            agents={intelligenceAgents}
            selectedAgentId={selectedAgentId}
            onSelectAgent={handleSelectAgent}
            selectedCouncilMemberId={selectedCouncilMemberId}
            onSelectCouncilMember={handleSelectCouncilMember}
            resultSummary={liveResultSummary}
            onReset={handleResetView}
          />
        </div>

        {/* Step detail — always reflects the selected (or, while running, the live) step */}
        <Card>
          <CardHeader title={currentStepDef.label} eyebrow={isDev ? `Step ${currentStepDef.number} of ${PIPELINE_STEPS.length - 1}` : undefined} />
          <div className="p-4">
            <PipelineStepContent
              step={currentStepDef}
              navigateTo={navigateTo}
              report={backend.report}
              frameworkMap={backend.frameworkMap}
              liveArtifactData={liveArtifactData}
              intelligenceAgents={intelligenceAgents}
              displayedFindings={displayedFindings}
              llmCalls={backend.llmCalls}
              runId={runId}
              currentPhase={livePhase}
              runStatus={liveStatus}
              selectedAgentId={selectedAgentId}
              selectedCouncilMemberId={selectedCouncilMemberId}
              ledgerEntries={backend.ledgerEntries}
              councilIterations={backend.councilIterations}
            />
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

function AuditTargetSelector({
  navigateTo,
  report,
  startExpanded,
}: {
  navigateTo: (path: string) => void;
  report: GovernanceReport | null;
  startExpanded?: boolean;
}) {
  const backendSystem = report?.ai_system ?? null;
  const backendProfile = buildBackendContextProfile(report);
  const [selectedId, setSelectedId] = useState<string>(backendSystem?.id ?? "");
  const [expanded, setExpanded]     = useState(!!startExpanded);
  const [activeSection, setActiveSection] = useState<string>("A");

  useEffect(() => {
    if (backendSystem?.id) {
      setSelectedId(backendSystem.id);
      setActiveSection("A");
    }
  }, [backendSystem?.id]);

  // Backend-registered systems only — no prototype fallback. Without a backend
  // run there is nothing to audit, and the selector says so explicitly.
  const systemOptions = backendSystem
    ? [{ id: backendSystem.id, name: backendSystem.name, version: backendSystem.model_version ?? "v1" }]
    : [];

  const system = backendSystem && selectedId === backendSystem.id
    ? {
        id: backendSystem.id,
        name: backendSystem.name,
        version: backendSystem.model_version ?? "v1",
        riskTier: titleCase(backendSystem.risk_tier),
        environment: titleCase(backendSystem.deployment_environment),
        applicationType: titleCase(backendSystem.system_type),
      }
    : null;
  const acp: ApplicationContextProfile | undefined =
    backendProfile && selectedId === backendProfile.systemId ? backendProfile : undefined;

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
            {systemOptions.length === 0 && (
              <option value="">No registered system loaded — start a run to populate</option>
            )}
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
                  <p className="text-[13px] font-semibold text-slate-900 dark:text-white">{sec.title}</p>
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
