import { phaseIndex } from "@/hooks/useRunProgress";

export const LAYERS = [
  { id: "context_assembly",      label: "Context Assembly",     eventLayer: "Context Assembly" },
  { id: "adaptive_orchestrator", label: "Adaptive Orchestrator", eventLayer: "Orchestrator Planning" },
  { id: "metric_execution",      label: "Metric Execution",     eventLayer: "Orchestrator Planning" },
  { id: "specialist_agents",     label: "Specialist Agents",    eventLayer: "Agent Execution" },
  { id: "deliberation_council",  label: "Deliberation Council", eventLayer: "Council Deliberation" },
  { id: "action_reporting",      label: "Action & Reporting",   eventLayer: "Governance Action" },
];

export const PIPELINE_STEPS = [
  { id: "created", number: "0", label: "Run Setup", eventLayer: null as string | null },
  ...LAYERS.map((layer, i) => ({ id: layer.id, number: String(i + 1), label: layer.label, eventLayer: layer.eventLayer })),
];

/** Layers that actually call a model, so only these get a transcript panel.
 *  Matches the phase the gateway stamps on each captured call — context
 *  assembly and reporting are deterministic and would show a permanent
 *  "no calls" box. */
export const MODEL_CALLING_LAYERS = new Set([
  "adaptive_orchestrator",
  "metric_execution",
  "specialist_agents",
  "deliberation_council",
]);

export const STOPPED_RUN_STATUSES = new Set(["failed", "cancelled", "canceled"]);

export function layerStatus(layerId: string, currentPhase: string, runStatus: string): "done" | "active" | "pending" | "failed" {
  const currentIdx = phaseIndex(currentPhase);
  const layerIdx = phaseIndex(layerId);
  if (STOPPED_RUN_STATUSES.has(runStatus) && layerIdx === currentIdx) return "failed";
  if (layerIdx < currentIdx) return "done";
  if (layerIdx === currentIdx && !STOPPED_RUN_STATUSES.has(runStatus)) return "active";
  return "pending";
}
