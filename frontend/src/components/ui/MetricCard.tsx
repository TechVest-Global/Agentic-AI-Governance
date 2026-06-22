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
  tone?: "slate" | "blue" | "brand" | "green" | "amber" | "red";
  detail?: string;
  compact?: boolean;
}) {
  const iconColor = {
    slate: "text-slate-300",
    blue: "text-slate-300",
    brand: "text-brand-400",
    green: "text-emerald-400",
    amber: "text-amber-400",
    red: "text-red-400",
  }[tone];

  return (
    <Card className={clsx("transition-shadow hover:shadow-md", compact ? "px-4 py-3" : "px-4 py-3.5")}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">{label}</p>
        <Icon className={clsx("h-4 w-4 shrink-0", iconColor)} />
      </div>
      <p className="mt-1.5 text-3xl font-bold tracking-tight text-slate-900 tabular-nums">{value}</p>
      {detail && <p className="mt-0.5 text-[11px] text-slate-400">{detail}</p>}
    </Card>
  );
}
