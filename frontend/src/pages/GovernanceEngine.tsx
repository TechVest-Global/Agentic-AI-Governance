import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Database,
  FileSearch,
  FileText,
  Layers,
  Loader2,
  Play,
  RefreshCw,
  Scale,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import { DetailDrawer } from "@/components/layout/DetailDrawer";
import {
  listAISystems,
  type AgentExecution,
  type BackendAISystem,
  type BackendFinding,
  type EvidenceRecord,
} from "@/api/governanceApi";
import { useEvaluationRunner } from "@/hooks/useEvaluationRunner";
import { useGovernanceBackend } from "@/hooks/useGovernanceBackend";
import { useSelectionStore } from "@/store/useSelectionStore";

type LayerId = "context" | "planning" | "agents" | "council" | "verdict" | "report";
type LayerStatus = "not_started" | "ready" | "running" | "complete" | "attention";
type DrawerTarget = { kind: "layer"; layer: LayerDefinition } | { kind: "agent"; agent: AgentExecution };

type LayerDefinition = {
  id: LayerId;
  n: number;
  name: string;
  icon: LucideIcon;
  summary: string;
  actionLabel: string;
  purpose: string;
  apis: string[];
  tables: string[];
  troubleshooting: string[];
};

const LAYERS: LayerDefinition[] = [
  {
    id: "context",
    n: 1,
    name: "Context Assembly",
    icon: Layers,
    summary: "Collects the selected application, context profile, capabilities, frameworks, and run inputs.",
    actionLabel: "Refresh context",
    purpose: "Build a run-specific package for the selected registered AI application before any metric or agent executes.",
    apis: ["GET /api/v1/ai-systems", "GET /api/v1/ai-systems/{id}/context-profile", "GET /api/v1/ai-systems/{id}/capabilities"],
    tables: ["ai_systems", "application_context_profiles", "ai_system_capabilities", "evaluation_runs"],
    troubleshooting: ["No system appears: register it in AI Systems first.", "Missing context: add the context profile before expecting production-aware checks.", "Missing capabilities: agents may not have target behaviour to probe."],
  },
  {
    id: "planning",
    n: 2,
    name: "Orchestrator Planning",
    icon: ClipboardList,
    summary: "Selects framework-driven metrics and assigns work to specialist agents.",
    actionLabel: "View plan",
    purpose: "Translate the selected system's risk tier, frameworks, capabilities, and context into a run metric plan.",
    apis: ["GET /api/v1/metrics", "GET /api/v1/evaluation-runs/{id}/metric-plan"],
    tables: ["metric_configs", "framework_mappings", "metric_results", "governance_state_entries"],
    troubleshooting: ["No metrics: check framework selection on the registered system.", "No plan: run the governance pipeline for this application.", "Unexpected dimensions: inspect framework-to-metric mappings."],
  },
  {
    id: "agents",
    n: 3,
    name: "Specialist Agents",
    icon: Bot,
    summary: "Runs backend-connected specialist agents against the selected application.",
    actionLabel: "Run pipeline",
    purpose: "Execute each backend specialist agent with the assembled context, selected metrics, and target application capabilities.",
    apis: ["POST /api/v1/evaluation-runs/{id}/orchestrate", "GET /api/v1/evaluation-runs/{id}/agents/executions", "GET /api/v1/evaluation-runs/{id}/findings"],
    tables: ["agent_executions", "evidence_records", "findings", "metric_results"],
    troubleshooting: ["Agent has not run yet: start the pipeline from Run Controls.", "Agent failed: inspect its trace and error summary.", "No evidence produced yet: confirm the target capability and real tool backend are reachable."],
  },
  {
    id: "council",
    n: 4,
    name: "Council Deliberation",
    icon: Scale,
    summary: "Aggregates agent outputs into synthesis, objections, and decision routing.",
    actionLabel: "Run council",
    purpose: "Use backend council deliberation to adjudicate findings, challenge weak evidence, and prepare a verdict.",
    apis: ["POST /api/v1/evaluation-runs/{id}/council/deliberate", "GET /api/v1/evaluation-runs/{id}/verdict"],
    tables: ["verdicts", "findings", "metric_results", "audit_ledger_entries"],
    troubleshooting: ["Council pending: agents must produce findings or metric results first.", "Low confidence: review evidence strength and unresolved findings.", "Council API failure: check latest ledger and backend logs."],
  },
  {
    id: "verdict",
    n: 5,
    name: "Verdict",
    icon: ShieldCheck,
    summary: "Shows the final confidence, action tier, and required actions.",
    actionLabel: "View verdict",
    purpose: "Convert council deliberation into a confidence-scored outcome for the selected AI application.",
    apis: ["GET /api/v1/evaluation-runs/{id}/verdict", "GET /api/v1/evaluation-runs/{id}/report"],
    tables: ["verdicts", "findings", "framework_mappings"],
    troubleshooting: ["No verdict: run council deliberation.", "Unexpected action tier: inspect findings severity and confidence.", "Missing actions: verify council response and report payload."],
  },
  {
    id: "report",
    n: 6,
    name: "Report + Audit Ledger",
    icon: FileText,
    summary: "Packages report evidence and sealed ledger events for auditability.",
    actionLabel: "Refresh report",
    purpose: "Expose regulator-ready report data and tamper-evident ledger events for the selected run.",
    apis: ["GET /api/v1/evaluation-runs/{id}/report", "GET /api/v1/evaluation-runs/{id}/ledger", "GET /api/v1/evaluation-runs/{id}/ledger/verify"],
    tables: ["audit_ledger_entries", "governance_state_entries", "evidence_records", "reports"],
    troubleshooting: ["No ledger entries: run the pipeline first.", "Chain unverified: refresh ledger verification.", "Report incomplete: verify verdict and findings are present."],
  },
];

const AGENT_DESCRIPTIONS: Record<string, string> = {
  bias_agent: "Checks protected-attribute and proxy-risk behaviour for this application using the selected context and fairness metrics.",
  quality_agent: "Checks response quality, instruction following, and task success for the selected application.",
  misuse_agent: "Checks jailbreak, prompt-injection, misuse, and boundary resistance for the selected application.",
  drift_agent: "Checks whether current behaviour diverges from expected baseline behaviour for the selected application.",
  compliance_mapper: "Maps observed behaviour, evidence, and findings to the selected governance frameworks.",
  risk_scorer: "Combines evidence, findings, framework exposure, and application context into risk scoring signals.",
  explainability_agent: "Checks whether explanations are faithful, grounded, and appropriate for this application's decisions.",
};

function titleCase(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function shortId(value?: string | null): string {
  if (!value) return "-";
  return value.length > 10 ? value.slice(0, 10) : value;
}

function layerStatusTone(status: LayerStatus): string {
  return {
    not_started: "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400",
    ready: "border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-800 dark:bg-brand-950/30 dark:text-brand-300",
    running: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300",
    complete: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300",
    attention: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300",
  }[status];
}

function layerAccent(status: LayerStatus): string {
  return {
    not_started: "border-l-slate-300 dark:border-l-slate-600",
    ready: "border-l-brand-500",
    running: "border-l-blue-500",
    complete: "border-l-emerald-500",
    attention: "border-l-amber-500",
  }[status];
}

function layerIconTone(status: LayerStatus): string {
  return {
    not_started: "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
    ready: "border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-800 dark:bg-brand-950/30 dark:text-brand-300",
    running: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300",
    complete: "border-emerald-600 bg-emerald-600 text-white",
    attention: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300",
  }[status];
}

function statusLabel(status: LayerStatus): string {
  return {
    not_started: "Not started",
    ready: "Ready",
    running: "Running",
    complete: "Complete",
    attention: "Needs attention",
  }[status];
}

function agentLabel(agentName: string): string {
  return titleCase(agentName);
}

function includesAgent(value: unknown, agentName: string): boolean {
  if (!value) return false;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.toLowerCase().includes(agentName.toLowerCase());
}

function isReportForSelected(report: ReturnType<typeof useGovernanceBackend>["report"], selectedSystem: BackendAISystem | null): boolean {
  return Boolean(report && selectedSystem && report.ai_system.id === selectedSystem.id);
}

export function GovernanceEngine() {
  const focusRun = useSelectionStore((s) => s.focusRun);
  const backend = useGovernanceBackend();
  const runner = useEvaluationRunner();
  const [systems, setSystems] = useState<BackendAISystem[]>([]);
  const [systemsError, setSystemsError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAISystems()
      .then((items) => {
        if (cancelled) return;
        setSystems(items);
        setSystemsError(null);
        setSelectedId((current) => current || items[0]?.id || "");
      })
      .catch((error: unknown) => {
        if (!cancelled) setSystemsError(error instanceof Error ? error.message : "Unable to load registered AI systems.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedSystem = useMemo(
    () => systems.find((system) => system.id === selectedId) ?? null,
    [systems, selectedId],
  );
  const activeReport = isReportForSelected(backend.report, selectedSystem) ? backend.report : null;
  const activeRun = activeReport?.run ?? null;
  const activeAgents = activeReport?.agent_executions ?? [];
  const activeFindings = activeReport?.findings ?? [];
  const activeEvidence = activeReport?.evidence ?? [];
  const activeLedger = activeRun ? backend.ledgerEntries.filter((entry) => entry.run_id === activeRun.id) : [];
  const activeState = activeRun ? backend.stateEntries.filter((entry) => entry.run_id === activeRun.id) : [];
  const activeVerdict = activeReport?.verdict ?? null;
  // Metrics run in mock mode until real tool adapters (garak/ragas/deepeval…) are
  // wired; when so, the metric evidence is simulated and must be labelled.
  const activeSummary = (activeRun?.result_summary ?? {}) as Record<string, unknown>;
  const isMockMetrics = activeSummary.mock_execution === true || activeSummary.evaluator_name === "mock";
  const layers = LAYERS.map((layer) => deriveLayerState(layer, {
    selectedSystem,
    activeReport,
    activeAgents,
    activeFindings,
    activeEvidence,
    activeLedger,
    activeVerdict,
    runnerRunning: runner.status === "running",
  }));

  async function runPipeline() {
    if (!selectedSystem || runner.status === "running") return;
    const result = await runner.run(selectedSystem, {
      onRunCreated: (run) => focusRun(run.id, selectedSystem.id),
    });
    if (result) {
      focusRun(result.run_id, selectedSystem.id);
      backend.refresh();
    }
  }

  async function runCouncil() {
    if (!activeRun) return;
    await backend.deliberate();
    backend.refresh();
  }

  function runLayerAction(layer: LayerDefinition) {
    if (layer.id === "agents") void runPipeline();
    else if (layer.id === "council") void runCouncil();
    else backend.refresh();
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-[#f6f7fb] p-4 text-ink dark:bg-[#0c1120] dark:text-slate-100 lg:p-6">
      <div className="mx-auto grid max-w-[1500px] gap-5 xl:grid-cols-[300px_minmax(0,1fr)_360px]">
        <aside className="space-y-4 xl:sticky xl:top-20 xl:h-[calc(100vh-6rem)] xl:overflow-y-auto">
          <SystemSelector
            systems={systems}
            selectedId={selectedId}
            selectedSystem={selectedSystem}
            error={systemsError}
            onSelect={setSelectedId}
          />
          <RunControls
            selectedSystem={selectedSystem}
            runnerStatus={runner.status}
            runnerError={runner.error}
            onRun={runPipeline}
          />
          <QuickStatus
            backendLoading={backend.loading}
            run={activeRun}
            agents={activeAgents}
            findings={activeFindings}
            verdict={activeVerdict}
          />
        </aside>

        <main className="min-w-0">
          <header className="mb-5 overflow-hidden rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-card dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-700 dark:text-brand-400">Developer Workspace</p>
                <h1 className="mt-1 font-display text-[24px] tracking-tight text-ink dark:text-white">Governance Pipeline Execution</h1>
                <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-400">Select a registered AI system, run the pipeline, and inspect each execution layer.</p>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 dark:border-brand-800 dark:bg-brand-950/30">
                <span className="h-2 w-2 rounded-full bg-brand-500" />
                <span className="text-[11px] font-semibold text-brand-800 dark:text-brand-300">Live backend workflow</span>
              </div>
            </div>
          </header>

          <div className="space-y-3">
            {layers.map(({ layer, status, summary }, index) => (
              <LayerCard
                key={layer.id}
                layer={layer}
                status={status}
                summary={summary}
                isLast={index === layers.length - 1}
                actionDisabled={(layer.id === "agents" && (!selectedSystem || runner.status === "running")) || (layer.id === "council" && !activeRun)}
                actionRunning={layer.id === "agents" && runner.status === "running"}
                onAction={() => runLayerAction(layer)}
                onDetails={() => setDrawer({ kind: "layer", layer })}
              />
            ))}
          </div>
        </main>

        <aside className="space-y-4 xl:sticky xl:top-20 xl:h-[calc(100vh-6rem)] xl:overflow-y-auto">
          <RightColumn
            loading={backend.loading}
            onRefresh={backend.refresh}
            stateEntries={activeState}
            evidence={activeEvidence}
            isMockMetrics={isMockMetrics}
            findings={activeFindings}
            verdict={activeVerdict}
            ledger={activeLedger}
          />
        </aside>
      </div>

      <WorkspaceDrawer
        target={drawer}
        selectedSystem={selectedSystem}
        report={activeReport}
        stateEntries={activeState}
        ledgerEntries={activeLedger}
        onClose={() => setDrawer(null)}
        onAgent={(agent) => setDrawer({ kind: "agent", agent })}
      />
    </div>
  );
}

function deriveLayerState(
  layer: LayerDefinition,
  data: {
    selectedSystem: BackendAISystem | null;
    activeReport: ReturnType<typeof useGovernanceBackend>["report"];
    activeAgents: AgentExecution[];
    activeFindings: BackendFinding[];
    activeEvidence: EvidenceRecord[];
    activeLedger: ReturnType<typeof useGovernanceBackend>["ledgerEntries"];
    activeVerdict: ReturnType<typeof useGovernanceBackend>["report"] extends infer R ? R extends { verdict?: infer V } ? V : never : never;
    runnerRunning: boolean;
  },
): { layer: LayerDefinition; status: LayerStatus; summary: string } {
  if (!data.selectedSystem) return { layer, status: "not_started", summary: "Select a registered AI system first." };
  if (data.runnerRunning) {
    if (layer.id === "context" || layer.id === "planning" || layer.id === "agents") return { layer, status: "running", summary: layer.summary };
  }

  switch (layer.id) {
    case "context":
      if (data.activeReport?.context_profile) return { layer, status: "complete", summary: "Context profile, capabilities, and frameworks loaded." };
      return { layer, status: data.activeReport ? "attention" : "ready", summary: data.activeReport ? "Run loaded, but context profile is missing." : "Ready to assemble context from registry data." };
    case "planning": {
      const metrics = data.activeReport?.metric_plan?.metrics.length ?? 0;
      return metrics ? { layer, status: "complete", summary: `${metrics} metrics planned for this application.` } : { layer, status: data.activeReport ? "attention" : "not_started", summary: "Metric plan will appear after pipeline execution." };
    }
    case "agents":
      if (data.activeAgents.some((agent) => agent.status === "running")) return { layer, status: "running", summary: "Specialist agents are running." };
      if (data.activeAgents.length) return { layer, status: "complete", summary: `${data.activeAgents.length} backend agents ran; ${data.activeFindings.length} findings created.` };
      return { layer, status: "ready", summary: "Ready to run backend specialist agents." };
    case "council":
      if (data.activeVerdict) return { layer, status: "complete", summary: "Council output is available." };
      return data.activeAgents.length ? { layer, status: "ready", summary: "Ready to deliberate agent outputs." } : { layer, status: "not_started", summary: "Waiting for specialist agents." };
    case "verdict":
      if (data.activeVerdict) return { layer, status: "complete", summary: `Verdict ready at ${Math.round(data.activeVerdict.confidence_score * 100)}% confidence.` };
      return { layer, status: "not_started", summary: "Waiting for council deliberation." };
    case "report":
      if (data.activeLedger.length) return { layer, status: "complete", summary: `${data.activeLedger.length} ledger events available for this run.` };
      return data.activeReport ? { layer, status: "ready", summary: "Report data loaded; ledger events pending." } : { layer, status: "not_started", summary: "Waiting for pipeline output." };
    default:
      return { layer, status: "not_started", summary: layer.summary };
  }
}

function SystemSelector({
  systems,
  selectedId,
  selectedSystem,
  error,
  onSelect,
}: {
  systems: BackendAISystem[];
  selectedId: string;
  selectedSystem: BackendAISystem | null;
  error: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-700 dark:bg-slate-900">
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Selected AI system</p>
      {systems.length ? (
        <select
          value={selectedId}
          onChange={(event) => onSelect(event.target.value)}
          className="mt-2 w-full rounded border border-slate-300 bg-white px-3 py-2 text-[13px] font-semibold text-slate-900 outline-none focus:border-brand-500 dark:border-slate-600 dark:bg-slate-950 dark:text-white"
        >
          {systems.map((system) => (
            <option key={system.id} value={system.id}>{system.name} / {system.model_version ?? "v1"}</option>
          ))}
        </select>
      ) : (
        <p className="mt-2 text-[12px] text-slate-500 dark:text-slate-400">No registered AI systems found.</p>
      )}
      {selectedSystem && (
        <div className="mt-3 space-y-2">
          <p className="text-[12px] leading-5 text-slate-600 dark:text-slate-300">{selectedSystem.description ?? "No description provided."}</p>
          <div className="flex flex-wrap gap-1.5">
            <Pill>{titleCase(selectedSystem.risk_tier)} risk</Pill>
            <Pill>{titleCase(selectedSystem.deployment_environment)}</Pill>
            <Pill>{titleCase(selectedSystem.system_type)}</Pill>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">{error}</p>}
    </section>
  );
}

function RunControls({
  selectedSystem,
  runnerStatus,
  runnerError,
  onRun,
}: {
  selectedSystem: BackendAISystem | null;
  runnerStatus: string;
  runnerError: string | null;
  onRun: () => void;
}) {
  return (
    <section className="rounded-xl border border-brand-200 bg-white p-4 shadow-card dark:border-brand-900/60 dark:bg-slate-900">
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Run controls</p>
      <button
        onClick={onRun}
        disabled={!selectedSystem || runnerStatus === "running"}
        className={clsx(
          "mt-3 flex w-full items-center justify-center gap-2 rounded bg-brand-600 px-3 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-700",
        )}
      >
        {runnerStatus === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        {runnerStatus === "running" ? "Running pipeline" : "Run governance pipeline"}
      </button>
      {runnerError && <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">{runnerError}</p>}
    </section>
  );
}

function QuickStatus({
  backendLoading,
  run,
  agents,
  findings,
  verdict,
}: {
  backendLoading: boolean;
  run: ReturnType<typeof useGovernanceBackend>["latestRun"] | null;
  agents: AgentExecution[];
  findings: BackendFinding[];
  verdict: ReturnType<typeof useGovernanceBackend>["report"] extends infer R ? R extends { verdict?: infer V } ? V : never : never;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Quick run status</p>
        {backendLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
      </div>
      <div className="mt-3 space-y-2 text-[12px]">
        <StatusRow label="Run" value={run ? shortId(run.id) : "No run for selected system"} mono />
        <StatusRow label="Status" value={run ? titleCase(run.status) : "-"} />
        <StatusRow label="Agents" value={agents.length ? `${agents.filter((a) => a.status === "completed").length}/${agents.length} complete` : "Not run"} />
        <StatusRow label="Findings" value={String(findings.length)} />
        <StatusRow label="Verdict" value={verdict ? `${Math.round(verdict.confidence_score * 100)}% ${titleCase(verdict.label)}` : "Pending"} />
      </div>
    </section>
  );
}

function LayerCard({
  layer,
  status,
  summary,
  isLast,
  actionDisabled,
  actionRunning,
  onAction,
  onDetails,
}: {
  layer: LayerDefinition;
  status: LayerStatus;
  summary: string;
  isLast: boolean;
  actionDisabled: boolean;
  actionRunning: boolean;
  onAction: () => void;
  onDetails: () => void;
}) {
  const Icon = layer.icon;
  return (
    <div className="relative flex gap-3">
      <div className="flex flex-col items-center">
        <div className={clsx("flex h-10 w-10 items-center justify-center rounded-lg border shadow-sm", layerIconTone(status))}>
          {status === "complete" ? <CheckCircle2 className="h-5 w-5" /> : status === "running" ? <Loader2 className="h-5 w-5 animate-spin text-blue-600" /> : <Icon className="h-5 w-5" />}
        </div>
        {!isLast && <div className="my-1 w-px flex-1 bg-slate-200 dark:bg-slate-700" />}
      </div>
      <section className={clsx("mb-1 flex-1 rounded-xl border border-l-4 border-slate-200 bg-white p-4 shadow-card transition-all hover:-translate-y-0.5 hover:border-brand-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-brand-700", layerAccent(status))}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-slate-400">{layer.n}</span>
              <h2 className="font-display text-[16px] text-ink dark:text-white">{layer.name}</h2>
              <span className={clsx("rounded border px-2 py-0.5 text-[10px] font-semibold", layerStatusTone(status))}>{statusLabel(status)}</span>
            </div>
            <p className="mt-1 text-[12px] text-slate-600 dark:text-slate-400">{summary}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={onAction}
              disabled={actionDisabled}
              className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
            >
              {actionRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : layer.id === "agents" ? <Play className="h-3.5 w-3.5" /> : layer.id === "council" ? <Scale className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {layer.actionLabel}
            </button>
            <button onClick={onDetails} className="inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-[12px] font-semibold text-brand-700 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-950/30">
              View Details <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function RightColumn({
  loading,
  onRefresh,
  stateEntries,
  evidence,
  isMockMetrics,
  findings,
  verdict,
  ledger,
}: {
  loading: boolean;
  onRefresh: () => void;
  stateEntries: ReturnType<typeof useGovernanceBackend>["stateEntries"];
  evidence: EvidenceRecord[];
  isMockMetrics: boolean;
  findings: BackendFinding[];
  verdict: ReturnType<typeof useGovernanceBackend>["report"] extends infer R ? R extends { verdict?: infer V } ? V : never : never;
  ledger: ReturnType<typeof useGovernanceBackend>["ledgerEntries"];
}) {
  return (
    <>
      <FeedCard title="Live run trace" icon={Database} loading={loading} onRefresh={onRefresh}>
        {stateEntries.length ? stateEntries.slice(-5).reverse().map((entry) => (
          <FeedItem key={entry.id} title={`${entry.sequence_number}. ${titleCase(entry.entry_type)}`} detail={`${titleCase(entry.phase)} / ${entry.source}`} />
        )) : <EmptyFeed>No trace entries yet.</EmptyFeed>}
      </FeedCard>
      <FeedCard title="Latest evidence" icon={FileSearch}>
        {isMockMetrics && evidence.length > 0 && (
          <div className="mb-2 rounded border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[10px] font-medium leading-4 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            Mock / dev metrics — simulated by the mock evaluator (tools not run). Tool names shown are the intended tools, not real executions.
          </div>
        )}
        {evidence.length ? evidence.slice(-4).reverse().map((item) => (
          <FeedItem key={item.id} title={item.source_name} detail={`${item.source_type} / ${item.normalized_score ?? item.raw_score ?? "score pending"}`} />
        )) : <EmptyFeed>No evidence produced yet.</EmptyFeed>}
      </FeedCard>
      <FeedCard title="Latest findings" icon={AlertTriangle}>
        {findings.length ? findings.slice(-4).reverse().map((finding) => (
          <FeedItem key={finding.id} title={finding.title} detail={`${titleCase(finding.severity)} / ${Math.round(finding.confidence * 100)}% confidence`} />
        )) : <EmptyFeed>No findings created yet.</EmptyFeed>}
      </FeedCard>
      <FeedCard title="Latest council update" icon={Scale}>
        {verdict ? (
          <FeedItem title={`${Math.round(verdict.confidence_score * 100)}% ${titleCase(verdict.label)}`} detail={verdict.reasoning ?? titleCase(verdict.action_tier)} />
        ) : (
          <EmptyFeed>Council has not produced a verdict yet.</EmptyFeed>
        )}
      </FeedCard>
      <FeedCard title="Latest ledger events" icon={BookOpen}>
        {ledger.length ? ledger.slice(-4).reverse().map((entry) => (
          <FeedItem key={entry.id} title={titleCase(entry.event_type)} detail={`${entry.actor_id ?? entry.actor_type} / ${shortId(entry.entry_hash)}`} />
        )) : <EmptyFeed>No ledger events yet.</EmptyFeed>}
      </FeedCard>
    </>
  );
}

/** Surfaces the three real backend context-assembly components — log analyzer,
 *  regulatory ingester, and coverage-gap detector — from the `context_assembled`
 *  governance-state entry. Shows "Not run yet" when the entry is absent. */
function ContextAssemblyBreakdown({ stateEntries }: { stateEntries: ReturnType<typeof useGovernanceBackend>["stateEntries"] }) {
  const entry = stateEntries.find((e) => e.entry_type === "context_assembled");
  if (!entry) {
    return (
      <EmptyFeed>
        Not run yet — context assembly (log analyzer, regulatory ingester, coverage-gap detector) runs when the pipeline is executed with request logs. Run the governance pipeline to populate it.
      </EmptyFeed>
    );
  }
  const payload = (entry.payload ?? {}) as Record<string, unknown>;
  const log = (payload.log_analysis ?? {}) as Record<string, unknown>;
  const reg = (payload.regulatory_context ?? {}) as Record<string, unknown>;
  const gaps = Array.isArray(payload.coverage_gaps) ? (payload.coverage_gaps as Record<string, unknown>[]) : [];
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  const list = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).map(String) : []);

  return (
    <div className="space-y-3">
      {/* Log Analyzer */}
      <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <p className="text-[12px] font-semibold text-slate-900 dark:text-white">Log Analyzer</p>
        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">Scans supplied request logs for volume, PII, and observed categories, demographics, jurisdictions, and outcomes.</p>
        {log.empty === true || num(log.total_requests) === 0 ? (
          <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">No request logs supplied for this run.</p>
        ) : (
          <div className="mt-2">
            <BulletList items={[
              `Total requests analyzed: ${num(log.total_requests)}`,
              `PII requests: ${num(log.pii_request_count)} / flagged: ${num(log.flagged_request_count)}`,
              `Distinct categories: ${num(log.distinct_request_categories)} / demographics: ${num(log.distinct_demographic_groups)}`,
              `Distinct jurisdictions: ${num(log.distinct_jurisdictions)} / outcomes: ${num(log.distinct_outcomes)}`,
            ]} />
            {list(log.observed_request_categories).length > 0 && <div className="mt-2"><PillList values={list(log.observed_request_categories)} /></div>}
          </div>
        )}
      </div>

      {/* Regulatory Ingester */}
      <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <p className="text-[12px] font-semibold text-slate-900 dark:text-white">Regulatory Ingester</p>
        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">Resolves the selected frameworks into concrete controls and probe templates.</p>
        <div className="mt-2">
          <BulletList items={[
            `Controls resolved: ${num(reg.control_count)}`,
            `Frameworks resolved: ${list(reg.resolved_frameworks).length}${list(reg.missing_frameworks).length ? ` / missing: ${list(reg.missing_frameworks).length}` : ""}`,
          ]} />
          {list(reg.resolved_frameworks).length > 0 && <div className="mt-2"><PillList values={list(reg.resolved_frameworks)} /></div>}
          {list(reg.missing_frameworks).length > 0 && (
            <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">Missing framework definitions: {list(reg.missing_frameworks).join(", ")}</p>
          )}
        </div>
      </div>

      {/* Coverage-Gap Detector */}
      <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <p className="text-[12px] font-semibold text-slate-900 dark:text-white">Coverage-Gap Detector</p>
        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">Compares what the logs show against what the frameworks require, flagging uncovered risk areas.</p>
        {gaps.length === 0 ? (
          <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">No coverage gaps detected.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {gaps.map((gap, i) => (
              <div key={typeof gap.gap_id === "string" ? gap.gap_id : i} className="rounded border border-slate-200 px-2.5 py-2 dark:border-slate-700">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-200">{String(gap.category ?? "Gap")} · {String(gap.dimension ?? "")}</p>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">{String(gap.severity ?? "")}</span>
                </div>
                {typeof gap.description === "string" && <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-400">{gap.description}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function WorkspaceDrawer({
  target,
  selectedSystem,
  report,
  stateEntries,
  ledgerEntries,
  onClose,
  onAgent,
}: {
  target: DrawerTarget | null;
  selectedSystem: BackendAISystem | null;
  report: ReturnType<typeof useGovernanceBackend>["report"];
  stateEntries: ReturnType<typeof useGovernanceBackend>["stateEntries"];
  ledgerEntries: ReturnType<typeof useGovernanceBackend>["ledgerEntries"];
  onClose: () => void;
  onAgent: (agent: AgentExecution) => void;
}) {
  if (!target) return null;
  if (target.kind === "agent") {
    return <AgentDrawer agent={target.agent} selectedSystem={selectedSystem} report={report} stateEntries={stateEntries} ledgerEntries={ledgerEntries} onClose={onClose} />;
  }
  const layer = target.layer;
  const relatedFindings = report?.findings ?? [];
  const relatedEvidence = report?.evidence ?? [];
  return (
    <DetailDrawer open onClose={onClose} eyebrow={`Layer ${layer.n}`} title={layer.name}>
      <DrawerSection title="Purpose" icon={layer.icon}>
        <p className="text-[12px] leading-5 text-slate-600 dark:text-slate-300">{layer.purpose}</p>
      </DrawerSection>
      <DrawerSection title="Inputs used" icon={ArrowRight}>
        <BulletList items={layerInputs(layer, selectedSystem, report)} />
      </DrawerSection>
      <DrawerSection title="Outputs generated" icon={CheckCircle2}>
        <BulletList items={layerOutputs(layer, report)} />
      </DrawerSection>
      {layer.id === "context" && (
        <DrawerSection title="Backend context assembly" icon={Layers}>
          <ContextAssemblyBreakdown stateEntries={stateEntries} />
        </DrawerSection>
      )}
      <DrawerSection title="Related APIs / tables" icon={Database}>
        <PillList values={[...layer.apis, ...layer.tables]} />
      </DrawerSection>
      {layer.id === "agents" && (
        <DrawerSection title="Backend specialist agents" icon={Bot}>
          {report?.agent_executions.length ? (
            <div className="space-y-2">
              {report.agent_executions.map((agent) => (
                <button key={agent.id} onClick={() => onAgent(agent)} className="flex w-full items-center justify-between gap-3 rounded border border-slate-200 px-3 py-2 text-left hover:border-brand-300 dark:border-slate-700">
                  <div>
                    <p className="text-[12px] font-semibold text-slate-900 dark:text-white">{agentLabel(agent.agent_name)}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">{agentDescription(agent.agent_name, selectedSystem)}</p>
                  </div>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{titleCase(agent.status)}</span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyFeed>Agent has not run yet.</EmptyFeed>
          )}
        </DrawerSection>
      )}
      {layer.id === "council" && (
        <>
          <DrawerSection title="Council deliberation" icon={Scale}>
            {report?.verdict ? <p className="text-[12px] leading-5 text-slate-600 dark:text-slate-300">{report.verdict.reasoning ?? report.verdict.synthesis ?? "Council verdict is available."}</p> : <EmptyFeed>Council has not produced a verdict yet.</EmptyFeed>}
          </DrawerSection>
          <DrawerSection title="What each agent contributed" icon={Bot}>
            {report?.agent_executions.length ? (
              <div className="space-y-2">
                {report.agent_executions.map((agent) => {
                  const agentFindings = (report.findings ?? []).filter((f) => f.agent_name === agent.agent_name);
                  return (
                    <div key={agent.id} className="rounded border border-slate-200 px-3 py-2 dark:border-slate-700">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[12px] font-semibold text-slate-900 dark:text-white">{agentLabel(agent.agent_name)}</p>
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {titleCase(agent.status)} · {agentFindings.length} finding{agentFindings.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      {agentFindings.length ? (
                        <div className="mt-1.5 space-y-1">
                          {agentFindings.map((f) => (
                            <FeedItem key={f.id} title={f.title} detail={`${titleCase(f.severity)} · ${Math.round(f.confidence * 100)}% confidence`} />
                          ))}
                        </div>
                      ) : (
                        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">No findings raised — clean result for this application.</p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyFeed>Agents have not run yet for this application.</EmptyFeed>
            )}
          </DrawerSection>
        </>
      )}
      <DrawerSection title="Related evidence / findings" icon={FileSearch}>
        <p className="text-[12px] text-slate-600 dark:text-slate-300">{relatedEvidence.length} evidence records / {relatedFindings.length} findings for this run.</p>
      </DrawerSection>
      <DrawerSection title="Troubleshooting" icon={AlertTriangle}>
        <BulletList items={layer.troubleshooting} />
      </DrawerSection>
    </DetailDrawer>
  );
}

function AgentDrawer({
  agent,
  selectedSystem,
  report,
  stateEntries,
  ledgerEntries,
  onClose,
}: {
  agent: AgentExecution;
  selectedSystem: BackendAISystem | null;
  report: ReturnType<typeof useGovernanceBackend>["report"];
  stateEntries: ReturnType<typeof useGovernanceBackend>["stateEntries"];
  ledgerEntries: ReturnType<typeof useGovernanceBackend>["ledgerEntries"];
  onClose: () => void;
}) {
  const findings = (report?.findings ?? []).filter((finding) => finding.agent_name === agent.agent_name);
  const metricIds = new Set((report?.metric_plan?.metrics ?? []).filter((metric) => metric.primary_agent === agent.agent_name).map((metric) => metric.metric_id));
  const metricResults = (report?.metric_results ?? []).filter((result) => metricIds.has(result.metric_id));
  const evidenceIds = new Set([...findings.flatMap((finding) => finding.evidence_ids), ...metricResults.flatMap((result) => result.evidence_ids)]);
  const evidence = (report?.evidence ?? []).filter((item) => evidenceIds.has(item.id) || includesAgent(item.payload, agent.agent_name) || includesAgent(item.source_name, agent.agent_name));
  const trace = ledgerEntries.filter((entry) => includesAgent(entry.actor_id, agent.agent_name) || includesAgent(entry.payload, agent.agent_name));
  const state = stateEntries.filter((entry) => includesAgent(entry.source, agent.agent_name) || includesAgent(entry.payload, agent.agent_name));

  return (
    <DetailDrawer open onClose={onClose} eyebrow="Specialist Agent" title={agentLabel(agent.agent_name)}>
      <DrawerSection title="Purpose for selected application" icon={Bot}>
        <p className="text-[12px] leading-5 text-slate-600 dark:text-slate-300">{agentDescription(agent.agent_name, selectedSystem)}</p>
      </DrawerSection>
      <DrawerSection title="Inputs used" icon={ArrowRight}>
        <BulletList items={[
          selectedSystem ? `Selected system: ${selectedSystem.name}` : "No selected system",
          `Frameworks: ${report?.run.selected_frameworks.join(", ") || "none recorded"}`,
          `Metrics read: ${metricIds.size}`,
          `Evidence read: ${evidence.length}`,
        ]} />
      </DrawerSection>
      <DrawerSection title="Outputs generated" icon={CheckCircle2}>
        <BulletList items={[`Status: ${titleCase(agent.status)}`, `Findings created: ${findings.length}`, `Evidence created: ${evidence.length}`, `Recorded finding count: ${agent.finding_count}`]} />
      </DrawerSection>
      <DrawerSection title="Related APIs / tables" icon={Database}>
        <PillList values={["GET /evaluation-runs/{id}/agents/executions", "GET /evaluation-runs/{id}/findings", "agent_executions", "findings", "evidence_records"]} />
      </DrawerSection>
      <DrawerSection title="Related evidence / findings" icon={FileSearch}>
        {findings.length || evidence.length ? (
          <div className="space-y-2">
            {findings.map((finding) => <FeedItem key={finding.id} title={finding.title} detail={`${titleCase(finding.severity)} / ${Math.round(finding.confidence * 100)}% confidence`} />)}
            {evidence.slice(0, 4).map((item) => <FeedItem key={item.id} title={item.source_name} detail={`${item.source_type} / ${shortId(item.id)}`} />)}
          </div>
        ) : (
          <EmptyFeed>No evidence produced yet.</EmptyFeed>
        )}
      </DrawerSection>
      <DrawerSection title="Trace / state" icon={BookOpen}>
        {trace.length || state.length ? (
          <div className="space-y-2">
            {state.slice(-4).reverse().map((entry) => <FeedItem key={entry.id} title={titleCase(entry.entry_type)} detail={`${titleCase(entry.phase)} / ${entry.source}`} />)}
            {trace.slice(-4).reverse().map((entry) => <FeedItem key={entry.id} title={titleCase(entry.event_type)} detail={entry.actor_id ?? entry.actor_type} />)}
          </div>
        ) : (
          <EmptyFeed>No trace entries recorded for this agent yet.</EmptyFeed>
        )}
      </DrawerSection>
      <DrawerSection title="Troubleshooting" icon={AlertTriangle}>
        <BulletList items={agent.status === "failed" ? ["Review agent error summary.", "Check target capability availability.", "Confirm real tool backend connectivity."] : ["Agent has not run yet if no outputs are listed.", "No findings can mean no issue was detected.", "Use trace entries to confirm backend execution."]} />
      </DrawerSection>
    </DetailDrawer>
  );
}

function layerInputs(layer: LayerDefinition, selectedSystem: BackendAISystem | null, report: ReturnType<typeof useGovernanceBackend>["report"]): string[] {
  const base = selectedSystem ? [`Selected AI system: ${selectedSystem.name}`] : ["No AI system selected"];
  if (layer.id === "context") return [...base, `Frameworks: ${selectedSystem?.selected_frameworks.join(", ") || "none"}`, `Capabilities: ${report?.capabilities.length ?? 0}`];
  if (layer.id === "planning") return [...base, `Risk tier: ${selectedSystem ? titleCase(selectedSystem.risk_tier) : "-"}`, `Frameworks: ${report?.run.selected_frameworks.join(", ") || selectedSystem?.selected_frameworks.join(", ") || "none"}`];
  if (layer.id === "agents") return [...base, `Metrics: ${report?.metric_plan?.metrics.length ?? 0}`, `Capabilities: ${report?.capabilities.length ?? 0}`, `Context profile: ${report?.context_profile ? "available" : "missing"}`];
  if (layer.id === "council") return [...base, `Findings: ${report?.findings.length ?? 0}`, `Metric results: ${report?.metric_results.length ?? 0}`];
  if (layer.id === "verdict") return [...base, `Council verdict: ${report?.verdict ? "available" : "pending"}`];
  return [...base, `Evidence: ${report?.evidence.length ?? 0}`, `Findings: ${report?.findings.length ?? 0}`, `Verdict: ${report?.verdict ? "available" : "pending"}`];
}

function layerOutputs(layer: LayerDefinition, report: ReturnType<typeof useGovernanceBackend>["report"]): string[] {
  if (layer.id === "context") return [`Context profile: ${report?.context_profile ? "assembled" : "not assembled"}`, `Capabilities loaded: ${report?.capabilities.length ?? 0}`];
  if (layer.id === "planning") return [`Metrics planned: ${report?.metric_plan?.metrics.length ?? 0}`];
  if (layer.id === "agents") return [`Agents run: ${report?.agent_executions.length ?? 0}`, `Evidence produced: ${report?.evidence.length ?? 0}`, `Findings created: ${report?.findings.length ?? 0}`];
  if (layer.id === "council") return [`Verdict: ${report?.verdict ? "available" : "pending"}`, `Objections: ${report?.verdict?.objections.length ?? 0}`];
  if (layer.id === "verdict") return [`Confidence: ${report?.verdict ? `${Math.round(report.verdict.confidence_score * 100)}%` : "pending"}`, `Action tier: ${report?.verdict ? titleCase(report.verdict.action_tier) : "pending"}`];
  return [`Evidence records: ${report?.evidence.length ?? 0}`, `Findings: ${report?.findings.length ?? 0}`];
}

function agentDescription(agentName: string, selectedSystem: BackendAISystem | null): string {
  const base = AGENT_DESCRIPTIONS[agentName] ?? "Runs backend specialist checks for this selected application.";
  return selectedSystem ? `${base} Application: ${selectedSystem.name}.` : base;
}

function StatusRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className={clsx("text-right font-medium text-slate-900 dark:text-white", mono && "font-mono")}>{value}</span>
    </div>
  );
}

function FeedCard({ title, icon: Icon, children, loading = false, onRefresh }: { title: string; icon: LucideIcon; children: ReactNode; loading?: boolean; onRefresh?: () => void }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-400">
            <Icon className="h-3.5 w-3.5" />
          </span>
          <p className="font-display text-[14px] text-ink dark:text-white">{title}</p>
        </div>
        {onRefresh && (
          <button onClick={onRefresh} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
            <RefreshCw className={clsx("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
        )}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function FeedItem({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 transition-colors hover:border-brand-200 hover:bg-brand-50/40 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:border-brand-800 dark:hover:bg-brand-950/20">
      <p className="text-[12px] font-semibold text-slate-900 dark:text-white">{title}</p>
      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{detail}</p>
    </div>
  );
}

function DrawerSection({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <section className="mt-5">
      <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
        <Icon className="h-3.5 w-3.5" /> {title}
      </p>
      {children}
    </section>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <div className="space-y-1.5">
      {items.map((item) => (
        <div key={item} className="flex items-start gap-2 text-[12px] leading-5 text-slate-700 dark:text-slate-300">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}

function PillList({ values }: { values: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((value) => <Pill key={value}>{value}</Pill>)}
    </div>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">{children}</span>;
}

function EmptyFeed({ children }: { children: ReactNode }) {
  return <div className="rounded border border-dashed border-slate-300 px-3 py-5 text-center text-[12px] text-slate-500 dark:border-slate-700 dark:text-slate-400">{children}</div>;
}
