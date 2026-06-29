import type { ReactNode } from "react";
import clsx from "clsx";

// Shared form-control vocabulary for guided flows (Context Profile, Run Creation).
// One consistent control set so every screen reads the same.

export const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1 text-[12px] font-semibold text-ink-2">
        {label}
        {required && <span className="text-brand-600">*</span>}
      </label>
      {hint && <p className="text-[11px] leading-4 text-ink-4">{hint}</p>}
      {children}
      {error && <p className="text-[11px] font-medium text-red-600">{error}</p>}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  invalid,
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  invalid?: boolean;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={clsx(inputClass, invalid && "border-red-400 focus:border-red-500 focus:ring-red-100")}
    />
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className={clsx(inputClass, "resize-none")}
    />
  );
}

export function SelectInput({
  value,
  onChange,
  options,
  placeholder = "Select…",
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[] | { value: string; label: string }[];
  placeholder?: string;
  invalid?: boolean;
}) {
  const normalized = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={clsx(inputClass, !value && "text-slate-400", invalid && "border-red-400 focus:border-red-500 focus:ring-red-100")}
    >
      <option value="">{placeholder}</option>
      {normalized.map((o) => (
        <option key={o.value} value={o.value} className="text-slate-900">
          {o.label}
        </option>
      ))}
    </select>
  );
}

// Multi- or single-select chip group. Used for frameworks, jurisdictions, filters, tools.
export function ChipSelect({
  options,
  selected,
  onToggle,
  multiple = true,
  descriptions,
}: {
  options: readonly string[];
  selected: string[];
  onToggle: (value: string) => void;
  multiple?: boolean;
  descriptions?: Record<string, string>;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = selected.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            role={multiple ? "checkbox" : "radio"}
            aria-checked={active}
            title={descriptions?.[opt]}
            onClick={() => onToggle(opt)}
            className={clsx(
              "rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors",
              active
                ? "border-brand-500 bg-brand-50 text-brand-800"
                : "border-slate-200 bg-white text-slate-700 hover:border-slate-400 hover:text-slate-950"
            )}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-left transition-colors hover:border-slate-300"
    >
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink-2">{label}</span>
        {description && <span className="mt-0.5 block text-[11px] leading-4 text-ink-4">{description}</span>}
      </span>
      <span
        className={clsx(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-brand-600" : "bg-slate-300"
        )}
      >
        <span
          className={clsx(
            "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-4" : "translate-x-0.5"
          )}
        />
      </span>
    </button>
  );
}
