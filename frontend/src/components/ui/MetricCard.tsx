import type { LucideIcon } from "lucide-react";
import clsx from "clsx";
import { Card } from "./Card";

export function MetricCard({
  label,
  value,
  icon: Icon,
  tone = "slate",
  detail,
  compact = false,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone?: "slate" | "blue" | "green" | "amber" | "red";
  detail?: string;
  compact?: boolean;
}) {
  const color = {
    slate: "bg-slate-100 text-slate-700",
    blue: "bg-blue-50 text-blue-700",
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
  }[tone];

  return (
    <Card className={clsx(compact ? "p-3" : "p-4")}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
          <p className={clsx("font-semibold text-slate-950", compact ? "mt-1.5 text-[22px]" : "mt-2 text-2xl")}>{value}</p>
          {detail && <p className="mt-1 text-[11px] text-slate-500">{detail}</p>}
        </div>
        <div className={clsx("flex items-center justify-center rounded-md", compact ? "h-8 w-8" : "h-9 w-9", color)}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </Card>
  );
}
