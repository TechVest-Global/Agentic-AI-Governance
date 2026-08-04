import { useEffect, useState } from "react";
import { Loader2, ScanSearch } from "lucide-react";
import { getEvaluationPlan, type AgentPlanItem, type EvaluationPlanRead } from "@/api/governanceApi";
import { metricBlurb, metricName } from "@/data/metricCatalog";
import { BarRow, DrawerHeader, DrawerNote, DrawerSection, DrawerTable, ReceivesList, StatGrid } from "@/components/execution/DrawerPrimitives";

const AGENT_LABELS: Record<string, string> = {
  bias_agent: "Bias Auditor",
  quality_agent: "Quality Evaluator",
  misuse_agent: "Misuse Detector",
  drift_agent: "Drift Analyst",
  compliance_mapper: "Compliance Mapper",
  risk_scorer: "Risk Scorer",
  explainability_agent: "Explainability Agent",
};

const AGENT_COLORS: Record<string, string> = {
  bias_agent: "#e11d48",
  quality_agent: "#0ea5a4",
  misuse_agent: "#7c3aed",
  drift_agent: "#0284c7",
  compliance_mapper: "#0d9488",
  risk_scorer: "#475569",
  explainability_agent: "#d97706",
};

function agentLabel(name: string): string {
  return AGENT_LABELS[name] ?? name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function agentColor(name: string): string {
  return AGENT_COLORS[name] ?? "#64748b";
}

/** The Adaptive Orchestrator's real probe-budget allocation and per-agent rationale for this run. */
export function AdaptiveOrchestratorPanel({ runId }: { runId: string | null }) {
  const [plan, setPlan] = useState<EvaluationPlanRead | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) { setPlan(null); return; }
    setLoading(true);
    getEvaluationPlan(runId)
      .then((p) => { setPlan(p); setSelectedAgent(p?.activated_agents[0]?.agent_name ?? null); })
      .finally(() => setLoading(false));
  }, [runId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 justify-center text-[12px] text-slate-500 dark:text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading evaluation plan…
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-4 py-8 text-center">
        <ScanSearch className="mx-auto h-6 w-6 text-slate-300 dark:text-slate-600 mb-2" />
        <p className="text-[12.5px] text-slate-500 dark:text-slate-400">
          {runId ? "No evaluation plan recorded for this run yet." : "No active run selected."}
        </p>
      </div>
    );
  }

  const agents = plan.activated_agents;
  const maxBudget = Math.max(...agents.map((a) => a.probe_budget), 1);
  const selected = agents.find((a) => a.agent_name === selectedAgent) ?? agents[0];

  return (
    <div>
      <DrawerSection label="Probe budget allocation">
        <div className="mb-1.5 flex items-baseline justify-between">
          <p className="text-[12px] text-slate-500 dark:text-slate-400">{plan.probe_budget_allocated} of {plan.probe_budget_total} points allocated</p>
        </div>
        <div className="flex flex-col gap-0.5">
          {agents.map((a) => (
            <BarRow
              key={a.agent_name}
              label={agentLabel(a.agent_name)}
              value={`${a.probe_budget}`}
              max={maxBudget}
              color={agentColor(a.agent_name)}
              dotColor={agentColor(a.agent_name)}
            />
          ))}
        </div>
      </DrawerSection>

      <DrawerSection label="Per-agent rationale — click to inspect">
        <div className="flex flex-col gap-1.5">
          {agents.map((a) => {
            const isSelected = a.agent_name === selected.agent_name;
            return (
              <button
                key={a.agent_name}
                onClick={() => setSelectedAgent(a.agent_name)}
                className={`w-full rounded-[10px] border px-3.5 py-2.5 text-left transition-colors ${
                  isSelected
                    ? "border-brand-300 dark:border-brand-700 bg-brand-50/60 dark:bg-brand-950/20"
                    : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: agentColor(a.agent_name) }} />
                  <p className="text-[12.5px] font-semibold text-slate-950 dark:text-white flex-1">{agentLabel(a.agent_name)}</p>
                  <span className="font-mono text-[11px] font-bold text-slate-500 dark:text-slate-400">{a.probe_budget} pts</span>
                </div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-slate-500 dark:text-slate-400">{a.rationale}</p>
              </button>
            );
          })}
        </div>
      </DrawerSection>

      {selected && (
        <AgentAllocationDetail agent={selected} allAgents={agents} maxBudget={maxBudget} />
      )}

      {plan.priority_targets.length > 0 && (
        <DrawerSection label="Priority targets from coverage gaps">
          <DrawerTable
            columns={["Dimension", "Severity", "Reason"]}
            rows={plan.priority_targets.map((t) => [t.dimension, t.severity, t.reason])}
          />
        </DrawerSection>
      )}
    </div>
  );
}

function AgentAllocationDetail({
  agent,
  allAgents,
  maxBudget,
}: {
  agent: AgentPlanItem;
  allAgents: AgentPlanItem[];
  maxBudget: number;
}) {
  const used = allAgents.reduce((s, a) => s + a.probe_budget, 0);
  const ranked = [...allAgents].sort((a, b) => b.probe_budget - a.probe_budget);
  const rank = ranked.findIndex((a) => a.agent_name === agent.agent_name) + 1;
  const top = ranked[0];

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <DrawerHeader
        icon={<span className="text-[15px] font-bold">{agentLabel(agent.agent_name).slice(0, 2).toUpperCase()}</span>}
        iconColor={agentColor(agent.agent_name)}
        title={agentLabel(agent.agent_name)}
        meta={<>Orchestrator decision · {agent.priority} priority</>}
        headline={`${agentLabel(agent.agent_name)} received ${agent.probe_budget} of ${used} probe points — rank #${rank} of ${allAgents.length}.`}
        method="Single-turn, schema-validated allocation — the orchestrator distributes exactly 100 points across activated agents."
      />
      <div className="p-4">
        <DrawerSection label="Receives">
          <ReceivesList
            items={[
              `${agent.target_dimensions.length} target dimension(s): ${agent.target_dimensions.join(", ") || "none"}`,
              `${agent.assigned_metric_ids.length} assigned metric(s) — listed below`,
              `${agent.coverage_gap_ids.length} coverage gap(s) to prioritize`,
              `${agent.target_controls.length} target control(s): ${agent.target_controls.slice(0, 4).join(", ")}${agent.target_controls.length > 4 ? "…" : ""}`,
            ]}
          />
        </DrawerSection>

        {agent.assigned_metric_ids.length > 0 && (
          <DrawerSection label="Assigned metrics">
            <div className="flex flex-wrap gap-1.5">
              {agent.assigned_metric_ids.map((id) => (
                <span
                  key={id}
                  title={metricBlurb(id, metricName(id))}
                  className="inline-flex cursor-help items-center rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1 text-[11px] text-slate-700 dark:text-slate-300"
                >
                  {/* Name leads; the id is provenance, not a label. */}
                  <span className="font-medium">{metricName(id)}</span>
                  {metricName(id) !== id && (
                    <span className="ml-1.5 font-mono text-[10px] text-slate-400 dark:text-slate-500">
                      {id}
                    </span>
                  )}
                </span>
              ))}
            </div>
          </DrawerSection>
        )}

        <DrawerSection label="At a glance">
          <StatGrid
            stats={[
              ["Budget", `${agent.probe_budget} pts`],
              ["Rank", `#${rank} of ${allAgents.length}`],
              ["Share", `${Math.round((agent.probe_budget / used) * 100)}%`],
              ["Vs. top", `${agent.probe_budget - top.probe_budget}`],
            ]}
          />
        </DrawerSection>

        <DrawerSection label="Trade-off — this allocation vs. every other agent">
          <div className="flex flex-col gap-0.5">
            {ranked.map((a) => (
              <BarRow
                key={a.agent_name}
                label={<>{agentLabel(a.agent_name)}{a.agent_name === agent.agent_name && " · this"}</>}
                value={`${a.probe_budget}`}
                max={maxBudget}
                color={a.agent_name === agent.agent_name ? agentColor(a.agent_name) : "#cbd2e0"}
                dotColor={agentColor(a.agent_name)}
              />
            ))}
          </div>
        </DrawerSection>

        <DrawerSection label="Instruction issued to this agent">
          <DrawerNote footer="The agent sees only its own instruction — never the others' — preserving independent, parallel detection.">
            {agent.instructions}
          </DrawerNote>
        </DrawerSection>
      </div>
    </div>
  );
}
