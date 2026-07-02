import { useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  Loader2,
  Lock,
  XCircle,
} from "lucide-react";
import clsx from "clsx";
import { executionLayers, type ExecutionLayer, type LayerStatus } from "@/data/executionLayerData";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { phaseIndex } from "@/hooks/useRunProgress";

// executionLayers[i] (layer-1..7) lines up positionally with these real run phases.
const LAYER_PHASES = [
  "context_assembly",
  "adaptive_orchestrator",
  "specialist_agents",
  "metric_execution",
  "deliberation_council",
  "action_reporting",
  "action_reporting",
] as const;

/** Derives each layer's displayed status from the real run instead of trusting static mock data. */
function liveLayerStatus(index: number, currentPhase: string | undefined, runStatus: string | undefined): LayerStatus {
  if (!currentPhase || !runStatus || runStatus === "created") return "Waiting";
  const currentIdx = phaseIndex(currentPhase);
  const layerIdx = phaseIndex(LAYER_PHASES[index]);
  if (runStatus === "failed" && layerIdx === currentIdx) return "Failed";
  if (layerIdx < currentIdx || runStatus === "completed") return "Complete";
  if (layerIdx === currentIdx) return "Running";
  return "Waiting";
}

const statusConfig: Record<LayerStatus, { icon: typeof CheckCircle2; color: string; bg: string; badgeTone: "green" | "amber" | "violet" | "blue" | "red" }> = {
  Complete: { icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200", badgeTone: "green" },
  Running: { icon: Loader2, color: "text-blue-600", bg: "bg-blue-50 border-blue-300", badgeTone: "amber" },
  Waiting: { icon: Clock, color: "text-slate-400", bg: "bg-slate-50 border-slate-200", badgeTone: "violet" },
  Pending: { icon: Circle, color: "text-amber-500", bg: "bg-amber-50 border-amber-200", badgeTone: "blue" },
  Blocked: { icon: Lock, color: "text-red-500", bg: "bg-red-50 border-red-200", badgeTone: "red" },
  Failed: { icon: XCircle, color: "text-red-600", bg: "bg-red-50 border-red-300", badgeTone: "red" },
};

export function ExecutionLayerTrace({ currentPhase, runStatus }: { currentPhase?: string; runStatus?: string }) {
  const [expandedLayer, setExpandedLayer] = useState<string | null>(null);
  const hasActiveRun = !!currentPhase && !!runStatus && runStatus !== "created";

  return (
    <Card>
      <CardHeader
        title="Execution Layer Trace"
        eyebrow="Governance Runtime — 7 Layers"
        action={
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> Complete
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" /> Running
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <span className="h-2 w-2 rounded-full bg-slate-300" /> Waiting
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <span className="h-2 w-2 rounded-full bg-amber-400" /> Pending
            </span>
          </div>
        }
      />

      {/* Progress bar */}
      <div className="px-4 py-3 border-b border-slate-100">
        <div className="flex gap-1">
          {executionLayers.map((layer, index) => {
            const status = liveLayerStatus(index, currentPhase, runStatus);
            return (
              <div
                key={layer.id}
                className={clsx(
                  "flex-1 h-2 rounded-full transition-all",
                  status === "Complete" && "bg-emerald-500",
                  status === "Running" && "bg-blue-500 animate-pulse",
                  status === "Waiting" && "bg-slate-200",
                  status === "Pending" && "bg-amber-300",
                  status === "Blocked" && "bg-red-400",
                  status === "Failed" && "bg-red-600",
                )}
                title={`${layer.name}: ${status}`}
              />
            );
          })}
        </div>
        <div className="flex justify-between mt-1.5">
          <span className="text-[10px] text-slate-400">Layer 1</span>
          <span className="text-[10px] text-slate-400">Layer 7</span>
        </div>
      </div>

      {!hasActiveRun && (
        <p className="px-4 py-2.5 text-[11.5px] text-slate-400 border-b border-slate-100 bg-slate-50/60">
          No governance run in progress — layers will populate once a run starts.
        </p>
      )}

      {/* Layer list */}
      <div className="divide-y divide-slate-100">
        {executionLayers.map((layer, index) => (
          <LayerRow
            key={layer.id}
            layer={layer}
            status={liveLayerStatus(index, currentPhase, runStatus)}
            expanded={expandedLayer === layer.id}
            onToggle={() => setExpandedLayer(expandedLayer === layer.id ? null : layer.id)}
          />
        ))}
      </div>
    </Card>
  );
}

function LayerRow({ layer, status, expanded, onToggle }: { layer: ExecutionLayer; status: LayerStatus; expanded: boolean; onToggle: () => void }) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <div>
      <button
        onClick={onToggle}
        className={clsx(
          "flex w-full items-center gap-3 px-4 py-3 text-left transition-all hover:bg-slate-50",
          status === "Running" && "bg-blue-50/30",
        )}
      >
        <div className={clsx("flex h-8 w-8 items-center justify-center rounded-full border", config.bg)}>
          <Icon className={clsx("h-4 w-4", config.color, status === "Running" && "animate-spin")} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-slate-400">{layer.number}.</span>
            <p className="text-[13px] font-semibold text-slate-950 truncate">{layer.name}</p>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5 truncate">{layer.description}</p>
        </div>

        <div className="flex items-center gap-3">
          {status !== "Waiting" && layer.startTime && (
            <span className="text-[11px] font-mono text-slate-400">{layer.startTime}</span>
          )}
          <Badge tone={config.badgeTone}>{status}</Badge>
          {expanded ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Inputs */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 mb-2">Inputs</p>
              <div className="space-y-1.5">
                {layer.inputs.map((input) => (
                  <div key={input} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-slate-400 shrink-0" />
                    <span className="text-[12px] text-slate-700">{input}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Outputs */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 mb-2">Outputs</p>
              <div className="space-y-1.5">
                {layer.outputs.map((output) => (
                  <div key={output} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                    <span className="text-[12px] font-mono text-slate-800">{output}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Agents (if applicable) */}
          {layer.agents && (
            <div className="mt-4 pt-3 border-t border-slate-200">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 mb-2">Active Agents</p>
              <div className="flex flex-wrap gap-2">
                {layer.agents.map((agent) => (
                  <span key={agent} className="rounded border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-800">
                    {agent}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Timing */}
          {status !== "Waiting" && layer.startTime && (
            <div className="mt-3 pt-3 border-t border-slate-200 flex gap-4">
              <span className="text-[11px] text-slate-500">Started: <span className="font-mono text-slate-700">{layer.startTime}</span></span>
              {layer.endTime && (
                <span className="text-[11px] text-slate-500">Completed: <span className="font-mono text-slate-700">{layer.endTime}</span></span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
