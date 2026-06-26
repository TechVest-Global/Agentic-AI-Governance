import clsx from "clsx";

const toneClasses: Record<string, string> = {
  green:   "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400",
  blue:    "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-950/50 dark:text-blue-400",
  amber:   "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-400",
  red:     "border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-950/50 dark:text-red-400",
  violet:  "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-700 dark:bg-violet-950/50 dark:text-violet-400",
  slate:   "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300",
  neutral: "border-slate-200 bg-transparent text-slate-500 dark:border-slate-700 dark:text-slate-500",
};

export function Badge({
  children,
  tone = "slate",
}: {
  children: React.ReactNode;
  tone?: keyof typeof toneClasses;
}) {
  return (
    <span className={clsx(
      "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-medium",
      toneClasses[tone]
    )}>
      {tone !== "neutral" && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function toneForRisk(risk: string) {
  if (risk === "High") return "red";
  if (risk === "Medium") return "amber";
  return "green";
}

export function toneForStatus(status: string) {
  if (["Active", "Complete", "Pass", "Aligned"].includes(status)) return "green";
  if (["Running", "Medium", "Partial", "Partially aligned"].includes(status)) return "amber";
  if (["Blocked", "Failed", "Fail", "Not aligned"].includes(status)) return "red";
  if (["Shadow", "Waiting"].includes(status)) return "violet";
  return "slate";
}
