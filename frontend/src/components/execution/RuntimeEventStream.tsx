import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  ChevronDown,
  ChevronUp,
  FileText,
  Info,
  Zap,
} from "lucide-react";
import clsx from "clsx";
import { runtimeEvents, type RuntimeEvent } from "@/data/executionLayerData";
import { Card, CardHeader } from "@/components/ui/Card";

const typeConfig: Record<RuntimeEvent["type"], { icon: typeof Info; color: string; bg: string }> = {
  info: { icon: Info, color: "text-slate-500", bg: "bg-slate-100" },
  finding: { icon: FileText, color: "text-red-600", bg: "bg-red-50" },
  action: { icon: Zap, color: "text-blue-600", bg: "bg-blue-50" },
  warning: { icon: AlertTriangle, color: "text-amber-600", bg: "bg-amber-50" },
  escalation: { icon: Bell, color: "text-purple-600", bg: "bg-purple-50" },
};

export function RuntimeEventStream() {
  const [expanded, setExpanded] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const visibleEvents = showAll ? runtimeEvents : runtimeEvents.slice(0, 8);

  return (
    <Card>
      <CardHeader
        title="Runtime Event Stream"
        eyebrow="Layer-level events — chronological"
        action={
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-[11px] font-medium text-slate-600 hover:text-slate-900"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? "Collapse" : "Expand"}
          </button>
        }
      />

      {expanded && (
        <div className="divide-y divide-slate-50">
          {visibleEvents.map((event) => {
            const config = typeConfig[event.type];
            const Icon = config.icon;

            return (
              <div key={event.id} className="flex items-start gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors">
                <div className={clsx("mt-0.5 flex h-5 w-5 items-center justify-center rounded", config.bg)}>
                  <Icon className={clsx("h-3 w-3", config.color)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] font-medium text-slate-500">{event.timestamp}</span>
                    <ArrowRight className="h-2.5 w-2.5 text-slate-300" />
                    <span className="text-[12px] text-slate-800">{event.message}</span>
                  </div>
                </div>
                <span className="shrink-0 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-500">
                  {event.layer}
                </span>
              </div>
            );
          })}

          {runtimeEvents.length > 8 && (
            <div className="px-4 py-2.5">
              <button
                onClick={() => setShowAll(!showAll)}
                className="text-[11px] font-medium text-blue-700 hover:underline"
              >
                {showAll ? "Show fewer events" : `Show all ${runtimeEvents.length} events`}
              </button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
