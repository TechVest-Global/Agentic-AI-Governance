import clsx from "clsx";
import { architectureNodes } from "@/data/executionLayerData";
import { Card, CardHeader } from "@/components/ui/Card";

export function RuntimeArchitecture() {
  return (
    <Card>
      <CardHeader
        title="Runtime Architecture"
        eyebrow="Active execution path — this run"
      />
      <div className="px-4 py-4">
        <div className="flex flex-col gap-0">
          {architectureNodes.map((node, index) => (
            <div key={node.id}>
              {/* Node */}
              <div className={clsx(
                "flex items-center gap-3 rounded-md border px-3 py-2.5 transition-all",
                node.active
                  ? "border-blue-200 bg-blue-50/60"
                  : "border-slate-200 bg-slate-50/60 opacity-60"
              )}>
                {/* Status dot */}
                <div className={clsx(
                  "h-2.5 w-2.5 rounded-full shrink-0",
                  node.active ? "bg-blue-500 animate-pulse" : "bg-slate-300"
                )} />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className={clsx(
                    "text-[12px] font-semibold",
                    node.active ? "text-slate-950" : "text-slate-500"
                  )}>
                    {node.name}
                  </p>
                  <p className="text-[10px] text-slate-500 truncate">{node.description}</p>
                </div>

                {/* Active badge */}
                <span className={clsx(
                  "shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                  node.active
                    ? "bg-blue-100 text-blue-700"
                    : "bg-slate-100 text-slate-400"
                )}>
                  {node.active ? "Active" : "Idle"}
                </span>
              </div>

              {/* Arrow connector */}
              {index < architectureNodes.length - 1 && (
                <div className="flex items-center justify-center py-0.5">
                  <div className={clsx(
                    "w-px h-4",
                    node.active && architectureNodes[index + 1]?.active
                      ? "bg-blue-300"
                      : "bg-slate-200"
                  )} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
