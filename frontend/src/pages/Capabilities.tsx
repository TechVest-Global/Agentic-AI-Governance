import { Fragment, useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  DownloadCloud,
  Loader2,
  Lock,
  Plus,
} from "lucide-react";
import clsx from "clsx";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { useAuthStore } from "@/store/useAuthStore";
import { roleCan } from "@/lib/permissions";
import {
  createAISystemCapability,
  importCapabilitiesFromCatalog,
  listAISystems,
  listCapabilities,
  type BackendAISystem,
  type BackendAISystemCapability,
  type BackendAISystemCapabilityCreate,
} from "@/api/governanceApi";

const inputClass =
  "w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-[13px] text-slate-900 dark:text-white outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:focus:ring-brand-700/40 placeholder:text-slate-400 dark:placeholder:text-slate-500";

const capabilityTypes = ["inference", "retrieval", "generation", "action", "integration", "other"] as const;
const httpMethods = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const sideEffects = ["none", "read", "write", "destructive"] as const;

type SideEffect = BackendAISystemCapability["side_effect_level"];

function labelize(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** LLM deployment/model this capability calls, from its registration metadata. */
function modelForCapability(c: BackendAISystemCapability): string | null {
  const meta = c.metadata_json ?? {};
  return (
    (typeof meta.deployment === "string" && meta.deployment) ||
    (typeof meta.model === "string" && meta.model) ||
    (typeof meta.model_name === "string" && meta.model_name) ||
    null
  );
}

function typeTone(t: BackendAISystemCapability["capability_type"]): "blue" | "violet" | "green" | "amber" | "slate" {
  switch (t) {
    case "inference": return "blue";
    case "retrieval": return "violet";
    case "generation": return "green";
    case "action": return "amber";
    default: return "slate";
  }
}

function methodTone(m: BackendAISystemCapability["http_method"]): "slate" | "blue" | "amber" | "red" {
  if (m === "GET") return "slate";
  if (m === "POST" || m === "PUT" || m === "PATCH") return "blue";
  return "red";
}

function sideEffectTone(s: SideEffect): "slate" | "blue" | "amber" | "red" {
  if (s === "none") return "slate";
  if (s === "read") return "blue";
  if (s === "write") return "amber";
  return "red";
}

type FormState = {
  name: string;
  description: string;
  capability_type: string;
  endpoint_ref: string;
  http_method: string;
  permissions: string;
  side_effect_level: string;
  requires_human_review: boolean;
  enabled: boolean;
  input_schema: string;
  output_schema: string;
  metadata_json: string;
};

const emptyForm: FormState = {
  name: "",
  description: "",
  capability_type: "generation",
  endpoint_ref: "",
  http_method: "POST",
  permissions: "",
  side_effect_level: "none",
  requires_human_review: false,
  enabled: true,
  input_schema: "{}",
  output_schema: "{}",
  metadata_json: "{}",
};

function parseObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function Capabilities() {
  const role = useAuthStore((s) => s.user?.role);
  const canEdit = roleCan(role, "canEditAISystem");

  const [systems, setSystems] = useState<BackendAISystem[]>([]);
  const [systemsError, setSystemsError] = useState<string | null>(null);
  const [systemsLoading, setSystemsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState("");

  const [caps, setCaps] = useState<BackendAISystemCapability[]>([]);
  const [capsLoading, setCapsLoading] = useState(false);
  const [capsError, setCapsError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  // Import-from-catalog state.
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setSystemsLoading(true);
        setSystemsError(null);
        setSystems(await listAISystems());
      } catch (err) {
        setSystemsError(err instanceof Error ? err.message : "Unable to load AI systems.");
      } finally {
        setSystemsLoading(false);
      }
    })();
  }, []);

  const loadCaps = useCallback(async (systemId: string) => {
    setCapsLoading(true);
    setCapsError(null);
    try {
      setCaps(await listCapabilities(systemId));
    } catch (err) {
      setCapsError(err instanceof Error ? err.message : "Unable to load capabilities.");
    } finally {
      setCapsLoading(false);
    }
  }, []);

  const handleImportCatalog = useCallback(async () => {
    if (!selectedId || importing) return;
    setImporting(true);
    setImportMsg(null);
    try {
      const res = await importCapabilitiesFromCatalog(selectedId);
      setImportMsg({
        ok: true,
        text: `Imported ${res.imported} endpoint${res.imported === 1 ? "" : "s"} from ${res.catalog_name ?? "the target catalog"} (${res.skipped} already present, ${res.total} total).`,
      });
      await loadCaps(selectedId);
    } catch (err) {
      setImportMsg({
        ok: false,
        text: err instanceof Error ? err.message : "Could not import from the target catalog.",
      });
    } finally {
      setImporting(false);
    }
  }, [selectedId, importing, loadCaps]);

  useEffect(() => {
    setExpanded(null);
    setShowForm(false);
    setSuccess(false);
    if (!selectedId) {
      setCaps([]);
      return;
    }
    void loadCaps(selectedId);
  }, [selectedId, loadCaps]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit() {
    setSubmitError(null);
    setSuccess(false);
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = "Name is required.";
    if (!form.endpoint_ref.trim()) errors.endpoint_ref = "Endpoint reference is required.";

    const input = parseObject(form.input_schema);
    if (input === null) errors.input_schema = "Must be a JSON object.";
    const output = parseObject(form.output_schema);
    if (output === null) errors.output_schema = "Must be a JSON object.";
    const metadata = parseObject(form.metadata_json);
    if (metadata === null) errors.metadata_json = "Must be a JSON object.";

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const payload: BackendAISystemCapabilityCreate = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      capability_type: form.capability_type as BackendAISystemCapabilityCreate["capability_type"],
      endpoint_ref: form.endpoint_ref.trim(),
      http_method: form.http_method as BackendAISystemCapabilityCreate["http_method"],
      input_schema: input ?? {},
      output_schema: output ?? {},
      permissions: form.permissions.split(",").map((p) => p.trim()).filter(Boolean),
      side_effect_level: form.side_effect_level as SideEffect,
      requires_human_review: form.requires_human_review,
      enabled: form.enabled,
      metadata_json: metadata ?? {},
    };

    try {
      setSubmitting(true);
      await createAISystemCapability(selectedId, payload);
      setSuccess(true);
      setForm(emptyForm);
      setFieldErrors({});
      setShowForm(false);
      await loadCaps(selectedId);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to create capability.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          eyebrow="Capabilities"
          title="AI System Capabilities"
          action={
            canEdit && selectedId ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleImportCatalog()}
                  disabled={importing}
                  title="Fetch all endpoints from the target's /catalog and add them as capabilities"
                  className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-[12px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DownloadCloud className="h-3.5 w-3.5" />}
                  {importing ? "Importing…" : "Import from catalog"}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowForm((v) => !v); setSuccess(false); }}
                  className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-brand-700"
                >
                  <Plus className="h-3.5 w-3.5" /> {showForm ? "Close form" : "Add capability"}
                </button>
              </div>
            ) : undefined
          }
        />
        <div className="space-y-4 px-5 py-5">
          {systemsError && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{systemsError}</span>
            </div>
          )}
          <div className="max-w-md space-y-1">
            <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">AI System</label>
            <select className={inputClass} value={selectedId} onChange={(e) => setSelectedId(e.target.value)} disabled={systemsLoading}>
              <option value="">{systemsLoading ? "Loading…" : "Select an AI system…"}</option>
              {systems.map((s) => (
                <option key={s.id} value={s.id}>{s.name} — {s.owner}</option>
              ))}
            </select>
          </div>
          {importMsg && (
            <div
              className={clsx(
                "flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px]",
                importMsg.ok
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                  : "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400",
              )}
            >
              {importMsg.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <span>{importMsg.text}</span>
            </div>
          )}
          {!canEdit && selectedId && (
            <div className="flex items-center gap-2 text-[12px] text-slate-500 dark:text-slate-400">
              <Lock className="h-3.5 w-3.5" /> Read-only access — adding capabilities requires the developer role.
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" /> Capability created.
            </div>
          )}
        </div>
      </Card>

      {showForm && canEdit && selectedId && (
        <Card>
          <CardHeader eyebrow="New" title="Add Capability" />
          <div className="space-y-5 px-5 py-5">
            {submitError && (
              <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{submitError}</span>
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Name" required error={fieldErrors.name}>
                <input className={inputClass} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Chat response generation" />
              </Field>
              <Field label="Capability Type">
                <select className={inputClass} value={form.capability_type} onChange={(e) => set("capability_type", e.target.value)}>
                  {capabilityTypes.map((t) => <option key={t} value={t}>{labelize(t)}</option>)}
                </select>
              </Field>
              <Field label="Description" className="md:col-span-2">
                <textarea className={clsx(inputClass, "resize-none")} rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} />
              </Field>
              <Field label="Endpoint Reference" required error={fieldErrors.endpoint_ref} hint="Reference only, no secrets.">
                <input className={inputClass} value={form.endpoint_ref} onChange={(e) => set("endpoint_ref", e.target.value)} placeholder="http://localhost:8000/api/chat" />
              </Field>
              <Field label="HTTP Method">
                <select className={inputClass} value={form.http_method} onChange={(e) => set("http_method", e.target.value)}>
                  {httpMethods.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
              <Field label="Permissions" hint="Comma-separated, e.g. target:invoke, kb:read">
                <input className={inputClass} value={form.permissions} onChange={(e) => set("permissions", e.target.value)} placeholder="target:invoke" />
              </Field>
              <Field label="Side-Effect Level">
                <select className={inputClass} value={form.side_effect_level} onChange={(e) => set("side_effect_level", e.target.value)}>
                  {sideEffects.map((s) => <option key={s} value={s}>{labelize(s)}</option>)}
                </select>
              </Field>
              <Field label="Input Schema (JSON)" error={fieldErrors.input_schema}>
                <textarea className={clsx(inputClass, "resize-y font-mono text-[12px]")} rows={5} spellCheck={false} value={form.input_schema} onChange={(e) => set("input_schema", e.target.value)} />
              </Field>
              <Field label="Output Schema (JSON)" error={fieldErrors.output_schema}>
                <textarea className={clsx(inputClass, "resize-y font-mono text-[12px]")} rows={5} spellCheck={false} value={form.output_schema} onChange={(e) => set("output_schema", e.target.value)} />
              </Field>
              <Field label="Metadata (JSON)" error={fieldErrors.metadata_json} className="md:col-span-2">
                <textarea className={clsx(inputClass, "resize-y font-mono text-[12px]")} rows={3} spellCheck={false} value={form.metadata_json} onChange={(e) => set("metadata_json", e.target.value)} />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-5">
              <label className="flex cursor-pointer items-center gap-2 text-[12px] text-slate-700 dark:text-slate-300">
                <input type="checkbox" checked={form.requires_human_review} onChange={(e) => set("requires_human_review", e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                Requires human review
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-[12px] text-slate-700 dark:text-slate-300">
                <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                Enabled
              </label>
              <div className="ml-auto">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleSubmit}
                  className={clsx(
                    "flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold text-white transition-colors",
                    submitting ? "cursor-not-allowed bg-slate-300 dark:bg-slate-700" : "bg-brand-600 hover:bg-brand-700",
                  )}
                >
                  <Plus className="h-4 w-4" /> {submitting ? "Creating…" : "Create capability"}
                </button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {selectedId && (
        <Card className="overflow-hidden">
          <CardHeader eyebrow="Registered" title="Capabilities" action={<Badge tone="slate">{caps.length} total</Badge>} />
          {capsError && (
            <div className="mx-5 my-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{capsError}</span>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] border-collapse text-left">
              <thead className="bg-slate-50 dark:bg-slate-800/60">
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="w-6 px-3 py-2.5" />
                  {["Name", "Type", "Endpoint", "Model", "Method", "Permissions", "Side Effect", "Human Review", "Enabled"].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {capsLoading && (
                  <tr><td colSpan={10} className="px-4 py-12 text-center text-[12px] text-slate-500 dark:text-slate-400">Loading capabilities…</td></tr>
                )}
                {!capsLoading && caps.length === 0 && !capsError && (
                  <tr><td colSpan={10} className="px-4 py-12 text-center">
                    <p className="text-[14px] font-semibold text-slate-900 dark:text-white">No capabilities yet</p>
                    <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">{canEdit ? "Add a capability to describe what this system can do." : "No capabilities registered for this system."}</p>
                  </td></tr>
                )}
                {!capsLoading && caps.map((c) => {
                  const open = expanded === c.id;
                  return (
                    <Fragment key={c.id}>
                      <tr
                        onClick={() => setExpanded(open ? null : c.id)}
                        className={clsx("group cursor-pointer border-b border-slate-100 transition-colors dark:border-slate-700/50", open ? "bg-brand-50/60 dark:bg-brand-900/20" : "hover:bg-slate-50 dark:hover:bg-slate-800/40")}
                      >
                        <td className="px-3 py-3 text-slate-400">
                          {open ? <ChevronDown className="h-4 w-4 text-brand-600" /> : <ChevronRight className="h-4 w-4 group-hover:text-slate-700 dark:group-hover:text-slate-300" />}
                        </td>
                        <td className="px-3 py-3 text-[13px] font-semibold text-slate-900 dark:text-white">{c.name}</td>
                        <td className="px-3 py-3"><Badge tone={typeTone(c.capability_type)}>{labelize(c.capability_type)}</Badge></td>
                        <td className="max-w-[220px] truncate px-3 py-3 font-mono text-[11px] text-slate-600 dark:text-slate-300" title={c.endpoint_ref}>{c.endpoint_ref}</td>
                        <td className="px-3 py-3 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                          {modelForCapability(c) ?? <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-3 py-3"><Badge tone={methodTone(c.http_method)}>{c.http_method}</Badge></td>
                        <td className="px-3 py-3">
                          <div className="flex max-w-[180px] flex-wrap gap-1">
                            {c.permissions.length === 0 ? <span className="text-[11px] text-slate-400">—</span> : c.permissions.map((p) => (
                              <span key={p} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">{p}</span>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-3"><Badge tone={sideEffectTone(c.side_effect_level)}>{labelize(c.side_effect_level)}</Badge></td>
                        <td className="px-3 py-3"><Badge tone={c.requires_human_review ? "amber" : "slate"}>{c.requires_human_review ? "Yes" : "No"}</Badge></td>
                        <td className="px-3 py-3"><Badge tone={c.enabled ? "green" : "slate"}>{c.enabled ? "Enabled" : "Disabled"}</Badge></td>
                      </tr>
                      {open && (
                        <tr className="border-b border-blue-100 bg-blue-50/50 dark:border-blue-900/40 dark:bg-blue-950/10">
                          <td colSpan={10} className="px-5 py-4">
                            {c.description && <p className="mb-3 text-[12px] leading-5 text-slate-700 dark:text-slate-300">{c.description}</p>}
                            <div className="grid gap-4 lg:grid-cols-2">
                              <SchemaBlock title="Input Schema" value={c.input_schema} />
                              <SchemaBlock title="Output Schema" value={c.output_schema} />
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!selectedId && (
        <Card>
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
            <Boxes className="h-8 w-8 text-slate-300 dark:text-slate-600" />
            <p className="text-[14px] font-semibold text-slate-900 dark:text-white">Select an AI system</p>
            <p className="max-w-md text-[12px] text-slate-500 dark:text-slate-400">Choose a registered system above to view and manage its capabilities.</p>
          </div>
        </Card>
      )}
    </div>
  );
}

function SchemaBlock({ title, value }: { title: string; value: Record<string, unknown> }) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">{title}</p>
      <pre className="max-h-60 overflow-auto rounded-lg border border-slate-200 bg-white p-3 font-mono text-[11px] leading-5 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
        {JSON.stringify(value, null, 2)}
      </pre>
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
