import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, FileJson, Layers, Lock, Save, Upload, XCircle } from "lucide-react";
import clsx from "clsx";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { useAuthStore } from "@/store/useAuthStore";
import { roleCan } from "@/lib/permissions";
import {
  getContextProfile,
  listAISystems,
  uploadContextDocument,
  upsertContextProfile,
  type BackendAISystem,
  type ContextProfile,
} from "@/api/governanceApi";

const inputClass =
  "w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-[13px] text-slate-900 dark:text-white outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:focus:ring-brand-700/40";

type SectionKey =
  | "identity_purpose"
  | "pre_model_controls"
  | "model_configuration"
  | "post_model_controls"
  | "integration_context";

const SECTIONS: ReadonlyArray<{ key: SectionKey; title: string; hint: string; placeholder: string }> = [
  {
    key: "identity_purpose",
    title: "Identity & Purpose",
    hint: "Who the system is for and what it is meant to do.",
    placeholder: "Purpose: What this system does and for whom\nDomain: Business area (e.g. HR / recruitment)\nIntended Use: How its outputs are used",
  },
  {
    key: "pre_model_controls",
    title: "Pre-Model Controls",
    hint: "Input validation, redaction, and guardrails before inference.",
    placeholder: "Input Validation: How requests are validated\nAuthentication: How callers are authenticated\nInput Sanitization: PII / injection filtering before the model",
  },
  {
    key: "model_configuration",
    title: "Model Configuration",
    hint: "Model, parameters, and deployment configuration.",
    placeholder: "Provider: e.g. Azure OpenAI\nLLM Model: e.g. gpt-4.1\nDeployment: How and where it is deployed",
  },
  {
    key: "post_model_controls",
    title: "Post-Model Controls",
    hint: "Output filtering, grounding checks, and human review.",
    placeholder: "Output Filtering: Checks applied to model output\nHuman Review: When a person reviews decisions\nFallbacks: What happens when the model fails",
  },
  {
    key: "integration_context",
    title: "Integration Context",
    hint: "Upstream/downstream systems and data flows.",
    placeholder: "Upstream: Systems that call this one\nDownstream: Systems consuming its output\nData Flows: What data moves where",
  },
];

type DraftState = Record<SectionKey, string>;

const emptyDraft: DraftState = {
  identity_purpose: "",
  pre_model_controls: "",
  model_configuration: "",
  post_model_controls: "",
  integration_context: "",
};

function titleize(key: string): string {
  return key.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function snakeCase(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/**
 * Render a stored section object as editable plain text: one "Label: value"
 * line per field. Nested values are inlined as JSON (and parsed back on save).
 * A `notes` field is emitted as a trailing free-form paragraph. Embedded
 * newlines inside a value are indented so they stay attached to their field.
 */
function sectionToText(value: Record<string, unknown> | undefined): string {
  if (!value || Object.keys(value).length === 0) return "";
  const lines: string[] = [];
  let notes = "";
  for (const [key, v] of Object.entries(value)) {
    if (key === "notes" && typeof v === "string") {
      notes = v;
      continue;
    }
    const rendered = typeof v === "string" ? v : JSON.stringify(v);
    lines.push(`${titleize(key)}: ${rendered.replace(/\n/g, "\n  ")}`);
  }
  if (notes) {
    if (lines.length) lines.push("");
    lines.push(notes);
  }
  return lines.join("\n");
}

function profileToDraft(profile: ContextProfile): DraftState {
  return {
    identity_purpose: sectionToText(profile.identity_purpose),
    pre_model_controls: sectionToText(profile.pre_model_controls),
    model_configuration: sectionToText(profile.model_configuration),
    post_model_controls: sectionToText(profile.post_model_controls),
    integration_context: sectionToText(profile.integration_context),
  };
}

type ParseResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

// A line starts a new field when it looks like "Label: value" (short label,
// no URL scheme). Everything else attaches to the previous field or, after a
// blank line, becomes free-form notes.
const FIELD_LINE = /^([A-Za-z][A-Za-z0-9 _/&().'-]{0,59}):\s?(.*)$/;
const URL_LINE = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Inline JSON values ("{...}"/"[...]") survive the plain-text round trip. */
function coerceValue(v: string): unknown {
  if (v.startsWith("{") || v.startsWith("[")) {
    try {
      return JSON.parse(v);
    } catch {
      /* keep as string */
    }
  }
  return v;
}

/**
 * Parse plain text into a section object. "Label: value" lines become fields
 * (label snake_cased for storage); unlabeled lines continue the previous
 * field; paragraphs after a blank line (or with no preceding field) are kept
 * verbatim under `notes`. This is the inverse of sectionToText.
 */
function parsePlainText(text: string): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  const notes: string[] = [];
  let currentKey: string | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.trim() === "") {
      currentKey = null; // blank line: following prose becomes notes
      continue;
    }
    const indented = /^\s/.test(rawLine);
    const match = !indented && !URL_LINE.test(line.trim()) ? line.match(FIELD_LINE) : null;
    if (match) {
      let key = snakeCase(match[1]) || "field";
      let unique = key;
      let n = 2;
      while (unique in value) unique = `${key}_${n++}`;
      key = unique;
      currentKey = key;
      value[key] = coerceValue(match[2].trim());
    } else if (currentKey && typeof value[currentKey] === "string") {
      value[currentKey] = `${value[currentKey]}\n${line.trim()}`;
    } else {
      notes.push(line.trim());
      currentKey = null;
    }
  }

  if (notes.length) value.notes = notes.join("\n");
  return value;
}

function parseSection(raw: string): ParseResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: {} };
  // Plain text is the primary format: "Label: value" lines become structured
  // fields and free paragraphs become notes. Pasted JSON objects still work.
  const looksStructured = trimmed.startsWith("{") || trimmed.startsWith("[");
  if (!looksStructured) {
    return { ok: true, value: parsePlainText(trimmed) };
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed === null || typeof parsed !== "object") {
      return { ok: false, error: "Enter plain text ('Label: value' lines) or a JSON object." };
    }
    if (Array.isArray(parsed)) {
      // A bare array isn't a valid section object; keep it under a key.
      return { ok: true, value: { items: parsed } };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    // Starts like JSON but is malformed — surface a clear, actionable error
    // rather than a raw parser message.
    return {
      ok: false,
      error: "This looks like JSON but is malformed. Fix it, or remove the leading { / [ to save as plain text.",
    };
  }
}

export function ApplicationContextProfiles() {
  const role = useAuthStore((s) => s.user?.role);
  const canEdit = roleCan(role, "canEditAISystem");

  const [systems, setSystems] = useState<BackendAISystem[]>([]);
  const [systemsError, setSystemsError] = useState<string | null>(null);
  const [systemsLoading, setSystemsLoading] = useState(true);

  const [selectedId, setSelectedId] = useState("");
  const [profile, setProfile] = useState<ContextProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [draft, setDraft] = useState<DraftState>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Context document upload (file or pasted text -> retrieval-context doc).
  const [uploadText, setUploadText] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleUpload() {
    if (!selectedId || uploading) return;
    if (!uploadFile && !uploadText.trim()) {
      setUploadStatus({ ok: false, message: "Choose a file or enter some text first." });
      return;
    }
    setUploading(true);
    setUploadStatus(null);
    try {
      const doc = await uploadContextDocument(selectedId, {
        file: uploadFile ?? undefined,
        text: uploadText.trim() || undefined,
        title: uploadTitle.trim() || undefined,
      });
      setUploadStatus({ ok: true, message: `Uploaded "${doc.title}" — available to RAG groundedness checks.` });
      setUploadText("");
      setUploadFile(null);
      setUploadTitle("");
    } catch (err) {
      setUploadStatus({ ok: false, message: err instanceof Error ? err.message : "Upload failed." });
    } finally {
      setUploading(false);
    }
  }

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

  const loadProfile = useCallback(async (systemId: string) => {
    setProfileLoading(true);
    setProfileError(null);
    setSaveError(null);
    setSaveSuccess(false);
    setLoaded(false);
    try {
      const result = await getContextProfile(systemId);
      setProfile(result);
      setDraft(result ? profileToDraft(result) : emptyDraft);
      setLoaded(true);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Unable to load context profile.");
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setProfile(null);
      setLoaded(false);
      setDraft(emptyDraft);
      return;
    }
    void loadProfile(selectedId);
  }, [selectedId, loadProfile]);

  const parsed = useMemo(() => {
    const result = {} as Record<SectionKey, ParseResult>;
    for (const { key } of SECTIONS) result[key] = parseSection(draft[key]);
    return result;
  }, [draft]);

  const allValid = SECTIONS.every(({ key }) => parsed[key].ok);

  async function handleSave() {
    if (!selectedId || !allValid) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const payload: Partial<Record<SectionKey, Record<string, unknown>>> = {};
      for (const { key } of SECTIONS) {
        const r = parsed[key];
        if (r.ok) payload[key] = r.value;
      }
      const updated = await upsertContextProfile(selectedId, payload);
      setProfile(updated);
      setDraft(profileToDraft(updated));
      setSaveSuccess(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save context profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader eyebrow="Application Context" title="Context Profiles" />
        <div className="space-y-4 px-5 py-5">
          {systemsError && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{systemsError}</span>
            </div>
          )}
          <div className="max-w-md space-y-1">
            <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">AI System</label>
            <select
              className={inputClass}
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              disabled={systemsLoading}
            >
              <option value="">{systemsLoading ? "Loading…" : "Select an AI system…"}</option>
              {systems.map((s) => (
                <option key={s.id} value={s.id}>{s.name} — {s.owner}</option>
              ))}
            </select>
          </div>
          {!canEdit && selectedId && (
            <div className="flex items-center gap-2 text-[12px] text-slate-500 dark:text-slate-400">
              <Lock className="h-3.5 w-3.5" /> Read-only access — saving requires the developer role.
            </div>
          )}
        </div>
      </Card>

      {!selectedId && (
        <Card>
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
            <Layers className="h-8 w-8 text-slate-300 dark:text-slate-600" />
            <p className="text-[14px] font-semibold text-slate-900 dark:text-white">Select an AI system</p>
            <p className="max-w-md text-[12px] text-slate-500 dark:text-slate-400">
              Choose a registered system above to view or edit its application context profile across the five
              governance sections.
            </p>
          </div>
        </Card>
      )}

      {selectedId && profileLoading && (
        <Card>
          <div className="px-6 py-16 text-center text-[12px] text-slate-500 dark:text-slate-400">Loading context profile…</div>
        </Card>
      )}

      {selectedId && profileError && (
        <Card>
          <div className="mx-5 my-5 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{profileError}</span>
          </div>
        </Card>
      )}

      {selectedId && loaded && !profileError && (
        <Card>
          <CardHeader
            eyebrow={profile ? "Editing profile" : "New profile"}
            title={profile ? "Context Profile" : "Create Context Profile"}
            action={
              <Badge tone={allValid ? "green" : "red"}>
                {allValid ? "All sections valid" : "Fix invalid sections"}
              </Badge>
            }
          />
          <div className="space-y-4 px-5 py-5">
            {!profile && (
              <div className="flex items-start gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2.5 text-[12px] text-slate-600 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                <FileJson className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <span>No profile exists for this system yet. Fill in the sections below and save to create one.</span>
              </div>
            )}

            <p className="text-[11px] leading-5 text-slate-500 dark:text-slate-400">
              Write plain text — one <span className="rounded bg-slate-100 px-1 font-mono dark:bg-slate-800">Label: value</span> per
              line. Lines without a label continue the field above; paragraphs after a blank line are kept as
              free-form notes. Pasting a JSON object also works.
            </p>

            <div className="grid gap-4 lg:grid-cols-2">
              {SECTIONS.map(({ key, title, hint, placeholder }) => {
                const result = parsed[key];
                return (
                  <div key={key} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-[12px] font-semibold text-slate-800 dark:text-slate-200">{title}</p>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500">{hint}</p>
                      </div>
                      {result.ok ? (
                        <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Valid
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[10px] font-medium text-red-600 dark:text-red-400">
                          <XCircle className="h-3.5 w-3.5" /> Invalid
                        </span>
                      )}
                    </div>
                    <textarea
                      className={clsx(
                        inputClass,
                        "resize-y text-[12px] leading-5",
                        !result.ok && "border-red-400 focus:border-red-500 dark:border-red-600",
                      )}
                      rows={8}
                      placeholder={placeholder}
                      value={draft[key]}
                      disabled={!canEdit}
                      onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                    />
                    {!result.ok && (
                      <p className="text-[10px] font-medium text-red-600 dark:text-red-400">{result.error}</p>
                    )}
                  </div>
                );
              })}
            </div>

            {saveError && (
              <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{saveError}</span>
              </div>
            )}
            {saveSuccess && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4 shrink-0" /> Context profile saved.
              </div>
            )}

            {canEdit && (
              <div className="flex items-center justify-end gap-3">
                {!allValid && (
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">Fix the invalid section before saving.</span>
                )}
                <button
                  type="button"
                  disabled={!allValid || saving}
                  onClick={handleSave}
                  className={clsx(
                    "flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold text-white transition-colors",
                    allValid && !saving ? "bg-brand-600 hover:bg-brand-700" : "cursor-not-allowed bg-slate-300 dark:bg-slate-700",
                  )}
                >
                  <Save className="h-4 w-4" />
                  {saving ? "Saving…" : profile ? "Save profile" : "Create profile"}
                </button>
              </div>
            )}
          </div>
        </Card>
      )}

      {selectedId && (
        <Card>
          <CardHeader
            eyebrow="Upload context"
            title="Add context by file or text"
            action={<Badge tone="blue">Feeds RAG grounding</Badge>}
          />
          <div className="space-y-4 px-5 py-5">
            <p className="text-[12px] text-slate-500 dark:text-slate-400">
              Attach a document (policy, FAQ, knowledge-base article) or paste text. PDF and Word (.docx)
              files are supported — their text is extracted server-side. The document is stored as
              retrieval context for this system and used by RAG groundedness evaluation (RAGAS) at run time.
            </p>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-1.5">
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">File</label>
                <input
                  type="file"
                  accept=".pdf,.docx,.txt,.md,.json,.csv,.log,text/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  disabled={!canEdit || uploading}
                  onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-[12px] text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-[12px] file:font-semibold file:text-brand-700 hover:file:bg-brand-100 dark:text-slate-300 dark:file:bg-brand-950/40 dark:file:text-brand-300"
                />
                <input
                  type="text"
                  placeholder="Title (optional)"
                  value={uploadTitle}
                  disabled={!canEdit || uploading}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">Or paste text</label>
                <textarea
                  className={clsx(inputClass, "resize-y text-[12px] leading-5")}
                  rows={5}
                  placeholder="Paste policy text, documentation, or notes…"
                  value={uploadText}
                  disabled={!canEdit || uploading}
                  onChange={(e) => setUploadText(e.target.value)}
                />
              </div>
            </div>

            {uploadStatus && (
              <div
                className={clsx(
                  "flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px]",
                  uploadStatus.ok
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                    : "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400",
                )}
              >
                {uploadStatus.ok ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <span>{uploadStatus.message}</span>
              </div>
            )}

            {canEdit ? (
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  disabled={uploading || (!uploadFile && !uploadText.trim())}
                  onClick={handleUpload}
                  className={clsx(
                    "flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold text-white transition-colors",
                    !uploading && (uploadFile || uploadText.trim())
                      ? "bg-brand-600 hover:bg-brand-700"
                      : "cursor-not-allowed bg-slate-300 dark:bg-slate-700",
                  )}
                >
                  <Upload className="h-4 w-4" />
                  {uploading ? "Uploading…" : "Upload context"}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-[12px] text-slate-500 dark:text-slate-400">
                <Lock className="h-3.5 w-3.5" /> Uploading requires the developer role.
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
