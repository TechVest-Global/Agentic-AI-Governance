import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Lock,
  RefreshCw,
  Server,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import clsx from "clsx";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { MetricCard } from "@/components/ui/MetricCard";
import { useAuthStore } from "@/store/useAuthStore";
import { roleCan } from "@/lib/permissions";
import {
  createAISystem,
  listAISystems,
  type BackendAISystem,
  type BackendAISystemCreate,
} from "@/api/governanceApi";

const inputClass =
  "w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-[13px] text-slate-900 dark:text-white outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:focus:ring-brand-700/40 placeholder:text-slate-400 dark:placeholder:text-slate-500";

const systemTypes = ["chatbot", "rag", "agent", "classifier", "other"] as const;
const riskTiers = ["low", "medium", "high"] as const;
const environments = ["production", "staging", "shadow", "local"] as const;
const providers = ["azure_foundry", "openai", "anthropic", "other"] as const;

// Display label → backend framework id.
const FRAMEWORK_OPTIONS: ReadonlyArray<{ label: string; id: string }> = [
  { label: "EU AI Act", id: "eu_ai_act" },
  { label: "NIST AI RMF", id: "nist_ai_rmf" },
  { label: "ISO 42001", id: "iso_42001" },
  { label: "OWASP LLM Top 10", id: "owasp_llm_top_10" },
  { label: "SR 11-7", id: "sr_11_7" },
  { label: "OECD", id: "oecd" },
];

const FRAMEWORK_LABEL_BY_ID: Record<string, string> = Object.fromEntries(
  FRAMEWORK_OPTIONS.map((f) => [f.id, f.label]),
);

function labelize(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function riskTone(tier: BackendAISystem["risk_tier"]): "red" | "amber" | "green" {
  if (tier === "high") return "red";
  if (tier === "medium") return "amber";
  return "green";
}

function statusTone(status: BackendAISystem["status"]): "green" | "blue" | "slate" {
  if (status === "active") return "green";
  if (status === "registered") return "blue";
  return "slate";
}

type FormState = {
  name: string;
  description: string;
  owner: string;
  system_type: string;
  risk_tier: string;
  deployment_environment: string;
  model_provider: string;
  model_name: string;
  model_version: string;
  target_endpoint_ref: string;
  frameworks: string[];
  metadata_json: string;
};

const emptyForm: FormState = {
  name: "",
  description: "",
  owner: "",
  system_type: "chatbot",
  risk_tier: "medium",
  deployment_environment: "staging",
  model_provider: "azure_foundry",
  model_name: "",
  model_version: "",
  target_endpoint_ref: "",
  frameworks: [],
  metadata_json: "{}",
};

export function AISystemSetup() {
  const role = useAuthStore((s) => s.user?.role);
  const canEdit = roleCan(role, "canEditAISystem");

  const [systems, setSystems] = useState<BackendAISystem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      setSystems(await listAISystems());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Unable to load AI systems.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const high = systems.filter((s) => s.risk_tier === "high").length;
    const active = systems.filter((s) => s.status === "active").length;
    return { total: systems.length, high, active };
  }, [systems]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleFramework(id: string) {
    setForm((prev) => ({
      ...prev,
      frameworks: prev.frameworks.includes(id)
        ? prev.frameworks.filter((f) => f !== id)
        : [...prev.frameworks, id],
    }));
  }

  function validate(): { ok: boolean; metadata: Record<string, unknown> } {
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = "Name is required.";
    if (!form.owner.trim()) errors.owner = "Owner is required.";
    if (!form.risk_tier) errors.risk_tier = "Risk tier is required.";
    if (!form.deployment_environment) errors.deployment_environment = "Environment is required.";

    let metadata: Record<string, unknown> = {};
    const raw = form.metadata_json.trim();
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          errors.metadata_json = "Metadata must be a JSON object.";
        } else {
          metadata = parsed as Record<string, unknown>;
        }
      } catch {
        errors.metadata_json = "Invalid JSON.";
      }
    }

    setFieldErrors(errors);
    return { ok: Object.keys(errors).length === 0, metadata };
  }

  async function handleSubmit() {
    setSubmitError(null);
    setCreatedId(null);
    const { ok, metadata } = validate();
    if (!ok) return;

    const payload: BackendAISystemCreate = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      owner: form.owner.trim(),
      system_type: form.system_type,
      risk_tier: form.risk_tier as BackendAISystemCreate["risk_tier"],
      deployment_environment: form.deployment_environment,
      selected_frameworks: form.frameworks,
      model_provider: form.model_provider,
      model_name: form.model_name.trim() || null,
      model_version: form.model_version.trim() || null,
      target_endpoint_ref: form.target_endpoint_ref.trim() || null,
      metadata_json: metadata,
    };

    try {
      setSubmitting(true);
      const created = await createAISystem(payload);
      setCreatedId(created.id);
      setForm(emptyForm);
      setFieldErrors({});
      await load();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to create AI system.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Registered Systems" value={counts.total} icon={Server} compact />
        <MetricCard label="High-Risk Tier" value={counts.high} icon={ShieldAlert} tone="red" compact />
        <MetricCard label="Active Systems" value={counts.active} icon={CheckCircle2} tone="green" compact />
      </div>

      <Card>
        <CardHeader
          eyebrow="Registry"
          title="Create AI System"
          action={
            createdId ? (
              <Badge tone="green">
                <CheckCircle2 className="h-3.5 w-3.5" /> Created {createdId.slice(0, 8)}
              </Badge>
            ) : undefined
          }
        />

        {!canEdit ? (
          <div className="flex items-start gap-3 px-5 py-6">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <p className="text-[13px] leading-5 text-slate-600 dark:text-slate-300">
              You have read-only access. Creating AI systems requires the developer role. You can still
              browse the registered systems below.
            </p>
          </div>
        ) : (
          <div className="space-y-5 px-5 py-5">
            {submitError && (
              <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{submitError}</span>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Name" required error={fieldErrors.name}>
                <input
                  className={inputClass}
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="TechVest RAG Chatbot"
                />
              </Field>
              <Field label="Owner / Team" required error={fieldErrors.owner}>
                <input
                  className={inputClass}
                  value={form.owner}
                  onChange={(e) => set("owner", e.target.value)}
                  placeholder="TechVest Global"
                />
              </Field>
              <Field label="Description" className="md:col-span-2">
                <textarea
                  className={clsx(inputClass, "resize-none")}
                  rows={2}
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                  placeholder="Purpose, data sources, intended use…"
                />
              </Field>
              <Field label="System Type">
                <select className={inputClass} value={form.system_type} onChange={(e) => set("system_type", e.target.value)}>
                  {systemTypes.map((t) => (
                    <option key={t} value={t}>{labelize(t)}</option>
                  ))}
                </select>
              </Field>
              <Field label="Risk Tier" required error={fieldErrors.risk_tier}>
                <select className={inputClass} value={form.risk_tier} onChange={(e) => set("risk_tier", e.target.value)}>
                  {riskTiers.map((t) => (
                    <option key={t} value={t}>{labelize(t)}</option>
                  ))}
                </select>
              </Field>
              <Field label="Deployment Environment" required error={fieldErrors.deployment_environment}>
                <select
                  className={inputClass}
                  value={form.deployment_environment}
                  onChange={(e) => set("deployment_environment", e.target.value)}
                >
                  {environments.map((t) => (
                    <option key={t} value={t}>{labelize(t)}</option>
                  ))}
                </select>
              </Field>
              <Field label="Status">
                <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-[12px] text-slate-500 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-400">
                  Created automatically as <span className="font-medium">registered</span>.
                </p>
              </Field>
            </div>

            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                Applicable Frameworks
              </p>
              <div className="flex flex-wrap gap-2">
                {FRAMEWORK_OPTIONS.map((fw) => {
                  const active = form.frameworks.includes(fw.id);
                  return (
                    <button
                      key={fw.id}
                      type="button"
                      onClick={() => toggleFramework(fw.id)}
                      className={clsx(
                        "rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors",
                        active
                          ? "border-brand-500 bg-brand-50 text-brand-800 dark:border-brand-600 dark:bg-brand-900/40 dark:text-brand-300"
                          : "border-slate-300 bg-white text-slate-700 hover:border-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-500",
                      )}
                    >
                      {fw.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Model Provider">
                <select className={inputClass} value={form.model_provider} onChange={(e) => set("model_provider", e.target.value)}>
                  {providers.map((p) => (
                    <option key={p} value={p}>{labelize(p)}</option>
                  ))}
                </select>
              </Field>
              <Field label="Model Name">
                <input className={inputClass} value={form.model_name} onChange={(e) => set("model_name", e.target.value)} placeholder="gpt-4.1-mini" />
              </Field>
              <Field label="Model Version">
                <input className={inputClass} value={form.model_version} onChange={(e) => set("model_version", e.target.value)} placeholder="v1" />
              </Field>
            </div>

            <Field
              label="Target Endpoint Reference"
              hint="Reference only — never embed credentials/secrets."
            >
              <input
                className={inputClass}
                value={form.target_endpoint_ref}
                onChange={(e) => set("target_endpoint_ref", e.target.value)}
                placeholder="http://localhost:8000/api/chat"
              />
            </Field>

            <Field label="Metadata (JSON)" error={fieldErrors.metadata_json} hint="Optional JSON object stored with the system.">
              <textarea
                className={clsx(inputClass, "resize-none font-mono text-[12px]")}
                rows={4}
                value={form.metadata_json}
                onChange={(e) => set("metadata_json", e.target.value)}
                spellCheck={false}
              />
            </Field>

            <div className="flex justify-end">
              <button
                type="button"
                disabled={submitting}
                onClick={handleSubmit}
                className={clsx(
                  "flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold text-white transition-colors",
                  submitting ? "cursor-not-allowed bg-slate-300 dark:bg-slate-700" : "bg-brand-600 hover:bg-brand-700",
                )}
              >
                <Sparkles className="h-4 w-4" />
                {submitting ? "Creating…" : "Create AI System"}
              </button>
            </div>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <CardHeader
          eyebrow="Inventory"
          title="Existing AI Systems"
          action={
            <button
              type="button"
              onClick={() => void load()}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-[12px] font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <RefreshCw className={clsx("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
            </button>
          }
        />

        {loadError && (
          <div className="mx-5 my-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{loadError}</span>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] border-collapse text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/60">
              <tr className="border-b border-slate-200 dark:border-slate-700">
                {["Name", "Owner", "Type", "Risk", "Environment", "Status", "Frameworks", "Model", "Created"].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-[12px] text-slate-500 dark:text-slate-400">
                    Loading AI systems…
                  </td>
                </tr>
              )}
              {!loading && systems.length === 0 && !loadError && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center">
                    <p className="text-[14px] font-semibold text-slate-900 dark:text-white">No AI systems yet</p>
                    <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
                      {canEdit ? "Use the form above to register your first system." : "Ask a developer to register a system."}
                    </p>
                  </td>
                </tr>
              )}
              {!loading &&
                systems.map((s) => (
                  <Fragment key={s.id}>
                    <tr className="border-b border-slate-100 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-3 py-3">
                        <p className="text-[13px] font-semibold text-slate-900 dark:text-white">{s.name}</p>
                        {s.description && (
                          <p className="mt-0.5 max-w-[260px] truncate text-[11px] text-slate-500 dark:text-slate-400">{s.description}</p>
                        )}
                      </td>
                      <td className="px-3 py-3 text-[12px] text-slate-700 dark:text-slate-300">{s.owner}</td>
                      <td className="px-3 py-3 text-[12px] text-slate-700 dark:text-slate-300">{labelize(s.system_type)}</td>
                      <td className="px-3 py-3"><Badge tone={riskTone(s.risk_tier)}>{labelize(s.risk_tier)}</Badge></td>
                      <td className="px-3 py-3 text-[12px] text-slate-700 dark:text-slate-300">{labelize(s.deployment_environment)}</td>
                      <td className="px-3 py-3"><Badge tone={statusTone(s.status)}>{labelize(s.status)}</Badge></td>
                      <td className="px-3 py-3">
                        <div className="flex max-w-[220px] flex-wrap gap-1">
                          {s.selected_frameworks.length === 0 ? (
                            <span className="text-[11px] text-slate-400 dark:text-slate-500">—</span>
                          ) : (
                            s.selected_frameworks.map((f) => (
                              <span key={f} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                {FRAMEWORK_LABEL_BY_ID[f] ?? labelize(f)}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-[11px] text-slate-700 dark:text-slate-300">
                        <span className="font-medium">{labelize(s.model_provider)}</span>
                        {s.model_name && <span className="text-slate-500 dark:text-slate-400"> · {s.model_name}</span>}
                        {s.model_version && <span className="text-slate-400 dark:text-slate-500"> ({s.model_version})</span>}
                      </td>
                      <td className="px-3 py-3 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                        {new Date(s.created_at).toLocaleString()}
                      </td>
                    </tr>
                  </Fragment>
                ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Field({
  label,
  hint,
  required,
  error,
  className,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={clsx("space-y-1", className)}>
      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {hint && <p className="text-[10px] text-slate-400 dark:text-slate-500">{hint}</p>}
      {children}
      {error && <p className="text-[10px] font-medium text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
