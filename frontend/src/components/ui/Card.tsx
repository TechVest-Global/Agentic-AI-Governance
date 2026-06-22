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
    <section className={clsx("rounded-xl bg-white shadow-card ring-1 ring-black/[0.03]", className)}>
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
    <div className="flex items-center justify-between border-b border-[#eef0f6] px-5 py-3.5">
      <div>
        {eyebrow && <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-3">{eyebrow}</p>}
        <h2 className="font-display text-[16px] text-ink">{title}</h2>
      </div>
      {action}
    </div>
  );
}
