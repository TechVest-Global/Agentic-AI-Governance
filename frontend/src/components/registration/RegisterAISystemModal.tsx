import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useForm, useFieldArray, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Plus, Server, Trash2, X } from "lucide-react";
import clsx from "clsx";
import {
  registerAISystem,
  type AISystemRegistrationCreate,
  type AISystemRegistrationRead,
  type OptionItem,
  type RegistrationFrameworkOption,
  type RegistrationOptions,
} from "@/api/governanceApi";

// The 16 factual risk-screening questions. IDs must match the backend
// risk_classification_service question_ids exactly.
const RISK_QUESTIONS: { id: string; label: string }[] = [
  { id: "affects_legal_or_significant_effects", label: "Does it influence decisions with legal or significant effects on individuals?" },
  { id: "processes_personal_data", label: "Does it process personal data?" },
  { id: "processes_sensitive_special_category", label: "Does it process sensitive / special-category data?" },
  { id: "fully_automated_decisioning", label: "Does it make fully automated decisions?" },
  { id: "used_in_safety_critical", label: "Is it used in a safety-critical context?" },
  { id: "biometric_identification", label: "Does it perform biometric identification?" },
  { id: "vulnerable_populations", label: "Does it affect vulnerable populations?" },
  { id: "public_facing_external_users", label: "Is it externally accessible / public-facing?" },
  { id: "high_volume_or_scale", label: "Does it operate at high volume or scale?" },
  { id: "generative_free_text_output", label: "Does it generate free-form output?" },
  { id: "tool_or_action_execution", label: "Can it take actions or execute tools?" },
  { id: "cross_border_data_transfer", label: "Does it involve cross-border data transfer?" },
  { id: "third_party_or_opaque_model", label: "Does it use third-party or opaque models?" },
  { id: "no_human_oversight_configured", label: "Is there no human oversight configured?" },
  { id: "regulated_domain", label: "Does it operate in a regulated domain?" },
  { id: "prior_incidents_or_known_risks", label: "Are there prior incidents or known risks?" },
];

const ENDPOINT_REQUIRED_STAGES = new Set(["staging", "production"]);

// ── Zod schema ────────────────────────────────────────────────────────────────
const ownerSchema = z.object({
  role: z.string().min(1),
  name: z.string().optional().default(""),
  email: z
    .string()
    .email("Invalid email")
    .optional()
    .or(z.literal("")),
  is_primary: z.boolean().optional().default(false),
});

const modelSchema = z.object({
  name: z.string().optional().default(""),
  provider: z.string().optional().default(""),
  model_type: z.string().optional().default(""),
  version: z.string().optional().default(""),
  purpose: z.string().optional().default(""),
  is_third_party: z.boolean().optional().default(true),
});

const endpointSchema = z.object({
  name: z.string().min(1, "Required"),
  url: z.string().min(1, "Required").url("Must be a valid URL"),
  purpose: z.string().optional().default(""),
  http_method: z.string().optional().default("POST"),
  environment: z.string().optional().default("development"),
  model_ref: z.string().optional().default(""),
  gateway_type: z.string().optional().default(""),
  authentication_type: z.string().optional().default(""),
  exposure_type: z.string().optional().default(""),
  status: z.string().optional().default("active"),
  is_public: z.boolean().optional().default(false),
  pii_allowed: z.boolean().optional().default(false),
});

const frameworkSelSchema = z.object({
  framework_id: z.string().min(1),
  applicability_type: z.string().optional().default("unsure"),
  applicability_note: z.string().optional().default(""),
});

// Optional non-negative number: empty string → undefined (not 0).
const optNum = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
  z.number().min(0, "Must be ≥ 0").optional(),
);

const dataSourceSchema = z.object({
  name: z.string().min(1, "Required"),
  source_type: z.string().optional().default(""),
  classification: z.string().optional().default(""),
  usage_purpose: z.string().optional().default(""),
  used_for_rag: z.boolean().optional().default(false),
  external_sharing: z.boolean().optional().default(false),
  contains_personal_data: z.boolean().optional().default(false),
  contains_sensitive_personal_data: z.boolean().optional().default(false),
  contains_confidential_data: z.boolean().optional().default(false),
  contains_health_data: z.boolean().optional().default(false),
  contains_financial_data: z.boolean().optional().default(false),
  contains_biometric_data: z.boolean().optional().default(false),
  contains_minors_data: z.boolean().optional().default(false),
});

const ragSchema = z.object({
  knowledge_base_name: z.string().optional().default(""),
  vector_database: z.string().optional().default(""),
  embedding_model: z.string().optional().default(""),
  reranking_model: z.string().optional().default(""),
  retrieval_strategy: z.string().optional().default(""),
  top_k: optNum,
  citations_enabled: z.boolean().optional().default(false),
  access_control_applied: z.boolean().optional().default(false),
  document_refresh_frequency: z.string().optional().default(""),
});

const agentSchema = z.object({
  agent_purpose: z.string().optional().default(""),
  num_agents: optNum,
  tools_used: z.string().optional().default(""),
  external_systems: z.string().optional().default(""),
  read_access: z.boolean().optional().default(false),
  write_access: z.boolean().optional().default(false),
  can_send_messages: z.boolean().optional().default(false),
  can_modify_files: z.boolean().optional().default(false),
  can_write_database: z.boolean().optional().default(false),
  can_execute_code: z.boolean().optional().default(false),
  human_approval_required: z.boolean().optional().default(false),
  max_steps: optNum,
  max_execution_seconds: optNum,
  persistent_memory_enabled: z.boolean().optional().default(false),
});

const dependencySchema = z.object({
  name: z.string().min(1, "Required"),
  service_purpose: z.string().optional().default(""),
  dependency_type: z.string().optional().default(""),
  data_shared: z.string().optional().default(""),
  hosting_region: z.string().optional().default(""),
  is_critical: z.boolean().optional().default(false),
  is_third_party_api: z.boolean().optional().default(false),
  contract_sla_available: z.boolean().optional().default(false),
  exit_option: z.string().optional().default(""),
});

const documentSchema = z.object({
  name: z.string().min(1, "Required"),
  document_type: z.string().optional().default(""),
  version: z.string().optional().default(""),
  document_owner: z.string().optional().default(""),
  related_framework: z.string().optional().default(""),
  confidentiality_level: z.string().optional().default(""),
  notes: z.string().optional().default(""),
});

const schema = z
  .object({
    submitIntent: z.enum(["draft", "registered"]),
    system: z.object({
      name: z.string().min(1, "System name is required"),
      version: z.string().optional().default(""),
      description: z.string().optional().default(""),
      business_purpose: z.string().optional().default(""),
      system_type: z.string().optional().default(""),
      business_domain: z.string().optional().default(""),
      lifecycle_stage: z.string().optional().default(""),
      deployment_environment: z.string().optional().default("development"),
      modality: z.string().optional().default("text"),
      production_criticality: z.string().optional().default(""),
      business_unit: z.string().optional().default(""),
      product_name: z.string().optional().default(""),
      internal_identifier: z.string().optional().default(""),
      notes: z.string().optional().default(""),
    }),
    usage: z.object({
      primary_use_case: z.string().optional().default(""),
      intended_users: z.string().optional().default(""),
      internal_external_use: z.string().optional().default(""),
      output_usage: z.string().optional().default(""),
      human_oversight: z.string().optional().default(""),
      input_modalities: z.array(z.string()).optional().default([]),
      output_types: z.array(z.string()).optional().default([]),
      capabilities: z.array(z.string()).optional().default([]),
    }),
    owners: z.array(ownerSchema),
    models: z.array(modelSchema),
    endpoints: z.array(endpointSchema),
    frameworks: z.array(frameworkSelSchema),
    riskAnswers: z.record(z.string(), z.enum(["yes", "no", "unknown"])),
    dataSources: z.array(dataSourceSchema),
    rag: ragSchema,
    agent: agentSchema,
    security: z.record(z.string(), z.string()),
    dependencies: z.array(dependencySchema),
    documents: z.array(documentSchema),
  })
  .superRefine((val, ctx) => {
    if (val.submitIntent !== "registered") return; // drafts only need a name

    const require = (cond: boolean, path: (string | number)[], message: string) => {
      if (!cond) ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    };

    require(!!val.system.version, ["system", "version"], "Required to register");
    require(!!val.system.description, ["system", "description"], "Required to register");
    require(!!val.system.business_purpose, ["system", "business_purpose"], "Required to register");
    require(!!val.system.system_type, ["system", "system_type"], "Required to register");
    require(!!val.system.business_domain, ["system", "business_domain"], "Required to register");
    require(!!val.system.lifecycle_stage, ["system", "lifecycle_stage"], "Required to register");
    require(
      !!val.system.deployment_environment,
      ["system", "deployment_environment"],
      "Required to register",
    );
    require(!!val.usage.intended_users, ["usage", "intended_users"], "Required to register");
    require(!!val.usage.output_usage, ["usage", "output_usage"], "Required to register");
    require(!!val.usage.human_oversight, ["usage", "human_oversight"], "Required to register");

    const primary = val.owners.find((o) => o.is_primary) ?? val.owners.find((o) => o.role === "system_owner");
    const technical = val.owners.find((o) => o.role === "technical_owner");
    const pIdx = primary ? val.owners.indexOf(primary) : 0;
    const tIdx = technical ? val.owners.indexOf(technical) : -1;
    require(!!(primary && primary.name), ["owners", pIdx, "name"], "Primary owner name required");
    require(!!(primary && primary.email), ["owners", pIdx, "email"], "Primary owner email required");
    if (tIdx >= 0) {
      require(!!(technical && technical.name), ["owners", tIdx, "name"], "Technical owner name required");
      require(!!(technical && technical.email), ["owners", tIdx, "email"], "Technical owner email required");
    } else {
      require(false, ["owners"], "A technical owner is required to register");
    }

    val.models.forEach((m, i) => {
      require(!!m.name, ["models", i, "name"], "Model name required");
      require(!!m.provider, ["models", i, "provider"], "Provider required");
    });
    require(val.models.length > 0, ["models"], "At least one model is required");
    require(val.frameworks.length > 0, ["frameworks"], "Select at least one framework");

    const stage = (val.system.lifecycle_stage || "").toLowerCase();
    const env = (val.system.deployment_environment || "").toLowerCase();
    if (ENDPOINT_REQUIRED_STAGES.has(stage) || env === "production") {
      require(val.endpoints.length > 0, ["endpoints"], "Staging/production requires at least one endpoint");
    }
  });

type FormValues = z.input<typeof schema>;

function defaultValues(): FormValues {
  const riskAnswers: Record<string, "yes" | "no" | "unknown"> = {};
  for (const q of RISK_QUESTIONS) riskAnswers[q.id] = "unknown";
  return {
    submitIntent: "registered",
    system: {
      name: "", version: "", description: "", business_purpose: "", system_type: "",
      business_domain: "", lifecycle_stage: "", deployment_environment: "development",
      modality: "text", production_criticality: "", business_unit: "", product_name: "",
      internal_identifier: "", notes: "",
    },
    usage: {
      primary_use_case: "", intended_users: "", internal_external_use: "", output_usage: "",
      human_oversight: "", input_modalities: [], output_types: [], capabilities: [],
    },
    owners: [
      { role: "system_owner", name: "", email: "", is_primary: true },
      { role: "technical_owner", name: "", email: "", is_primary: false },
    ],
    models: [{ name: "", provider: "", model_type: "", version: "", purpose: "", is_third_party: true }],
    endpoints: [],
    frameworks: [],
    riskAnswers,
    dataSources: [],
    rag: {
      knowledge_base_name: "", vector_database: "", embedding_model: "", reranking_model: "",
      retrieval_strategy: "", top_k: undefined, citations_enabled: false,
      access_control_applied: false, document_refresh_frequency: "",
    },
    agent: {
      agent_purpose: "", num_agents: undefined, tools_used: "", external_systems: "",
      read_access: false, write_access: false, can_send_messages: false, can_modify_files: false,
      can_write_database: false, can_execute_code: false, human_approval_required: false,
      max_steps: undefined, max_execution_seconds: undefined, persistent_memory_enabled: false,
    },
    security: {},
    dependencies: [],
    documents: [],
  };
}

function splitList(text: string | undefined): string[] {
  return (text ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function ragApplies(values: FormValues): boolean {
  return (
    values.system.system_type === "rag_application" ||
    values.dataSources.some((d) => d.used_for_rag)
  );
}

function agentApplies(values: FormValues): boolean {
  const caps = values.usage.capabilities ?? [];
  return (
    values.system.system_type === "ai_agent" ||
    caps.includes("tool_execution") ||
    caps.includes("autonomous_planning")
  );
}

function buildPayload(values: FormValues): AISystemRegistrationCreate {
  const clean = (s: string | undefined) => (s && s.trim() ? s.trim() : null);
  const numOrNull = (v: unknown): number | null =>
    v === undefined || v === null || v === "" ? null : Number(v);
  const includeRag = ragApplies(values);
  const includeAgent = agentApplies(values);
  return {
    status: values.submitIntent,
    system: {
      name: values.system.name.trim(),
      version: clean(values.system.version),
      description: clean(values.system.description),
      business_purpose: clean(values.system.business_purpose),
      system_type: clean(values.system.system_type),
      business_domain: clean(values.system.business_domain),
      lifecycle_stage: clean(values.system.lifecycle_stage),
      deployment_environment: values.system.deployment_environment || "development",
      modality: values.system.modality || "text",
      production_criticality: clean(values.system.production_criticality),
      business_unit: clean(values.system.business_unit),
      product_name: clean(values.system.product_name),
      internal_identifier: clean(values.system.internal_identifier),
      notes: clean(values.system.notes),
    },
    usage_context: {
      primary_use_case: clean(values.usage.primary_use_case),
      intended_users: clean(values.usage.intended_users),
      internal_external_use: clean(values.usage.internal_external_use),
      output_usage: clean(values.usage.output_usage),
      human_oversight: clean(values.usage.human_oversight),
      input_modalities: values.usage.input_modalities ?? [],
      output_types: values.usage.output_types ?? [],
      capabilities: values.usage.capabilities ?? [],
    },
    owners: values.owners
      .filter((o) => o.name && o.name.trim())
      .map((o) => ({
        role: o.role,
        name: o.name!.trim(),
        email: o.email ? o.email.trim() : null,
        is_primary: !!o.is_primary,
      })),
    models: values.models
      .filter((m) => m.name && m.name.trim())
      .map((m) => ({
        name: m.name!.trim(),
        provider: m.provider || "other",
        model_type: clean(m.model_type),
        version: clean(m.version),
        purpose: clean(m.purpose),
        is_third_party: m.is_third_party ?? true,
      })),
    endpoints: values.endpoints.map((e) => ({
      name: e.name.trim(),
      url: e.url.trim(),
      purpose: clean(e.purpose),
      http_method: e.http_method || "POST",
      environment: e.environment || "development",
      model_ref: clean(e.model_ref),
      gateway_type: clean(e.gateway_type),
      authentication_type: clean(e.authentication_type),
      exposure_type: clean(e.exposure_type),
      status: e.status || "active",
      is_public: !!e.is_public,
      pii_allowed: !!e.pii_allowed,
    })),
    frameworks: values.frameworks.map((f) => ({
      framework_id: f.framework_id,
      applicability_type: f.applicability_type || "unsure",
      applicability_note: clean(f.applicability_note),
    })),
    risk_screening: { answers: values.riskAnswers },
    data_sources: values.dataSources.map((d) => ({
      name: d.name.trim(),
      source_type: clean(d.source_type),
      classification: clean(d.classification),
      usage_purpose: clean(d.usage_purpose),
      used_for_rag: !!d.used_for_rag,
      external_sharing: !!d.external_sharing,
      contains_personal_data: !!d.contains_personal_data,
      contains_sensitive_personal_data: !!d.contains_sensitive_personal_data,
      contains_confidential_data: !!d.contains_confidential_data,
      contains_health_data: !!d.contains_health_data,
      contains_financial_data: !!d.contains_financial_data,
      contains_biometric_data: !!d.contains_biometric_data,
      contains_minors_data: !!d.contains_minors_data,
    })),
    rag_configuration: includeRag
      ? {
          knowledge_base_name: clean(values.rag.knowledge_base_name),
          vector_database: clean(values.rag.vector_database),
          embedding_model: clean(values.rag.embedding_model),
          reranking_model: clean(values.rag.reranking_model),
          retrieval_strategy: clean(values.rag.retrieval_strategy),
          top_k: numOrNull(values.rag.top_k),
          citations_enabled: !!values.rag.citations_enabled,
          access_control_applied: !!values.rag.access_control_applied,
          document_refresh_frequency: clean(values.rag.document_refresh_frequency),
        }
      : null,
    agent_configuration: includeAgent
      ? {
          agent_purpose: clean(values.agent.agent_purpose),
          num_agents: numOrNull(values.agent.num_agents),
          tools_used: splitList(values.agent.tools_used),
          external_systems: splitList(values.agent.external_systems),
          read_access: !!values.agent.read_access,
          write_access: !!values.agent.write_access,
          can_send_messages: !!values.agent.can_send_messages,
          can_modify_files: !!values.agent.can_modify_files,
          can_write_database: !!values.agent.can_write_database,
          can_execute_code: !!values.agent.can_execute_code,
          human_approval_required: !!values.agent.human_approval_required,
          max_steps: numOrNull(values.agent.max_steps),
          max_execution_seconds: numOrNull(values.agent.max_execution_seconds),
          persistent_memory_enabled: !!values.agent.persistent_memory_enabled,
        }
      : null,
    security_posture: Object.entries(values.security)
      .filter(([, status]) => status)
      .map(([control_key, implementation_status]) => ({ control_key, implementation_status })),
    dependencies: values.dependencies.map((d) => ({
      name: d.name.trim(),
      service_purpose: clean(d.service_purpose),
      dependency_type: clean(d.dependency_type),
      data_shared: clean(d.data_shared),
      hosting_region: clean(d.hosting_region),
      is_critical: !!d.is_critical,
      is_third_party_api: !!d.is_third_party_api,
      contract_sla_available: !!d.contract_sla_available,
      exit_option: clean(d.exit_option),
    })),
    documents: values.documents.map((d) => ({
      name: d.name.trim(),
      document_type: clean(d.document_type),
      version: clean(d.version),
      document_owner: clean(d.document_owner),
      related_framework: clean(d.related_framework),
      confidentiality_level: clean(d.confidentiality_level),
      notes: clean(d.notes),
    })),
  };
}

// ── Small presentational helpers ──────────────────────────────────────────────
const inputCls =
  "w-full rounded border border-slate-300 bg-white px-3 py-2 text-[12px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-brand-400";

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{title}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">{label}</label>
      {hint && <p className="text-[10px] text-slate-400 dark:text-slate-500">{hint}</p>}
      {children}
      {error && <p className="text-[10px] font-medium text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

function Select({
  options,
  placeholder = "Select…",
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & { options: OptionItem[]; placeholder?: string }) {
  return (
    <select className={inputCls} {...rest}>
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

// Walks react-hook-form's FieldErrors tree and returns the DOM node registered
// for the first invalid field (RHF attaches the input's `ref` to each leaf
// error). Used to scroll a submit-time validation failure into view when the
// offending field is scrolled out of sight in this long form.
function findFirstErrorRef(node: unknown): HTMLElement | null {
  if (!node || typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;
  const ref = obj.ref as { scrollIntoView?: unknown } | undefined;
  if (ref && typeof ref.scrollIntoView === "function") {
    return ref as unknown as HTMLElement;
  }
  for (const key of Object.keys(obj)) {
    if (key === "ref" || key === "type" || key === "message") continue;
    const found = findFirstErrorRef(obj[key]);
    if (found) return found;
  }
  return null;
}

type Props = {
  options: RegistrationOptions | null;
  frameworks: RegistrationFrameworkOption[];
  frameworksError: boolean;
  onReloadFrameworks: () => void;
  onClose: () => void;
  onRegistered: (result: AISystemRegistrationRead) => void;
};

export function RegisterAISystemModal({
  options,
  frameworks,
  frameworksError,
  onReloadFrameworks,
  onClose,
  onRegistered,
}: Props) {
  const opts = options;
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState<AISystemRegistrationRead | null>(null);

  const {
    register,
    control,
    watch,
    setValue,
    getValues,
    trigger,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema) as Resolver<FormValues>,
    defaultValues: defaultValues(),
    mode: "onBlur",
  });

  // Kept in sync every render so the async submit handler below can read the
  // post-`trigger()` error tree without relying on a stale closure value.
  const errorsRef = useRef(errors);
  errorsRef.current = errors;

  const ownersArr = useFieldArray({ control, name: "owners" });
  const modelsArr = useFieldArray({ control, name: "models" });
  const endpointsArr = useFieldArray({ control, name: "endpoints" });
  const frameworksArr = useFieldArray({ control, name: "frameworks" });
  const dataSourcesArr = useFieldArray({ control, name: "dataSources" });
  const dependenciesArr = useFieldArray({ control, name: "dependencies" });
  const documentsArr = useFieldArray({ control, name: "documents" });

  const watched = watch();
  const selectedFrameworkIds = new Set(watched.frameworks.map((f) => f.framework_id));

  const modelNameOptions: OptionItem[] = useMemo(
    () =>
      watched.models
        .filter((m) => m.name && m.name.trim())
        .map((m) => ({ value: m.name!.trim(), label: m.name!.trim() })),
    [watched.models],
  );

  async function submit(intent: "draft" | "registered") {
    setValue("submitIntent", intent);
    setSubmitError(null);
    const valid = await trigger();
    if (!valid) {
      // Defer to the next tick so the re-render carrying the fresh error refs
      // (from the trigger() above) has landed before we read errorsRef.
      setTimeout(() => {
        findFirstErrorRef(errorsRef.current)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 0);
      return;
    }
    const payload = buildPayload(getValues());
    try {
      setIsSubmitting(true);
      const result = await registerAISystem(payload);
      setSuccess(result);
      onRegistered(result);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Unable to register AI system.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const toggleFramework = (framework_id: string) => {
    const idx = watched.frameworks.findIndex((f) => f.framework_id === framework_id);
    if (idx >= 0) frameworksArr.remove(idx);
    else frameworksArr.append({ framework_id, applicability_type: "unsure", applicability_note: "" });
  };

  const stage = (watched.system.lifecycle_stage || "").toLowerCase();
  const env = (watched.system.deployment_environment || "").toLowerCase();
  const endpointRequired = ENDPOINT_REQUIRED_STAGES.has(stage) || env === "production";
  const showRag = ragApplies(watched);
  const showAgent = agentApplies(watched);

  const missing = missingForRegister(watched, endpointRequired);

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center overflow-hidden px-4 py-4 sm:px-6">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[3px]" onClick={onClose} />
      <div className="relative z-10 flex h-[min(820px,calc(100vh-2rem))] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/10 dark:bg-slate-900 dark:ring-white/10">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div>
            <p className="text-[15px] font-semibold text-slate-950 dark:text-white">Register AI System</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Provide the facts you know about the system. The platform derives a preliminary risk tier and governance requirements later.
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {success ? (
          <SuccessPanel result={success} onClose={onClose} />
        ) : (
          <>
            <form className="min-h-0 flex-1 space-y-7 overflow-y-auto px-5 py-4">
              {/* 1. System Identity */}
              <section className="space-y-3">
                <SectionHeader title="System Identity" hint="Core facts about the system." />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="AI System Name *" error={errors.system?.name?.message}>
                    <input {...register("system.name")} placeholder="Customer Support Assistant" className={inputCls} />
                  </Field>
                  <Field label="Version" error={errors.system?.version?.message}>
                    <input {...register("system.version")} placeholder="v1" className={inputCls} />
                  </Field>
                  <Field label="System Type" error={errors.system?.system_type?.message}>
                    <Select options={opts?.system_types ?? []} {...register("system.system_type")} />
                  </Field>
                  <Field label="Business Domain" error={errors.system?.business_domain?.message}>
                    <Select options={opts?.business_domains ?? []} {...register("system.business_domain")} />
                  </Field>
                  <Field label="Lifecycle Stage" error={errors.system?.lifecycle_stage?.message}>
                    <Select options={opts?.lifecycle_stages ?? []} {...register("system.lifecycle_stage")} />
                  </Field>
                  <Field label="Deployment Environment" error={errors.system?.deployment_environment?.message}>
                    <Select options={opts?.deployment_environments ?? []} {...register("system.deployment_environment")} />
                  </Field>
                  <Field label="Modality">
                    <Select options={opts?.modalities ?? []} {...register("system.modality")} />
                  </Field>
                  <Field label="Production Criticality">
                    <Select options={opts?.production_criticalities ?? []} {...register("system.production_criticality")} />
                  </Field>
                </div>
                <Field label="Short Description" error={errors.system?.description?.message}>
                  <textarea {...register("system.description")} rows={2} placeholder="What the system does, in one or two sentences." className={clsx(inputCls, "resize-none")} />
                </Field>
                <Field label="Business Purpose" error={errors.system?.business_purpose?.message}>
                  <textarea {...register("system.business_purpose")} rows={2} placeholder="Why it exists / the business goal." className={clsx(inputCls, "resize-none")} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Business Unit"><input {...register("system.business_unit")} className={inputCls} /></Field>
                  <Field label="Product / Project"><input {...register("system.product_name")} className={inputCls} /></Field>
                  <Field label="Internal Identifier"><input {...register("system.internal_identifier")} className={inputCls} /></Field>
                </div>
              </section>

              {/* 2. Usage & Application Context */}
              <section className="space-y-3">
                <SectionHeader title="Usage & Application Context" hint="How the system is used and overseen." />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Intended Users *" error={errors.usage?.intended_users?.message}>
                    <input {...register("usage.intended_users")} placeholder="Internal employees" className={inputCls} />
                  </Field>
                  <Field label="Internal or External Use">
                    <Select options={opts?.internal_external_use ?? []} {...register("usage.internal_external_use")} />
                  </Field>
                  <Field label="Output Usage *" error={errors.usage?.output_usage?.message}>
                    <Select options={opts?.output_usage ?? []} {...register("usage.output_usage")} />
                  </Field>
                  <Field label="Human Oversight *" error={errors.usage?.human_oversight?.message}>
                    <Select options={opts?.human_oversight ?? []} {...register("usage.human_oversight")} />
                  </Field>
                </div>
                <Field label="Primary Use Case">
                  <textarea {...register("usage.primary_use_case")} rows={2} placeholder="The main task the system performs." className={clsx(inputCls, "resize-none")} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-3">
                  <CheckboxGroup label="Input Modalities" options={opts?.input_modalities ?? []} selected={watched.usage.input_modalities ?? []} onChange={(v) => setValue("usage.input_modalities", v)} />
                  <CheckboxGroup label="Output Types" options={opts?.output_types ?? []} selected={watched.usage.output_types ?? []} onChange={(v) => setValue("usage.output_types", v)} />
                  <CheckboxGroup label="Capabilities" options={opts?.capability_tags ?? []} selected={watched.usage.capabilities ?? []} onChange={(v) => setValue("usage.capabilities", v)} />
                </div>
              </section>

              {/* 3. Ownership */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <SectionHeader title="Ownership" hint="Primary system owner and technical owner are required to register." />
                  <AddButton label="Add owner" onClick={() => ownersArr.append({ role: "business_owner", name: "", email: "", is_primary: false })} />
                </div>
                {typeof errors.owners?.message === "string" && (
                  <p className="text-[10px] font-medium text-red-600 dark:text-red-400">{errors.owners.message}</p>
                )}
                <div className="space-y-3">
                  {ownersArr.fields.map((f, i) => (
                    <div key={f.id} className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3 sm:grid-cols-[1fr_1fr_1fr_auto] dark:border-slate-700 dark:bg-slate-800/40">
                      <Field label="Role">
                        <Select options={opts?.owner_roles ?? []} placeholder="Role" {...register(`owners.${i}.role` as const)} />
                      </Field>
                      <Field label="Name" error={errors.owners?.[i]?.name?.message}>
                        <input {...register(`owners.${i}.name` as const)} className={inputCls} />
                      </Field>
                      <Field label="Email" error={errors.owners?.[i]?.email?.message}>
                        <input {...register(`owners.${i}.email` as const)} placeholder="name@company.com" className={inputCls} />
                      </Field>
                      <div className="flex items-end pb-2">
                        {ownersArr.fields.length > 1 && (
                          <RemoveButton onClick={() => ownersArr.remove(i)} />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* 4. Models */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <SectionHeader title="Models" hint="At least one model is required to register." />
                  <AddButton label="Add model" onClick={() => modelsArr.append({ name: "", provider: "", model_type: "", version: "", purpose: "", is_third_party: true })} />
                </div>
                {typeof errors.models?.message === "string" && (
                  <p className="text-[10px] font-medium text-red-600 dark:text-red-400">{errors.models.message}</p>
                )}
                <div className="space-y-3">
                  {modelsArr.fields.map((f, i) => (
                    <div key={f.id} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">Model {i + 1}</p>
                        {modelsArr.fields.length > 1 && <RemoveButton onClick={() => modelsArr.remove(i)} />}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Model Name *" error={errors.models?.[i]?.name?.message}>
                          <input {...register(`models.${i}.name` as const)} placeholder="gpt-4o" className={inputCls} />
                        </Field>
                        <Field label="Provider *" error={errors.models?.[i]?.provider?.message}>
                          <Select options={opts?.model_providers ?? []} {...register(`models.${i}.provider` as const)} />
                        </Field>
                        <Field label="Model Type">
                          <Select options={opts?.model_types ?? []} {...register(`models.${i}.model_type` as const)} />
                        </Field>
                        <Field label="Version">
                          <input {...register(`models.${i}.version` as const)} className={inputCls} />
                        </Field>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* 5. Target API Endpoints */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <SectionHeader
                    title="Target API Endpoints"
                    hint={endpointRequired ? "At least one endpoint is required for staging/production." : "Optional at this lifecycle stage."}
                  />
                  <AddButton label="Add endpoint" onClick={() => endpointsArr.append({ name: "", url: "", http_method: "POST", environment: env || "development", status: "active", is_public: false, pii_allowed: false, purpose: "", model_ref: "", gateway_type: "", authentication_type: "", exposure_type: "" })} />
                </div>
                {typeof errors.endpoints?.message === "string" && (
                  <p className="text-[10px] font-medium text-red-600 dark:text-red-400">{errors.endpoints.message}</p>
                )}
                {endpointsArr.fields.length === 0 && (
                  <div className="rounded-lg border border-dashed border-slate-300 p-5 text-center text-[12px] text-slate-500 dark:border-slate-600 dark:text-slate-400">
                    No endpoints added.
                  </div>
                )}
                <div className="space-y-3">
                  {endpointsArr.fields.map((f, i) => (
                    <div key={f.id} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">Endpoint {i + 1}</p>
                        <RemoveButton onClick={() => endpointsArr.remove(i)} />
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Endpoint Name *" error={errors.endpoints?.[i]?.name?.message}>
                          <input {...register(`endpoints.${i}.name` as const)} placeholder="Chat" className={inputCls} />
                        </Field>
                        <Field label="Endpoint URL *" error={errors.endpoints?.[i]?.url?.message}>
                          <input {...register(`endpoints.${i}.url` as const)} placeholder="https://api.company.com/chat" className={inputCls} />
                        </Field>
                        <Field label="HTTP Method">
                          <Select options={opts?.http_methods ?? []} {...register(`endpoints.${i}.http_method` as const)} />
                        </Field>
                        <Field label="Connected Model">
                          <Select options={modelNameOptions} placeholder="—" {...register(`endpoints.${i}.model_ref` as const)} />
                        </Field>
                        <Field label="Gateway Type">
                          <Select options={opts?.gateway_types ?? []} {...register(`endpoints.${i}.gateway_type` as const)} />
                        </Field>
                        <Field label="Authentication Type">
                          <Select options={opts?.authentication_types ?? []} {...register(`endpoints.${i}.authentication_type` as const)} />
                        </Field>
                        <Field label="Exposure">
                          <Select options={opts?.exposure_types ?? []} {...register(`endpoints.${i}.exposure_type` as const)} />
                        </Field>
                        <Field label="Status">
                          <Select options={opts?.endpoint_statuses ?? []} {...register(`endpoints.${i}.status` as const)} />
                        </Field>
                      </div>
                      <div className="mt-2 flex gap-5">
                        <InlineCheckbox label="Publicly exposed" {...register(`endpoints.${i}.is_public` as const)} />
                        <InlineCheckbox label="PII allowed" {...register(`endpoints.${i}.pii_allowed` as const)} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* 6. Applicable Frameworks */}
              <section className="space-y-3">
                <SectionHeader title="Applicable Frameworks" hint="Only the frameworks the platform implements. Select the ones that apply." />
                {frameworksError ? (
                  <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-3 text-[12px] text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
                    <span>Could not load frameworks from the backend.</span>
                    <button type="button" onClick={onReloadFrameworks} className="rounded border border-red-300 px-2 py-1 text-[11px] font-semibold hover:bg-red-100 dark:border-red-700">Retry</button>
                  </div>
                ) : frameworks.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-300 p-5 text-center text-[12px] text-slate-500 dark:border-slate-600 dark:text-slate-400">
                    Loading frameworks…
                  </div>
                ) : (
                  <>
                    {typeof errors.frameworks?.message === "string" && (
                      <p className="text-[10px] font-medium text-red-600 dark:text-red-400">{errors.frameworks.message}</p>
                    )}
                    <div className="grid gap-2 sm:grid-cols-2">
                      {frameworks.map((fw) => {
                        const active = selectedFrameworkIds.has(fw.framework_id);
                        return (
                          <button
                            key={fw.framework_id}
                            type="button"
                            onClick={() => toggleFramework(fw.framework_id)}
                            className={clsx(
                              "rounded-lg border p-3 text-left transition-colors",
                              active
                                ? "border-brand-400 bg-brand-50/60 dark:border-brand-700 dark:bg-brand-950/20"
                                : "border-slate-200 hover:border-slate-400 dark:border-slate-700 dark:hover:border-slate-500",
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <input type="checkbox" checked={active} readOnly />
                              <span className="text-[13px] font-semibold text-slate-900 dark:text-white">{fw.framework_name}</span>
                              <span className="text-[10px] text-slate-400">v{fw.framework_version}</span>
                            </div>
                            <p className="mt-1 text-[11px] leading-4 text-slate-500 dark:text-slate-400">{fw.description}</p>
                          </button>
                        );
                      })}
                    </div>
                    {watched.frameworks.length > 0 && (
                      <div className="space-y-2">
                        {watched.frameworks.map((f, i) => {
                          const meta = frameworks.find((x) => x.framework_id === f.framework_id);
                          return (
                            <div key={f.framework_id} className="grid gap-2 rounded border border-slate-200 bg-slate-50/60 p-2 sm:grid-cols-[160px_180px_1fr] dark:border-slate-700 dark:bg-slate-800/40">
                              <span className="self-center text-[12px] font-medium text-slate-800 dark:text-slate-200">{meta?.framework_name ?? f.framework_id}</span>
                              <Select options={opts?.applicability_types ?? []} placeholder="Applicability" {...register(`frameworks.${i}.applicability_type` as const)} />
                              <input {...register(`frameworks.${i}.applicability_note` as const)} placeholder="Applicability note (optional)" className={inputCls} />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </section>

              {/* 7. Initial Risk Screening */}
              <section className="space-y-3">
                <SectionHeader title="Initial Risk Screening" hint="Factual yes/no/unknown questions. The backend derives a preliminary risk tier — you do not choose it." />
                <div className="space-y-1.5">
                  {RISK_QUESTIONS.map((q) => (
                    <div key={q.id} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded border border-slate-100 bg-slate-50/60 px-3 py-1.5 dark:border-slate-700/60 dark:bg-slate-800/40">
                      <span className="text-[11px] text-slate-700 dark:text-slate-300">{q.label}</span>
                      <div className="flex gap-3">
                        {(["yes", "no", "unknown"] as const).map((val) => (
                          <label key={val} className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-400">
                            <input type="radio" value={val} {...register(`riskAnswers.${q.id}` as const)} />
                            {val}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* 8. Data Sources & Privacy */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <SectionHeader title="Data Sources & Privacy" hint="Where the system's data comes from and what it contains." />
                  <AddButton label="Add data source" onClick={() => dataSourcesArr.append({ name: "", source_type: "", classification: "", usage_purpose: "", used_for_rag: false, external_sharing: false, contains_personal_data: false, contains_sensitive_personal_data: false, contains_confidential_data: false, contains_health_data: false, contains_financial_data: false, contains_biometric_data: false, contains_minors_data: false })} />
                </div>
                {dataSourcesArr.fields.length === 0 && (
                  <div className="rounded-lg border border-dashed border-slate-300 p-5 text-center text-[12px] text-slate-500 dark:border-slate-600 dark:text-slate-400">No data sources added.</div>
                )}
                <div className="space-y-3">
                  {dataSourcesArr.fields.map((f, i) => (
                    <div key={f.id} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">Data source {i + 1}</p>
                        <RemoveButton onClick={() => dataSourcesArr.remove(i)} />
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Name *" error={errors.dataSources?.[i]?.name?.message}>
                          <input {...register(`dataSources.${i}.name` as const)} className={inputCls} />
                        </Field>
                        <Field label="Type"><Select options={opts?.data_source_types ?? []} {...register(`dataSources.${i}.source_type` as const)} /></Field>
                        <Field label="Classification"><Select options={opts?.data_classifications ?? []} {...register(`dataSources.${i}.classification` as const)} /></Field>
                        <Field label="Usage Purpose"><Select options={opts?.data_usage_purposes ?? []} {...register(`dataSources.${i}.usage_purpose` as const)} /></Field>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-x-5 gap-y-1 sm:grid-cols-3">
                        <InlineCheckbox label="Used for RAG" {...register(`dataSources.${i}.used_for_rag` as const)} />
                        <InlineCheckbox label="External sharing" {...register(`dataSources.${i}.external_sharing` as const)} />
                        <InlineCheckbox label="Personal data" {...register(`dataSources.${i}.contains_personal_data` as const)} />
                        <InlineCheckbox label="Sensitive data" {...register(`dataSources.${i}.contains_sensitive_personal_data` as const)} />
                        <InlineCheckbox label="Confidential" {...register(`dataSources.${i}.contains_confidential_data` as const)} />
                        <InlineCheckbox label="Health data" {...register(`dataSources.${i}.contains_health_data` as const)} />
                        <InlineCheckbox label="Financial data" {...register(`dataSources.${i}.contains_financial_data` as const)} />
                        <InlineCheckbox label="Biometric data" {...register(`dataSources.${i}.contains_biometric_data` as const)} />
                        <InlineCheckbox label="Minors' data" {...register(`dataSources.${i}.contains_minors_data` as const)} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* 9. RAG Configuration (conditional) */}
              {showRag && (
                <section className="space-y-3">
                  <SectionHeader title="RAG Configuration" hint="Shown because this is a RAG system or a data source is used for retrieval." />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Knowledge Base Name"><input {...register("rag.knowledge_base_name")} className={inputCls} /></Field>
                    <Field label="Vector Database"><input {...register("rag.vector_database")} placeholder="qdrant / azure ai search" className={inputCls} /></Field>
                    <Field label="Embedding Model"><input {...register("rag.embedding_model")} className={inputCls} /></Field>
                    <Field label="Reranking Model"><input {...register("rag.reranking_model")} className={inputCls} /></Field>
                    <Field label="Retrieval Strategy"><input {...register("rag.retrieval_strategy")} placeholder="hybrid / semantic" className={inputCls} /></Field>
                    <Field label="Top-K" error={errors.rag?.top_k?.message}><input type="number" min={0} {...register("rag.top_k")} className={inputCls} /></Field>
                    <Field label="Document Refresh Frequency"><input {...register("rag.document_refresh_frequency")} placeholder="daily / weekly" className={inputCls} /></Field>
                  </div>
                  <div className="flex gap-5">
                    <InlineCheckbox label="Citations enabled" {...register("rag.citations_enabled")} />
                    <InlineCheckbox label="Access control applied during retrieval" {...register("rag.access_control_applied")} />
                  </div>
                </section>
              )}

              {/* 10. Agent Configuration (conditional) */}
              {showAgent && (
                <section className="space-y-3">
                  <SectionHeader title="Agent Configuration" hint="Shown because this is an agent or has tool-execution / autonomous-planning capabilities." />
                  <Field label="Agent Purpose"><textarea {...register("agent.agent_purpose")} rows={2} className={clsx(inputCls, "resize-none")} /></Field>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Number of Agents" error={errors.agent?.num_agents?.message}><input type="number" min={0} {...register("agent.num_agents")} className={inputCls} /></Field>
                    <Field label="Max Steps" error={errors.agent?.max_steps?.message}><input type="number" min={0} {...register("agent.max_steps")} className={inputCls} /></Field>
                    <Field label="Max Execution (s)" error={errors.agent?.max_execution_seconds?.message}><input type="number" min={0} {...register("agent.max_execution_seconds")} className={inputCls} /></Field>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Tools Used" hint="Comma-separated"><input {...register("agent.tools_used")} placeholder="search, email, calculator" className={inputCls} /></Field>
                    <Field label="External Systems Accessed" hint="Comma-separated"><input {...register("agent.external_systems")} placeholder="CRM, ticketing" className={inputCls} /></Field>
                  </div>
                  <div className="grid grid-cols-2 gap-x-5 gap-y-1 sm:grid-cols-3">
                    <InlineCheckbox label="Read access" {...register("agent.read_access")} />
                    <InlineCheckbox label="Write access" {...register("agent.write_access")} />
                    <InlineCheckbox label="Can send messages" {...register("agent.can_send_messages")} />
                    <InlineCheckbox label="Can modify files" {...register("agent.can_modify_files")} />
                    <InlineCheckbox label="Can write to DB" {...register("agent.can_write_database")} />
                    <InlineCheckbox label="Can execute code" {...register("agent.can_execute_code")} />
                    <InlineCheckbox label="Human approval required" {...register("agent.human_approval_required")} />
                    <InlineCheckbox label="Persistent memory" {...register("agent.persistent_memory_enabled")} />
                  </div>
                </section>
              )}

              {/* 11. Security Posture */}
              <section className="space-y-3">
                <SectionHeader title="Security Posture" hint="Developer-reported implementation status. Leave blank if not assessed." />
                <div className="grid gap-2 sm:grid-cols-2">
                  {(opts?.security_controls ?? []).map((ctrl) => (
                    <div key={ctrl.value} className="grid grid-cols-[1fr_150px] items-center gap-2 rounded border border-slate-100 bg-slate-50/60 px-3 py-1.5 dark:border-slate-700/60 dark:bg-slate-800/40">
                      <span className="text-[11px] text-slate-700 dark:text-slate-300">{ctrl.label}</span>
                      <Select options={opts?.security_statuses ?? []} placeholder="—" {...register(`security.${ctrl.value}` as const)} />
                    </div>
                  ))}
                </div>
              </section>

              {/* 12. Dependencies */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <SectionHeader title="Dependencies & Vendors" hint="External services the system relies on." />
                  <AddButton label="Add dependency" onClick={() => dependenciesArr.append({ name: "", service_purpose: "", dependency_type: "", data_shared: "", hosting_region: "", is_critical: false, is_third_party_api: false, contract_sla_available: false, exit_option: "" })} />
                </div>
                {dependenciesArr.fields.length === 0 && (
                  <div className="rounded-lg border border-dashed border-slate-300 p-5 text-center text-[12px] text-slate-500 dark:border-slate-600 dark:text-slate-400">No dependencies added.</div>
                )}
                <div className="space-y-3">
                  {dependenciesArr.fields.map((f, i) => (
                    <div key={f.id} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">Dependency {i + 1}</p>
                        <RemoveButton onClick={() => dependenciesArr.remove(i)} />
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Vendor / Service *" error={errors.dependencies?.[i]?.name?.message}>
                          <input {...register(`dependencies.${i}.name` as const)} placeholder="Azure OpenAI" className={inputCls} />
                        </Field>
                        <Field label="Type"><Select options={opts?.dependency_types ?? []} {...register(`dependencies.${i}.dependency_type` as const)} /></Field>
                        <Field label="Service Purpose"><input {...register(`dependencies.${i}.service_purpose` as const)} className={inputCls} /></Field>
                        <Field label="Hosting Region"><input {...register(`dependencies.${i}.hosting_region` as const)} className={inputCls} /></Field>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-5">
                        <InlineCheckbox label="Critical dependency" {...register(`dependencies.${i}.is_critical` as const)} />
                        <InlineCheckbox label="Third-party API" {...register(`dependencies.${i}.is_third_party_api` as const)} />
                        <InlineCheckbox label="Contract / SLA available" {...register(`dependencies.${i}.contract_sla_available` as const)} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* 13. Documents */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <SectionHeader title="Documents" hint="Optional. Record document metadata now; files can be attached later." />
                  <AddButton label="Add document" onClick={() => documentsArr.append({ name: "", document_type: "", version: "", document_owner: "", related_framework: "", confidentiality_level: "", notes: "" })} />
                </div>
                {documentsArr.fields.length === 0 && (
                  <div className="rounded-lg border border-dashed border-slate-300 p-5 text-center text-[12px] text-slate-500 dark:border-slate-600 dark:text-slate-400">No documents added.</div>
                )}
                <div className="space-y-3">
                  {documentsArr.fields.map((f, i) => (
                    <div key={f.id} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">Document {i + 1}</p>
                        <RemoveButton onClick={() => documentsArr.remove(i)} />
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Document Name *" error={errors.documents?.[i]?.name?.message}>
                          <input {...register(`documents.${i}.name` as const)} className={inputCls} />
                        </Field>
                        <Field label="Type"><Select options={opts?.document_types ?? []} {...register(`documents.${i}.document_type` as const)} /></Field>
                        <Field label="Version"><input {...register(`documents.${i}.version` as const)} className={inputCls} /></Field>
                        <Field label="Owner"><input {...register(`documents.${i}.document_owner` as const)} className={inputCls} /></Field>
                        <Field label="Confidentiality"><Select options={opts?.confidentiality_levels ?? []} {...register(`documents.${i}.confidentiality_level` as const)} /></Field>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* 14. Review */}
              <section className="space-y-3">
                <SectionHeader title="Review" />
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    ["Name", `${watched.system.name || "—"} ${watched.system.version || ""}`.trim()],
                    ["Type", labelOf(opts?.system_types, watched.system.system_type)],
                    ["Domain", labelOf(opts?.business_domains, watched.system.business_domain)],
                    ["Lifecycle", labelOf(opts?.lifecycle_stages, watched.system.lifecycle_stage)],
                    ["Environment", labelOf(opts?.deployment_environments, watched.system.deployment_environment)],
                    ["Models", String(watched.models.filter((m) => m.name?.trim()).length)],
                    ["Endpoints", String(watched.endpoints.length)],
                    ["Frameworks", String(watched.frameworks.length)],
                    ["Data sources", String(watched.dataSources.length)],
                    ["Dependencies", String(watched.dependencies.length)],
                    ["Documents", String(watched.documents.length)],
                    ["RAG enabled", showRag ? "Yes" : "No"],
                    ["Agent enabled", showAgent ? "Yes" : "No"],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-start justify-between gap-3 rounded border border-slate-100 bg-slate-50/60 px-3 py-2 dark:border-slate-700/60 dark:bg-slate-800/40">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">{label}</span>
                      <span className="text-right text-[11px] font-medium text-slate-900 dark:text-white">{value}</span>
                    </div>
                  ))}
                </div>
                <div className={clsx(
                  "rounded-lg border px-3 py-2 text-[12px]",
                  missing.length === 0
                    ? "border-emerald-200 bg-emerald-50/60 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300"
                    : "border-amber-200 bg-amber-50/60 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-400",
                )}>
                  {missing.length === 0
                    ? "Ready to register — the preliminary risk tier is generated from your answers."
                    : `Missing to register: ${missing.join(", ")}.`}
                </div>
              </section>
            </form>

            {/* Footer */}
            <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-900">
              {submitError && (
                <p className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-[11px] leading-4 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">{submitError}</p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded border border-slate-300 px-4 py-2.5 text-[13px] font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => void submit("draft")}
                  className="rounded border border-slate-300 px-4 py-2.5 text-[13px] font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Save Draft
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => void submit("registered")}
                  className="flex flex-1 items-center justify-center gap-2 rounded bg-brand-600 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Register AI System
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function SuccessPanel({ result, onClose }: { result: AISystemRegistrationRead; onClose: () => void }) {
  const draft = result.registration_status === "draft";
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 overflow-y-auto p-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400">
        <Server className="h-7 w-7" />
      </div>
      <div>
        <p className="text-[16px] font-semibold text-slate-950 dark:text-white">
          {result.system.name} {draft ? "saved as draft" : "registered"}
        </p>
        <p className="mt-1 text-[12px] leading-5 text-slate-600 dark:text-slate-300">
          Preliminary risk tier generated from registration information.
        </p>
      </div>
      <div className="w-full rounded border border-slate-200 bg-slate-50 p-3 text-left dark:border-slate-700 dark:bg-slate-800">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {[
            ["Preliminary risk tier", result.preliminary_risk_tier.toUpperCase()],
            ["Risk score", `${result.preliminary_risk_score}`],
            ["Profile completeness", `${result.profile_completeness}%`],
            ["Models / Endpoints", `${result.models.length} / ${result.endpoints.length}`],
            ["Frameworks", `${result.frameworks.length}`],
            ["Capabilities", `${result.capabilities.length}`],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</p>
              <p className="text-[12px] font-medium text-slate-950 dark:text-white">{value}</p>
            </div>
          ))}
        </div>
        {result.triggered_risk_factors.length > 0 && (
          <p className="mt-3 text-[11px] leading-4 text-slate-500 dark:text-slate-400">
            <span className="font-semibold">Triggered factors:</span> {result.triggered_risk_factors.join("; ")}
          </p>
        )}
      </div>
      <button
        onClick={onClose}
        className="w-full rounded bg-[#111827] py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-slate-800"
      >
        Back to Registry
      </button>
    </div>
  );
}

function CheckboxGroup({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: OptionItem[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold text-slate-700 dark:text-slate-300">{label}</p>
      <div className="max-h-36 space-y-1 overflow-y-auto rounded border border-slate-200 p-2 dark:border-slate-700">
        {options.map((o) => {
          const checked = selected.includes(o.value);
          return (
            <label key={o.value} className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-400">
              <input
                type="checkbox"
                checked={checked}
                onChange={() =>
                  onChange(checked ? selected.filter((v) => v !== o.value) : [...selected, o.value])
                }
              />
              {o.label}
            </label>
          );
        })}
      </div>
    </div>
  );
}

const InlineCheckbox = ({ label, ...rest }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) => (
  <label className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-400">
    <input type="checkbox" {...rest} />
    {label}
  </label>
);

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-brand-300 bg-brand-50/50 px-3 py-1.5 text-[12px] font-semibold text-brand-700 transition hover:bg-brand-50 dark:border-brand-800 dark:bg-brand-950/20 dark:text-brand-300"
    >
      <Plus className="h-3.5 w-3.5" /> {label}
    </button>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title="Remove" className="rounded p-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30">
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}

function labelOf(options: OptionItem[] | undefined, value: string | undefined): string {
  if (!value) return "—";
  return options?.find((o) => o.value === value)?.label ?? value;
}

// Lightweight live "missing fields" summary for the Review section (mirrors the
// register-intent Zod rules; the backend remains the source of truth).
function missingForRegister(v: FormValues, endpointRequired: boolean): string[] {
  const m: string[] = [];
  if (!v.system.name) m.push("name");
  if (!v.system.version) m.push("version");
  if (!v.system.description) m.push("description");
  if (!v.system.business_purpose) m.push("business purpose");
  if (!v.system.system_type) m.push("system type");
  if (!v.system.business_domain) m.push("domain");
  if (!v.system.lifecycle_stage) m.push("lifecycle stage");
  if (!v.usage.intended_users) m.push("intended users");
  if (!v.usage.output_usage) m.push("output usage");
  if (!v.usage.human_oversight) m.push("human oversight");
  const primary = v.owners.find((o) => o.is_primary) ?? v.owners.find((o) => o.role === "system_owner");
  if (!(primary && primary.name && primary.email)) m.push("primary owner");
  const tech = v.owners.find((o) => o.role === "technical_owner");
  if (!(tech && tech.name && tech.email)) m.push("technical owner");
  if (v.models.filter((x) => x.name?.trim()).length === 0) m.push("a model");
  if (v.frameworks.length === 0) m.push("a framework");
  if (endpointRequired && v.endpoints.length === 0) m.push("an endpoint");
  return m;
}
