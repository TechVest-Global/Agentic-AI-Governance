import type { ReactNode } from "react";
import clsx from "clsx";

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx("rounded-md border border-slate-200 bg-white shadow-sm", className)}>
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  eyebrow,
  action,
}: {
  title: string;
  eyebrow?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
      <div>
        {eyebrow && <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{eyebrow}</p>}
        <h2 className="text-[14px] font-semibold text-slate-950">{title}</h2>
      </div>
      {action}
    </div>
  );
}
