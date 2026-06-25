import clsx from "clsx";

const toneClasses: Record<string, string> = {
  green: "border-emerald-300 bg-emerald-50 text-emerald-800",
  blue: "border-blue-300 bg-blue-50 text-blue-800",
  amber: "border-amber-300 bg-amber-50 text-amber-800",
  red: "border-red-300 bg-red-50 text-red-800",
  violet: "border-violet-300 bg-violet-50 text-violet-800",
  slate: "border-slate-300 bg-slate-50 text-slate-700",
  // neutral: no fill — for non-semantic labels (frameworks, type, environment)
  neutral: "border-slate-200 bg-transparent text-slate-500",
};

export function Badge({
  children,
  tone = "slate",
}: {
  children: React.ReactNode;
  tone?: keyof typeof toneClasses;
}) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-medium", toneClasses[tone])}>
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
  if (status === "Active" || status === "Complete" || status === "Pass" || status === "Aligned") return "green";
  if (status === "Running" || status === "Medium" || status === "Partial" || status === "Partially aligned") return "amber";
  if (status === "Blocked" || status === "Failed" || status === "Fail" || status === "Not aligned") return "red";
  if (status === "Shadow" || status === "Waiting") return "violet";
  return "slate";
}
