import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Pause, Play, RotateCcw } from "lucide-react";
import clsx from "clsx";
import { useActiveRun } from "@/hooks/useActiveRun";
import { useEvaluationRunner } from "@/hooks/useEvaluationRunner";
import { useIsRunActive } from "@/hooks/useIsRunActive";
import { cancelRun } from "@/api/governanceApi";
import { Card } from "@/components/ui/Card";
import { PIPELINE_STEPS, layerStatus } from "@/pages/pipelineSteps";
import { AgentGlyph, type IntelligenceAgent } from "@/components/execution/AgentDetailCard";

function riskBadgeTone(tier: string): string {
  const t = tier.toLowerCase();
  if (t === "high") return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400";
  if (t === "medium") return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400";
  return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400";
}

export type CouncilMemberId = "synthesis" | "advocate" | "verdict";

export const COUNCIL_MEMBERS: Array<{ id: CouncilMemberId; name: string; color: string }> = [
  { id: "synthesis", name: "Synthesis Agent", color: "#0ea5a4" },
  { id: "advocate", name: "Devil's Advocate", color: "#d97706" },
  { id: "verdict", name: "Verdict Agent", color: "#0d9488" },
];

// The council loop caps at 3 iterations (backend: remediation_router.MAX_ITERATIONS).
const COUNCIL_MAX_ITERATIONS = 3;

export function LiveRunSidebar({
  currentPhase,
  runStatus,
  selectedStep,
  onSelectStep,
  agents,
  selectedAgentId,
  onSelectAgent,
  selectedCouncilMemberId,
  onSelectCouncilMember,
  resultSummary,
}: {
  currentPhase: string;
  runStatus: string;
  selectedStep: string;
  onSelectStep: (id: string) => void;
  agents: IntelligenceAgent[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  selectedCouncilMemberId: CouncilMemberId | null;
  onSelectCouncilMember: (id: CouncilMemberId) => void;
  resultSummary?: Record<string, unknown>;
}) {
  const { systems, runId, setRunId, refresh } = useActiveRun();
  const runner = useEvaluationRunner();
  const { active: isRunning } = useIsRunActive();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [pausing, setPausing] = useState(false);
  // Whether the Specialist Agents / Deliberation Council steps are expanded to show
  // their nested lists. Independent of selectedStep so clicking again can collapse
  // without deselecting.
  const [agentsExpanded, setAgentsExpanded] = useState(false);
  const [councilExpanded, setCouncilExpanded] = useState(false);

  // Auto-expand the nested list whenever a step becomes selected via any path
  // (an explicit click, or the live-phase auto-follow) — the user can still collapse it.
  useEffect(() => {
    if (selectedStep === "specialist_agents") setAgentsExpanded(true);
    if (selectedStep === "deliberation_council") setCouncilExpanded(true);
  }, [selectedStep]);

  const targetSystem = systems.find((s) => s.id === runner.runningSystemId) ?? systems[0] ?? null;
  const [selectedSystemId, setSelectedSystemId] = useState<string | null>(targetSystem?.id ?? null);
  const activeSystem = systems.find((s) => s.id === selectedSystemId) ?? targetSystem;

  const hasStarted = runStatus !== "created";

  async function handleRunAudit() {
    if (!activeSystem) return;
    setSwitcherOpen(false);
    const result = await runner.run(activeSystem, {
      onRunCreated: (run) => setRunId(run.id),
    });
    if (result) refresh();
  }

  async function handlePauseAudit() {
    if (!runId) return;
    setPausing(true);
    await cancelRun(runId).catch(() => {});
    runner.reset();
    setPausing(false);
    refresh();
  }

  async function handleReset() {
    if (runId && isRunning) {
      await cancelRun(runId).catch(() => {});
    }
    runner.reset();
    setRunId(null);
    refresh();
  }

  return (
    <Card className="sticky top-20 self-start overflow-visible">
      {/* Target system switcher */}
      <div className="p-3 border-b border-slate-100 dark:border-slate-700/50">
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500">Target</p>
        <div className="relative">
          <button
            onClick={() => setSwitcherOpen((v) => !v)}
            disabled={systems.length === 0}
            className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-left disabled:opacity-60"
          >
            <span className="truncate text-[13px] font-semibold text-slate-950 dark:text-white">
              {activeSystem ? `${activeSystem.name} ${activeSystem.model_version ?? ""}`.trim() : "No systems registered"}
            </span>
            <ChevronDown className={clsx("h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform", switcherOpen && "rotate-180")} />
          </button>
          {switcherOpen && systems.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg">
              {systems.map((s) => (
                <button
                  key={s.id}
                  onClick={() => { setSelectedSystemId(s.id); setSwitcherOpen(false); }}
                  className={clsx(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-slate-50 dark:hover:bg-slate-800",
                    s.id === activeSystem?.id ? "bg-slate-100 dark:bg-slate-800 font-semibold text-slate-950 dark:text-white" : "text-slate-700 dark:text-slate-300"
                  )}
                >
                  {s.name} {s.model_version ?? ""}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Run controls */}
      <div className="flex gap-2 p-3 border-b border-slate-100 dark:border-slate-700/50">
        {isRunning ? (
          <button
            onClick={handlePauseAudit}
            disabled={pausing}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-[12.5px] font-semibold text-white disabled:opacity-50"
          >
            {pausing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-3.5 w-3.5" />}
            {pausing ? "Pausing…" : "Pause Audit"}
          </button>
        ) : (
          <button
            onClick={handleRunAudit}
            disabled={!activeSystem}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-950 dark:bg-white px-3 py-2 text-[12.5px] font-semibold text-white dark:text-slate-950 disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            Run Audit
          </button>
        )}
        <button
          onClick={handleReset}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-[12.5px] font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </button>
      </div>

      {/* System info card */}
      {activeSystem && (
        <div className="p-3 border-b border-slate-100 dark:border-slate-700/50">
          <p className="text-[13px] font-semibold text-slate-950 dark:text-white">{activeSystem.name}</p>
          <p className="mt-0.5 text-[11.5px] text-slate-500 dark:text-slate-400">
            {(activeSystem.metadata_json?.domain as string) ?? activeSystem.system_type} · {activeSystem.model_version ?? "v1"} · {activeSystem.model_name ?? "model"}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-semibold", riskBadgeTone(activeSystem.risk_tier))}>
              {activeSystem.risk_tier} risk
            </span>
            {activeSystem.selected_frameworks.map((f) => (
              <span key={f} className="rounded-full bg-brand-50 dark:bg-brand-950/40 px-2 py-0.5 text-[10px] font-semibold text-brand-700 dark:text-brand-400">
                {f.replace(/_/g, " ").toUpperCase()}
              </span>
            ))}
            {typeof activeSystem.metadata_json?.daily_active_users === "string" && (
              <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                {activeSystem.metadata_json.daily_active_users}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Pipeline */}
      <div className="p-2">
        <p className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500">Pipeline</p>

        {PIPELINE_STEPS.map((step) => {
          const status = step.id === "created"
            ? (hasStarted ? "done" : "active")
            : layerStatus(step.id, currentPhase, runStatus);
          const isSelected = selectedStep === step.id;
          const isSpecialistAgents = step.id === "specialist_agents";
          const isCouncil = step.id === "deliberation_council";
          const isExpandable = isSpecialistAgents || isCouncil;
          const isExpanded = isSpecialistAgents ? agentsExpanded : councilExpanded;
          const setExpanded = isSpecialistAgents ? setAgentsExpanded : setCouncilExpanded;
          const hasNestedItems = (isSpecialistAgents && agents.length > 0) || isCouncil;
          return (
            <div key={step.id}>
              <button
                onClick={() => {
                  if (isExpandable && isSelected) {
                    // Already the active step — this click toggles the nested list instead.
                    setExpanded((v) => !v);
                  } else {
                    onSelectStep(step.id);
                    if (isExpandable) setExpanded(true);
                  }
                }}
                className={clsx(
                  "flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors",
                  isSelected ? "bg-brand-50 dark:bg-brand-950/30" : "hover:bg-slate-50 dark:hover:bg-slate-800/60"
                )}
              >
                <span className={clsx(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold",
                  status === "done" ? "bg-emerald-500 text-white" :
                  status === "active" ? "bg-blue-600 text-white" :
                  status === "failed" ? "bg-red-500 text-white" :
                  "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
                )}>
                  {status === "done" ? "✓" : step.number}
                </span>
                <span className={clsx(
                  "text-[13px] font-semibold",
                  isSelected ? "text-brand-700 dark:text-brand-400" :
                  status === "pending" ? "text-slate-400 dark:text-slate-500" : "text-slate-950 dark:text-white"
                )}>
                  {step.label}
                </span>
                {isCouncil && status === "active" && (
                  <span className="ml-auto shrink-0 rounded-full bg-blue-100 dark:bg-blue-900/40 px-2 py-0.5 text-[10px] font-bold text-blue-700 dark:text-blue-400">
                    iteration {Math.min(
                      Number(resultSummary?.["_council_iteration_count"] ?? 0) + 1,
                      COUNCIL_MAX_ITERATIONS
                    )}/{COUNCIL_MAX_ITERATIONS}
                  </span>
                )}
                {status === "active" && !isCouncil && <Loader2 className="ml-auto h-3.5 w-3.5 shrink-0 animate-spin text-blue-600" />}
                {isCouncil && status === "active" && <Loader2 className="ml-2 h-3.5 w-3.5 shrink-0 animate-spin text-blue-600" />}
                {hasNestedItems && (
                  isSelected && isExpanded
                    ? <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-slate-400" />
                    : <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-slate-400" />
                )}
              </button>

              {/* Nested specialist agents — shown once this step is selected and expanded */}
              {isSpecialistAgents && isSelected && agentsExpanded && agents.length > 0 && (
                <div className="ml-4 mt-0.5 flex flex-col gap-0.5 border-l border-slate-200 dark:border-slate-700 pl-3">
                  {agents.map((agent) => {
                    const agentSelected = selectedAgentId === agent.id;
                    return (
                      <button
                        key={agent.id}
                        onClick={() => onSelectAgent(agent.id)}
                        className={clsx(
                          "flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                          agentSelected ? "bg-brand-50 dark:bg-brand-950/30" : "hover:bg-slate-50 dark:hover:bg-slate-800/60"
                        )}
                      >
                        <AgentGlyph agent={agent} />
                        <span className={clsx(
                          "truncate text-[12px] font-medium",
                          agentSelected ? "text-brand-700 dark:text-brand-400" : "text-slate-700 dark:text-slate-300"
                        )}>
                          {agent.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Nested council members — shown once this step is selected and expanded */}
              {isCouncil && isSelected && councilExpanded && (
                <div className="ml-4 mt-0.5 flex flex-col gap-0.5 border-l border-slate-200 dark:border-slate-700 pl-3">
                  {COUNCIL_MEMBERS.map((member) => {
                    const memberSelected = selectedCouncilMemberId === member.id;
                    return (
                      <button
                        key={member.id}
                        onClick={() => onSelectCouncilMember(member.id)}
                        className={clsx(
                          "flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                          memberSelected ? "bg-brand-50 dark:bg-brand-950/30" : "hover:bg-slate-50 dark:hover:bg-slate-800/60"
                        )}
                      >
                        <span
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white"
                          style={{ background: member.color }}
                        >
                          {member.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                        </span>
                        <span className={clsx(
                          "truncate text-[12px] font-medium",
                          memberSelected ? "text-brand-700 dark:text-brand-400" : "text-slate-700 dark:text-slate-300"
                        )}>
                          {member.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
