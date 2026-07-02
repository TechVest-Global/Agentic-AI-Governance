import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Download,
  ExternalLink,
  Info,
  ListChecks,
  Loader2,
  Pencil,
  Play,
  Plus,
  Server,
  ShieldAlert,
  Trash2,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import clsx from "clsx";
import { Badge, toneForRisk, toneForStatus } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { MetricCard } from "@/components/ui/MetricCard";
import { DetailDrawer } from "@/components/layout/DetailDrawer";
import { useAppStore } from "@/store/useAppStore";
import { useAuthStore } from "@/store/useAuthStore";
import { useSelectionStore } from "@/store/useSelectionStore";
import { personaForRole } from "@/lib/persona";
import { useEvaluationRunner } from "@/hooks/useEvaluationRunner";
import {
  createAISystem,
  createAISystemCapability,
  createTargetEndpoint,
  deleteAISystem,
  deleteTargetEndpoint,
  getContextProfile,
  listAISystems,
  listCapabilities,
  listMetrics,
  listTargetEndpoints,
  updateAISystem,
  updateTargetEndpoint,
  type BackendAISystem,
  type BackendAISystemCapabilityCreate,
  type BackendAISystemCreate,
  type BackendTargetEndpoint,
  type BackendTargetEndpointCreate,
  type MetricConfig,
} from "@/api/governanceApi";
import type { ContextProfile } from "@/api/governanceApi";

const frameworkDescriptions: Record<string, string> = {
  "EU AI Act": "European Union regulation for high-risk AI systems. Mandates conformity assessments, technical documentation, and deployer obligations.",
  "SR 11-7": "Federal Reserve supervisory guidance on model risk management. Requires validation, governance, and independent review.",
  "NIST AI RMF": "NIST framework for managing AI risk across govern, map, measure, and manage functions.",
  "ISO 42001": "International standard for AI management systems. Covers governance, risk, and continual improvement.",
  "OECD AI Principles": "2024 international AI principles covering inclusive growth, human-centred values, transparency, robustness, and accountability. Used as the ethical capstone layer.",
  "OWASP LLM Top 10": "Security risks specific to large language models: prompt injection, insecure output handling, data poisoning, and more.",
  "MITRE ATLAS": "Adversarial threat landscape for AI systems — attack tactics, techniques, and case studies.",
  "HIPAA": "Health Insurance Portability and Accountability Act. Controls for PHI use in AI-assisted healthcare workflows.",
};

const verdictDescriptions: Record<string, { label: string; description: string; color: string }> = {
  Pass: { label: "Autonomous Tier", description: "No critical findings. System may operate without mandatory human-in-the-loop approval.", color: "text-emerald-700" },
  Medium: { label: "Supervised Tier", description: "Active findings require human oversight. Decisions should be reviewed before high-consequence actions.", color: "text-amber-700" },
  Blocked: { label: "Blocked", description: "Critical finding or compliance gap prevents production operation. Remediation required before re-evaluation.", color: "text-red-700" },
};

const columnDescriptions: Record<string, string> = {
  System: "Registered application, version, and usage level.",
  Domain: "Business domain the system operates within.",
  Env: "Deployment environment: Production, Shadow (parallel monitoring), or Staging.",
  "Risk Tier": "Regulatory risk classification. High-risk systems face stricter EU AI Act requirements.",
  Owner: "Accountable team responsible for governance sign-off.",
  Frameworks: "Frameworks selected for this application's governance runs.",
  Status: "Current operational status of the AI system.",
  Actions: "Update details or run a governance evaluation. Technical edit and delete are developer-only.",
};

const riskTiers = ["High", "Medium", "Low"] as const;
const domains = ["Customer Operations", "Knowledge Management", "Finance", "Healthcare", "HR", "Fraud", "Legal", "Insurance", "Retail", "Other"];
const appTypes = ["RAG Chatbot", "Generative AI", "Predictive ML", "Classification", "NLP Pipeline", "Computer Vision", "Reinforcement Learning", "Recommender", "Other"];
const envOptions = ["Production", "Shadow", "Staging", "Development"];
const frameworkOptions = Object.keys(frameworkDescriptions);

type RegisterForm = {
  name: string;
  version: string;
  owner: string;
  domain: string;
  applicationType: string;
  environment: string;
  riskTier: string;
  users: string;
  shortDescription: string;
  frameworks: string[];
  notes: string;
  modelProvider: string;
  modelName: string;
  endpoint: string;
  capabilityName: string;
};

type RegistrySystem = {
  id: string;
  name: string;
  version: string;
  users: string;
  applicationType: string;
  domain: string;
  environment: string;
  riskTier: "High" | "Medium" | "Low";
  owner: string;
  lastRun: string;
  verdict: "Pass" | "Medium" | "Blocked";
  confidence: number;
  nextReview: string;
  status: string;
  description?: string | null;
  endpoint?: string | null;
  modelProvider: string;
  modelName?: string | null;
  frameworks: string[];
};

const emptyForm: RegisterForm = {
  name: "", version: "", owner: "", domain: "",
  applicationType: "", environment: "", riskTier: "",
  users: "", shortDescription: "", frameworks: [], notes: "",
  modelProvider: "azure_foundry", modelName: "", endpoint: "", capabilityName: "Chat response generation",
};

function labelize(value: string | null | undefined) {
  if (!value) return "Not set";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function mapRiskTier(value: string): "low" | "medium" | "high" {
  const normalized = value.toLowerCase();
  if (normalized === "high") return "high";
  if (normalized === "low" || normalized === "minimal") return "low";
  return "medium";
}

function mapBackendRisk(value: BackendAISystem["risk_tier"]): RegistrySystem["riskTier"] {
  if (value === "high") return "High";
  if (value === "low") return "Low";
  return "Medium";
}

function normalizeFramework(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

const frameworkLabelById = new Map(frameworkOptions.map((label) => [normalizeFramework(label), label]));

function frameworkToLabel(value: string) {
  return frameworkLabelById.get(value) ?? value;
}

function systemToForm(system: BackendAISystem): RegisterForm {
  const metadata = system.metadata_json ?? {};
  return {
    name: system.name,
    version: system.model_version ?? "v1",
    owner: system.owner,
    domain: typeof metadata.domain === "string" ? metadata.domain : "Other",
    applicationType: labelize(system.system_type),
    environment: labelize(system.deployment_environment),
    riskTier: mapBackendRisk(system.risk_tier),
    users: typeof metadata.daily_active_users === "string" ? metadata.daily_active_users : "",
    shortDescription: typeof metadata.short_description === "string" ? metadata.short_description : "",
    frameworks: system.selected_frameworks.map(frameworkToLabel),
    notes: system.description ?? "",
    modelProvider: system.model_provider,
    modelName: system.model_name ?? "",
    endpoint: system.target_endpoint_ref ?? "",
    capabilityName: "Chat response generation",
  };
}

function mapStatus(value: BackendAISystem["status"]): string {
  if (value === "registered") return "Registered";
  if (value === "active") return "Active";
  if (value === "inactive") return "Inactive";
  return "Archived";
}

function mapBackendSystem(system: BackendAISystem): RegistrySystem {
  const metadata = system.metadata_json ?? {};
  return {
    id: system.id,
    name: system.name,
    version: system.model_version ?? "v1",
    users: typeof metadata.daily_active_users === "string" ? metadata.daily_active_users : "Not provided",
    applicationType: labelize(system.system_type),
    domain: typeof metadata.domain === "string" ? metadata.domain : "Other",
    environment: labelize(system.deployment_environment),
    riskTier: mapBackendRisk(system.risk_tier),
    owner: system.owner,
    lastRun: "No run yet",
    verdict: "Medium",
    confidence: 0,
    nextReview: "Not scheduled",
    status: mapStatus(system.status),
    description: system.description,
    endpoint: system.target_endpoint_ref,
    modelProvider: system.model_provider,
    modelName: system.model_name,
    frameworks: system.selected_frameworks,
  };
}

function buildCapabilityPayload(form: RegisterForm): BackendAISystemCapabilityCreate {
  return {
    name: form.capabilityName.trim() || "Chat response generation",
    description: "Read-only target chatbot capability registered from the governance portal.",
    capability_type: "generation",
    endpoint_ref: form.endpoint.trim(),
    http_method: "POST",
    input_schema: {
      type: "object",
      required: ["message"],
      properties: {
        message: { type: "string" },
        session_id: { type: "string" },
      },
    },
    output_schema: {
      type: "object",
      properties: {
        response: { type: "string" },
        session_id: { type: "string" },
        suggested_questions: { type: "array", items: { type: "string" } },
      },
    },
    permissions: ["target:invoke"],
    side_effect_level: "none",
    requires_human_review: false,
    enabled: true,
    metadata_json: {
      registered_from: "frontend_portal",
      target_kind: "chatbot",
    },
  };
}

function buildSystemPayload(form: RegisterForm): BackendAISystemCreate {
  return {
    name: form.name.trim(),
    description: form.notes.trim() || null,
    owner: form.owner.trim(),
    system_type: normalizeFramework(form.applicationType || "other"),
    risk_tier: mapRiskTier(form.riskTier),
    deployment_environment: normalizeFramework(form.environment || "local"),
    selected_frameworks: form.frameworks.map(normalizeFramework),
    model_provider: normalizeFramework(form.modelProvider || "azure_foundry"),
    model_name: form.modelName.trim() || null,
    model_version: form.version.trim() || null,
    target_endpoint_ref: form.endpoint.trim() || null,
    metadata_json: {
      domain: form.domain,
      daily_active_users: form.users || "Not provided",
      short_description: form.shortDescription.trim() || "",
      registered_from: "frontend_portal",
    },
  };
}

// ─── Setup readiness ─────────────────────────────────────────────────────────

type ReadyState = "ok" | "missing" | "optional";

type ReadinessItem = {
  key: string;
  label: string;
  state: ReadyState;
  detail: string; // short, shown on the page
  help: string; // long, shown in the side drawer
  table: string;
  endpoint: string;
  fixPage?: string;
  fixLabel?: string;
};

type ReadinessExtras = {
  hasProfile: boolean;
  capabilityCount: number;
  metricCount: number;
  endpointCount: number;
};

function computeReadiness(s: BackendAISystem, extra: ReadinessExtras): ReadinessItem[] {
  const hasIdentity = Boolean(s.name && s.owner && s.system_type);
  // A target is present if a registered endpoint exists OR the legacy ref is set.
  const hasEndpoint = extra.endpointCount > 0 || Boolean(s.target_endpoint_ref);
  const hasBoundary = Boolean(s.model_provider) && hasEndpoint;
  return [
    {
      key: "identity",
      label: "Basic system identity",
      state: hasIdentity ? "ok" : "missing",
      detail: hasIdentity ? `${s.name} · ${labelize(s.system_type)} · ${s.owner}` : "Name, owner, or type missing",
      help: "Identity is the anchor record for the whole governance run — every layer, finding, and ledger entry is keyed to this system id. It also sets ownership accountability for sign-off.",
      table: "ai_systems",
      endpoint: "POST /api/v1/ai-systems",
      fixPage: "/system-setup",
      fixLabel: "Open setup",
    },
    {
      key: "functionality",
      label: "Application functionality",
      state: s.description ? "ok" : "missing",
      detail: s.description ? "Purpose & behaviour described" : "No description / use case",
      help: "A short description of what the application does and how it is used. The orchestrator and Compliance Mapper use it to decide which regulatory obligations and probes apply.",
      table: "ai_systems",
      endpoint: "PATCH /api/v1/ai-systems/{id}",
      fixPage: "/system-setup",
      fixLabel: "Edit details",
    },
    {
      key: "frameworks",
      label: "Frameworks selected",
      state: s.selected_frameworks.length ? "ok" : "missing",
      detail: s.selected_frameworks.length ? `${s.selected_frameworks.length} framework${s.selected_frameworks.length === 1 ? "" : "s"} selected` : "None selected",
      help: "Frameworks (EU AI Act, NIST AI RMF, ISO 42001, OWASP LLM Top 10, …) define which clauses, rubrics, and metrics apply. With none selected the run falls back to a minimal default metric spread.",
      table: "ai_systems.selected_frameworks",
      endpoint: "POST /api/v1/ai-systems",
      fixPage: "/framework-mapping",
      fixLabel: "Framework mapping",
    },
    {
      key: "context-profile",
      label: "Application context profile",
      state: extra.hasProfile ? "ok" : "missing",
      detail: extra.hasProfile ? "Sections A–E present" : "Not configured",
      help: "The five-section profile (A–E) tells agents how business rules, guardrails, and integrations shape the model in production. Without it, agents test a lab model — not the real application.",
      table: "application_context_profiles",
      endpoint: "GET / PUT /api/v1/ai-systems/{id}/context-profile",
      fixPage: "/context-profiles",
      fixLabel: "Edit profile",
    },
    {
      key: "capabilities",
      label: "Capabilities",
      state: extra.capabilityCount ? "ok" : "missing",
      detail: extra.capabilityCount ? `${extra.capabilityCount} capability${extra.capabilityCount === 1 ? "" : "s"} registered` : "None registered",
      help: "Callable capabilities declare the endpoint, method, input/output schema, permissions, and side-effect level the engine may invoke on the target. At least one is needed for agents to probe it.",
      table: "ai_system_capabilities",
      endpoint: "GET / POST /api/v1/ai-systems/{id}/capabilities",
      fixPage: "/capabilities",
      fixLabel: "Open capabilities",
    },
    {
      key: "endpoint",
      label: "Target endpoint",
      state: hasEndpoint ? "ok" : "missing",
      detail: hasEndpoint
        ? extra.endpointCount > 0
          ? `${extra.endpointCount} endpoint${extra.endpointCount === 1 ? "" : "s"} registered`
          : (s.target_endpoint_ref as string)
        : "Not set",
      help: "One or more HTTP endpoints the application is reachable at (prod, staging, regional instances). A run probes the default endpoint unless it names another. Endpoint API keys are encrypted at rest and never returned by the API.",
      table: "target_endpoints",
      endpoint: "GET / POST /api/v1/ai-systems/{id}/target-endpoints",
      fixPage: "/system-setup",
      fixLabel: "Open setup",
    },
    {
      key: "boundary",
      label: "Client boundary",
      state: hasBoundary ? "ok" : "missing",
      detail: hasBoundary ? `Governance ↔ ${labelize(s.model_provider)} target` : "Provider or endpoint missing",
      help: "The two-client firewall: a governance LLM client and the isolated target-model client. Target output is sanitized before any agent reads it, so a compromised model cannot manipulate governance reasoning.",
      table: "llm_call_logs",
      endpoint: "GET /api/v1/evaluation-runs/{id}/llm-calls",
      fixPage: "/llm-boundary",
      fixLabel: "Inspect boundary",
    },
    {
      key: "metrics",
      label: "Metrics available",
      state: extra.metricCount ? "ok" : "missing",
      detail: extra.metricCount ? `${extra.metricCount} metrics match frameworks` : "No matching metrics",
      help: "The orchestrator selects metrics from the catalog whose framework coverage intersects this system's selected frameworks. Zero matches usually means no framework is selected.",
      table: "metric_configs · metric_results",
      endpoint: "GET /api/v1/metrics",
      fixPage: "/metrics-config",
      fixLabel: "Open metric catalog",
    },
    {
      key: "security-tools",
      label: "Security tools configured",
      state: "optional",
      detail: "Adapter layer (mock) — optional",
      help: "Security adapters (garak, PyRIT, Inspect AI, prompt-injection scanners, boundary tests) feed the Misuse Detector. Optional — they run in mock mode until the security backend route ships; a run can proceed without them.",
      table: "— adapter layer (no backend route yet)",
      endpoint: "Mock adapters",
      fixPage: "/security-tools",
      fixLabel: "Open adapters",
    },
  ];
}

function readinessSummary(items: ReadinessItem[]): { ready: boolean; missing: number } {
  const required = items.filter((i) => i.state !== "optional");
  const missing = required.filter((i) => i.state !== "ok").length;
  return { ready: missing === 0, missing };
}

function ReadyPill({ ready, missing, compact = false }: { ready: boolean; missing: number; compact?: boolean }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full font-semibold ring-1",
        compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]",
        ready
          ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:ring-emerald-800"
          : "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:ring-amber-800",
      )}
    >
      <span className={clsx("h-1.5 w-1.5 rounded-full", ready ? "bg-emerald-500" : "bg-amber-500")} />
      {ready ? "Ready to Run" : compact ? `Needs setup (${missing})` : `Needs Setup · ${missing} item${missing === 1 ? "" : "s"}`}
    </span>
  );
}

function ReadinessChecklist({ items, onItemHelp }: { items: ReadinessItem[]; onItemHelp: (item: ReadinessItem) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {items.map((item) => (
        <div
          key={item.key}
          className={clsx(
            "flex items-start gap-2.5 rounded-lg border px-3 py-2.5",
            item.state === "ok"
              ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/20"
              : item.state === "optional"
                ? "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50"
                : "border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20",
          )}
        >
          {item.state === "ok" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : item.state === "optional" ? (
            <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="text-[12px] font-semibold text-slate-900 dark:text-white">{item.label}</p>
              <button
                onClick={() => onItemHelp(item)}
                title="What is this?"
                className="text-slate-400 hover:text-brand-600 dark:text-slate-500 dark:hover:text-brand-400"
              >
                <Info className="h-3 w-3" />
              </button>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">{item.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function AISystems() {
  const navigateTo = useAppStore((state) => state.navigateTo);
  const role = useAuthStore((state) => state.user?.role);
  const persona = personaForRole(role);
  const focusRun = useSelectionStore((s) => s.focusRun);
  // Auditors own the assurance registry: they can register applications and
  // maintain the fields needed for governance runs.
  const canRegister = true;
  const canRun = true;
  const canEditTechnical = persona === "developer";
  const canDelete = persona === "developer";
  const [expandedSystem, setExpandedSystem] = useState<string | null>(null);
  const [hoveredFramework, setHoveredFramework] = useState<string | null>(null);
  const [hoveredColumn, setHoveredColumn] = useState<string | null>(null);
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingSystemId, setEditingSystemId] = useState<string | null>(null);
  const [registerForm, setRegisterForm] = useState<RegisterForm>(emptyForm);
  const [registerStep, setRegisterStep] = useState<"form" | "success">("form");
  const [backendSystems, setBackendSystems] = useState<BackendAISystem[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<RegistrySystem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const setHeaderHidden = useAppStore((state) => state.setHeaderHidden);
  const runner = useEvaluationRunner();
  // Per-system setup-readiness inputs (context profile + capabilities), plus the
  // shared metric catalog used to compute framework-matched metric availability.
  const [readinessExtras, setReadinessExtras] = useState<Record<string, { hasProfile: boolean; capabilityCount: number; endpointCount: number }>>({});
  const [metricsList, setMetricsList] = useState<MetricConfig[]>([]);
  const [helpItem, setHelpItem] = useState<ReadinessItem | null>(null);

  const handleRunEvaluation = useCallback(
    async (systemId: string) => {
      const system = backendSystems.find((s) => s.id === systemId);
      if (!system) return;
      const result = await runner.run(system, {
        onRunCreated: (run) => {
          focusRun(run.id, system.id);
          navigateTo("/runs");
        },
      });
      if (result) {
        // Keep every run-scoped tab on the completed run after orchestration.
        focusRun(result.run_id, system.id);
      }
    },
    // loadSystems is declared just below; runner.run is stable.
    [backendSystems, runner.run, navigateTo, focusRun],
  );

  const loadSystems = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError(null);
      const systems = await listAISystems();
      setBackendSystems(systems);
      // Readiness inputs the system record alone can't answer: context profile +
      // capabilities per system, and the shared metric catalog. Failures degrade
      // to "missing" rather than breaking the registry.
      const [metrics, perSystem] = await Promise.all([
        listMetrics().catch(() => [] as MetricConfig[]),
        Promise.all(
          systems.map(async (s) => {
            const [profile, caps, endpoints] = await Promise.all([
              getContextProfile(s.id).catch(() => null),
              listCapabilities(s.id).catch(() => []),
              listTargetEndpoints(s.id).catch(() => []),
            ]);
            return [
              s.id,
              {
                hasProfile: Boolean(profile),
                capabilityCount: caps.length,
                endpointCount: endpoints.length,
              },
            ] as const;
          }),
        ),
      ]);
      setMetricsList(metrics);
      setReadinessExtras(Object.fromEntries(perSystem));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load AI systems from backend.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSystems();
  }, [loadSystems]);

  useEffect(() => {
    setHeaderHidden(showRegisterForm);
    return () => setHeaderHidden(false);
  }, [showRegisterForm, setHeaderHidden]);

  const registrySystems = useMemo(() => backendSystems.map(mapBackendSystem), [backendSystems]);
  const readinessFor = useCallback(
    (systemId: string): ReadinessItem[] => {
      const backendSystem = backendSystems.find((b) => b.id === systemId);
      if (!backendSystem) return [];
      const extra = readinessExtras[systemId] ?? { hasProfile: false, capabilityCount: 0, endpointCount: 0 };
      const metricCount = metricsList.filter((m) => m.framework_ids.some((f) => backendSystem.selected_frameworks.includes(f))).length;
      return computeReadiness(backendSystem, { ...extra, metricCount });
    },
    [backendSystems, readinessExtras, metricsList],
  );
  const readyCount = useMemo(
    () => registrySystems.filter((s) => readinessSummary(readinessFor(s.id)).ready).length,
    [registrySystems, readinessFor],
  );
  const highRisk = registrySystems.filter((s) => s.riskTier === "High").length;
  const blocked = registrySystems.filter((s) => s.status === "Blocked").length;

  function openCreateModal() {
    setFormMode("create");
    setEditingSystemId(null);
    setRegisterForm(emptyForm);
    setRegisterStep("form");
    setSubmitError(null);
    setShowRegisterForm(true);
  }

  function openEditModal(systemId: string) {
    const system = backendSystems.find((item) => item.id === systemId);
    if (!system) return;
    setFormMode("edit");
    setEditingSystemId(systemId);
    setRegisterForm(systemToForm(system));
    setRegisterStep("form");
    setSubmitError(null);
    setShowRegisterForm(true);
  }

  async function handleSaveSubmit() {
    const payload = buildSystemPayload(registerForm);
    try {
      setIsSubmitting(true);
      setSubmitError(null);
      if (formMode === "edit" && editingSystemId) {
        await updateAISystem(editingSystemId, payload);
      } else {
        const createdSystem = await createAISystem(payload);
        if (canEditTechnical && registerForm.endpoint.trim()) {
          await createAISystemCapability(createdSystem.id, buildCapabilityPayload(registerForm));
        }
      }
      await loadSystems();
      setRegisterStep("success");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Unable to save AI system.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteConfirmed() {
    if (!deleteTarget || !canDelete) return;
    try {
      setIsDeleting(true);
      setDeleteError(null);
      await deleteAISystem(deleteTarget.id);
      if (expandedSystem === deleteTarget.id) {
        setExpandedSystem(null);
      }
      setDeleteTarget(null);
      await loadSystems();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Unable to delete AI system.");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      {showRegisterForm && (
        <RegisterSystemModal
          mode={formMode}
          form={registerForm}
          step={registerStep}
          onChange={(field, value) => setRegisterForm((prev) => ({ ...prev, [field]: value }))}
          onToggleFramework={(fw) =>
            setRegisterForm((prev) => ({
              ...prev,
              frameworks: prev.frameworks.includes(fw)
                ? prev.frameworks.filter((f) => f !== fw)
                : [...prev.frameworks, fw],
            }))
          }
          onSubmit={handleSaveSubmit}
          onClose={() => setShowRegisterForm(false)}
          canEditTechnical={canEditTechnical}
          isSubmitting={isSubmitting}
          error={submitError}
        />
      )}
      {deleteTarget && canDelete && (
        <DeleteSystemDialog
          system={deleteTarget}
          isDeleting={isDeleting}
          error={deleteError}
          onCancel={() => {
            setDeleteTarget(null);
            setDeleteError(null);
          }}
          onConfirm={handleDeleteConfirmed}
        />
      )}
      {helpItem && (
        <DetailDrawer
          open
          onClose={() => setHelpItem(null)}
          eyebrow="Setup step"
          title={helpItem.label}
          badge={
            <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1",
              helpItem.state === "ok" ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:ring-emerald-800"
              : helpItem.state === "optional" ? "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700"
              : "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:ring-amber-800")}>
              {helpItem.state === "ok" ? "Complete" : helpItem.state === "optional" ? "Optional" : "Needs setup"}
            </span>
          }
        >
          <p className="text-[13px] leading-6 text-slate-600 dark:text-slate-300">{helpItem.help}</p>

          <p className="mb-2 mt-6 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Current state</p>
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">{helpItem.detail}</p>

          <p className="mb-2 mt-6 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Backend table</p>
          <span className="inline-block rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">{helpItem.table}</span>

          <p className="mb-2 mt-6 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">API endpoint</p>
          <p className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-[11px] text-emerald-300">{helpItem.endpoint}</p>

          {helpItem.fixPage && (
            <button
              onClick={() => { const page = helpItem.fixPage!; setHelpItem(null); navigateTo(page); }}
              className="mt-6 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-[12px] font-semibold text-white hover:bg-brand-700"
            >
              {helpItem.fixLabel ?? "Configure"} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </DetailDrawer>
      )}
      {/* Page intro + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-700">
        <div>
          <p className="text-[15px] font-semibold text-slate-950 dark:text-white">
            AI application registry
          </p>
          <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
            Register the target application, assign frameworks, then run the governance audit.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            title="Export registry data as CSV or JSON"
            className="flex items-center gap-2 rounded border border-slate-300 bg-white px-3 py-2 text-[12px] font-medium text-slate-900 transition-colors hover:border-slate-400 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:bg-slate-700"
          >
            <Download className="h-4 w-4" /> Export
          </button>
          {canRegister && (
            <button
              title="Onboard a new AI system to the governance registry"
              onClick={openCreateModal}
              className="flex items-center gap-2 rounded bg-[#111827] px-3 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-slate-700"
            >
              <Plus className="h-4 w-4" /> Register Application
            </button>
          )}
        </div>
      </div>

      {loadError && (
        <div className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-[12px] leading-5 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          Backend registry is unavailable. Start the FastAPI backend, then refresh this page to view and register real AI applications.
          <span className="mt-1 block font-mono text-[11px] text-amber-800 dark:text-amber-400">{loadError}</span>
        </div>
      )}

      {/* Metric cards */}
      <div className="grid gap-3 md:grid-cols-4">
        <div title="Total AI systems onboarded to the governance registry" className="cursor-default">
          <MetricCard label="Registered Systems" value={registrySystems.length} icon={Server} compact />
        </div>
        <div title="Systems classified as High-Risk under applicable frameworks (e.g. EU AI Act Annex III)" className="cursor-default">
          <MetricCard label="High-Risk Tier" value={highRisk} icon={ShieldAlert} tone="red" compact />
        </div>
        <div title="Systems currently blocked from production operation due to unresolved critical findings" className="cursor-default">
          <MetricCard label="Blocked Systems" value={blocked} icon={AlertTriangle} tone="amber" compact />
        </div>
        <div title="Systems whose setup checklist is fully complete and ready to run a governance evaluation" className="cursor-default">
          <MetricCard label="Ready to Run" value={`${readyCount}/${registrySystems.length}`} icon={TrendingUp} tone="green" compact />
        </div>
      </div>

      {/* Registry table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-left">
            <thead className="bg-slate-50 dark:bg-slate-800">
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="w-6 px-3 py-2.5" />
                {Object.keys(columnDescriptions).map((heading) => (
                  <th
                    key={heading}
                    className="relative px-3 py-2.5 text-left"
                    onMouseEnter={() => setHoveredColumn(heading)}
                    onMouseLeave={() => setHoveredColumn(null)}
                  >
                    <span className="flex cursor-default items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white">
                      {heading}
                      <Info className="h-3 w-3 text-slate-400 dark:text-slate-500" />
                    </span>
                    {hoveredColumn === heading && (
                      <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded border border-slate-200 bg-white p-2.5 text-[11px] leading-4 text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {columnDescriptions[heading]}
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {registrySystems.map((system) => {
                const expanded = expandedSystem === system.id;
                const ready = readinessSummary(readinessFor(system.id));
                return (
                  <Fragment key={system.id}>
                    <tr
                      onClick={() => setExpandedSystem(expanded ? null : system.id)}
                      className={clsx(
                        "group cursor-pointer border-b border-slate-100 transition-colors dark:border-slate-700/50",
                        expanded ? "bg-brand-50/60 dark:bg-brand-900/20" : "hover:bg-slate-50 dark:hover:bg-slate-800/60"
                      )}
                    >
                      <td className="px-3 py-3 text-slate-400 dark:text-slate-500">
                        {expanded
                          ? <ChevronDown className="h-4 w-4 text-brand-600" />
                          : <ChevronRight className="h-4 w-4 group-hover:text-slate-700 dark:group-hover:text-slate-300" />}
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-mono text-[13px] font-semibold text-slate-950 dark:text-white">{system.name}</p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400">
                          <span>{system.version}</span>
                          <span>·</span>
                          <Users className="h-3 w-3" />
                          <span>{system.users} daily users</span>
                        </p>
                        <div className="mt-1.5">
                          <ReadyPill ready={ready.ready} missing={ready.missing} compact />
                        </div>
                      </td>
                      <td className="px-3 py-3 text-[12px] font-medium text-slate-950 dark:text-white">{system.domain}</td>
                      <td className="px-3 py-3">
                        <Badge tone="neutral">
                          {system.environment === "Production" ? "Active" : system.environment}
                        </Badge>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={toneForRisk(system.riskTier)}>{system.riskTier}</Badge>
                      </td>
                      <td className="px-3 py-3 text-[12px] text-slate-700 dark:text-slate-300">{system.owner}</td>
                      <td className="px-3 py-3">
                        <div className="flex max-w-[260px] flex-wrap gap-1.5">
                          {(system.frameworks.length ? system.frameworks : ["No frameworks"]).slice(0, 4).map((fw) => (
                            <Badge key={fw} tone="blue">{frameworkToLabel(fw)}</Badge>
                          ))}
                          {system.frameworks.length > 4 && <Badge tone="neutral">+{system.frameworks.length - 4}</Badge>}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={toneForStatus(system.status)}>{system.status}</Badge>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1.5">
                          <button
                            title={canEditTechnical ? "Edit AI application" : "Update application details"}
                            onClick={(event) => {
                              event.stopPropagation();
                              openEditModal(system.id);
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 transition-colors hover:border-blue-300 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          {canDelete && (
                            <button
                              title="Delete AI application"
                              onClick={(event) => {
                                event.stopPropagation();
                                setDeleteTarget(system);
                                setDeleteError(null);
                              }}
                              className="flex h-8 w-8 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 transition-colors hover:border-red-300 hover:text-red-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            title="Run governance evaluation"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleRunEvaluation(system.id);
                            }}
                            disabled={runner.status === "running" && runner.runningSystemId === system.id}
                            className="flex h-8 w-8 items-center justify-center rounded bg-brand-600 text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {runner.status === "running" && runner.runningSystemId === system.id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Play className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Inline expanded detail */}
                    {expanded && (
                      <tr key={`${system.id}-expanded`} className="border-b border-blue-100 bg-blue-50/60 dark:border-blue-900/40 dark:bg-blue-950/20">
                        <td colSpan={9} className="px-4 py-4">
                          <SystemDetail
                            system={system}
                            readinessItems={readinessFor(system.id)}
                            onItemHelp={setHelpItem}
                            onNavigate={navigateTo}
                            onClose={() => setExpandedSystem(null)}
                            onEdit={() => openEditModal(system.id)}
                            editLabel={canEditTechnical ? "Edit" : "Update Details"}
                            onDelete={() => {
                              setDeleteTarget(system);
                              setDeleteError(null);
                            }}
                            onRunEvaluation={() => handleRunEvaluation(system.id)}
                            running={runner.status === "running" && runner.runningSystemId === system.id}
                            runError={runner.status === "error" ? runner.error : null}
                            canManage={canRun}
                            canDelete={canDelete}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!isLoading && registrySystems.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center">
                    <p className="text-[14px] font-semibold text-slate-950 dark:text-white">No AI systems registered yet</p>
                    <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
                      Register the target AI application to start governance testing.
                    </p>
                  </td>
                </tr>
              )}
              {isLoading && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-[12px] text-slate-500 dark:text-slate-400">
                    Loading registered AI systems from backend...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="relative flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
        <p className="mr-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Frameworks</p>
        {Object.keys(frameworkDescriptions).map((fw) => (
          <span
            key={fw}
            onMouseEnter={() => setHoveredFramework(fw)}
            onMouseLeave={() => setHoveredFramework(null)}
            className="cursor-default rounded border border-slate-300 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-900 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
          >
            {fw}
          </span>
        ))}
        {hoveredFramework && (
          <div className="absolute bottom-full left-4 z-20 mb-2 max-w-xs rounded border border-slate-200 bg-white p-2.5 text-[11px] leading-4 text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            <p className="mb-1 font-semibold text-slate-950 dark:text-white">{hoveredFramework}</p>
            {frameworkDescriptions[hoveredFramework]}
          </div>
        )}
      </div>
    </div>
  );
}

function SystemDetail({
  system,
  readinessItems,
  onItemHelp,
  onNavigate,
  onClose,
  onEdit,
  editLabel,
  onDelete,
  onRunEvaluation,
  running,
  runError,
  canManage,
  canDelete,
}: {
  system: RegistrySystem;
  readinessItems: ReadinessItem[];
  onItemHelp: (item: ReadinessItem) => void;
  onNavigate: (path: string) => void;
  onClose: () => void;
  onEdit: () => void;
  editLabel: string;
  onDelete: () => void;
  onRunEvaluation: () => void;
  running: boolean;
  runError: string | null;
  canManage: boolean;
  canDelete: boolean;
}) {
  const [activeTab, setActiveTab] = useState<"Setup Readiness" | "Overview" | "Context Profile" | "Target Endpoints" | "Risk" | "Frameworks" | "Actions">("Setup Readiness");
  const verdict = verdictDescriptions[system.verdict];
  const tabs = ["Setup Readiness", "Overview", "Context Profile", "Target Endpoints", "Risk", "Frameworks", "Actions"] as const;
  const ready = readinessSummary(readinessItems);
  const missingItems = readinessItems.filter((i) => i.state === "missing");

  return (
    <div className="rounded-md border border-blue-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      {/* Detail header */}
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
        <div className="flex items-center gap-3">
          <div>
            <p className="font-mono text-[14px] font-bold text-slate-950 dark:text-white">{system.name}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {system.version} · {system.applicationType} · {system.domain}
            </p>
          </div>
          <Badge tone={toneForRisk(system.riskTier)}>{system.riskTier} Risk</Badge>
          <ReadyPill ready={ready.ready} missing={ready.missing} />
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <>
              <button
                onClick={onEdit}
                className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-800 transition-colors hover:border-blue-300 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <Pencil className="h-3.5 w-3.5" />
                {editLabel}
              </button>
              <button
                onClick={onRunEvaluation}
                disabled={running}
                className="flex items-center gap-1.5 rounded bg-brand-600 px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                {running ? "Running evaluation…" : "Run Evaluation"}
              </button>
              <button
                onClick={() => onNavigate("/runs")}
                className="flex items-center gap-1.5 rounded border border-blue-300 bg-blue-50 px-3 py-1.5 text-[12px] font-medium text-blue-800 transition-colors hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                View Live Run
              </button>
              {canDelete && (
                <button
                  onClick={onDelete}
                  className="flex items-center gap-1.5 rounded border border-red-200 bg-white px-3 py-1.5 text-[12px] font-medium text-red-700 transition-colors hover:bg-red-50 dark:border-red-900/60 dark:bg-slate-900 dark:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              )}
            </>
          )}
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      {runError && (
        <div className="border-b border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-4 py-2 text-[11px] text-red-700 dark:text-red-400">
          Evaluation failed: {runError}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 px-4 pt-2 dark:border-slate-700">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={clsx(
              "rounded-t border border-b-0 px-3 py-1.5 text-[12px] font-medium transition-colors",
              activeTab === tab
                ? "border-slate-300 bg-white text-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                : "border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-4">
        {activeTab === "Setup Readiness" && (
          <div className="space-y-4">
            <div className={clsx(
              "flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3",
              ready.ready
                ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/50 dark:bg-emerald-950/20"
                : "border-amber-200 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-950/20",
            )}>
              <div className="flex items-center gap-2.5">
                <ListChecks className={clsx("h-5 w-5", ready.ready ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")} />
                <div>
                  <p className="text-[13px] font-semibold text-slate-900 dark:text-white">
                    {ready.ready ? "All required setup steps complete" : `${ready.missing} required step${ready.missing === 1 ? "" : "s"} still ${ready.missing === 1 ? "needs" : "need"} setup`}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Click the ⓘ on any item for what it is, the backend table & endpoint, and how to fix it.</p>
                  {!ready.ready && missingItems.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-700 dark:text-amber-400">Still missing</span>
                      {missingItems.map((item) => (
                        <button
                          key={item.key}
                          onClick={() => onItemHelp(item)}
                          title={`${item.detail} — click for how to fix`}
                          className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-white px-2 py-0.5 text-[10px] font-medium text-amber-800 transition-colors hover:border-amber-400 hover:bg-amber-50 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-300 dark:hover:bg-amber-950/40"
                        >
                          <AlertTriangle className="h-2.5 w-2.5" />
                          {item.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {canManage && (
                <button
                  onClick={onRunEvaluation}
                  disabled={running || !ready.ready}
                  title={ready.ready ? "Run a governance evaluation" : "Complete required setup before running"}
                  className={clsx(
                    "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[12px] font-semibold text-white transition",
                    ready.ready && !running ? "bg-brand-600 hover:bg-brand-700" : "cursor-not-allowed bg-slate-300 dark:bg-slate-700",
                  )}
                >
                  {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  {running ? "Running…" : "Run Governance"}
                </button>
              )}
            </div>
            <ReadinessChecklist items={readinessItems} onItemHelp={onItemHelp} />
          </div>
        )}

        {activeTab === "Overview" && (
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="space-y-3">
              <SectionLabel>System Identity</SectionLabel>
              <InfoRow label="System ID" value={system.id} mono />
              <InfoRow label="Version" value={system.version} />
              <InfoRow label="Environment" value={system.environment} />
              <InfoRow label="Owner" value={system.owner} />
              <InfoRow label="Daily Users" value={system.users} />
            </div>
            <div className="space-y-3">
              <SectionLabel>Governance Status</SectionLabel>
              <InfoRow label="Last Run" value={system.lastRun} mono />
              <InfoRow label="Next Review" value={system.nextReview} mono />
              <InfoRow label="Confidence" value={`${system.confidence}%`} />
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-500">Verdict Meaning</p>
                <p className={clsx("mt-1 text-[12px] font-medium", verdict.color)}>{verdict.label}</p>
                <p className="mt-0.5 text-[11px] leading-4 text-slate-600 dark:text-slate-300">{verdict.description}</p>
              </div>
            </div>
            <div className="space-y-3">
              <SectionLabel>Application Profile</SectionLabel>
              <InfoRow label="Application Type" value={system.applicationType} />
              <InfoRow label="Domain" value={system.domain} />
              <InfoRow label="Risk Tier" value={system.riskTier} />
              <InfoRow label="Status" value={system.status} />
              <InfoRow label="Model Provider" value={labelize(system.modelProvider)} />
              <InfoRow label="Model Name" value={system.modelName ?? "Not set"} />
              <InfoRow label="Target Endpoint" value={system.endpoint ?? "Not set"} mono />
            </div>
          </div>
        )}

        {activeTab === "Context Profile" && (
          <AcpPanel systemId={system.id} />
        )}

        {activeTab === "Target Endpoints" && (
          <TargetEndpointsPanel systemId={system.id} canManage={canManage} />
        )}

        {activeTab === "Risk" && (
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <SectionLabel>Risk Tier Explanation</SectionLabel>
              <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                {system.riskTier === "High" && (
                  <p className="text-[12px] leading-5 text-slate-700 dark:text-slate-300">
                    <span className="font-semibold text-red-700">High Risk:</span> This system falls under EU AI Act Annex III. It must complete a conformity assessment, maintain an Annex IV technical file, and implement post-market monitoring. Deployers carry obligations under Art.26.
                  </p>
                )}
                {system.riskTier === "Medium" && (
                  <p className="text-[12px] leading-5 text-slate-700 dark:text-slate-300">
                    <span className="font-semibold text-amber-700">Medium Risk:</span> Not categorized as high-risk under Annex III but still subject to transparency obligations (Art.52) and internal model risk governance (SR 11-7). Requires periodic re-evaluation.
                  </p>
                )}
                {system.riskTier === "Low" && (
                  <p className="text-[12px] leading-5 text-slate-700 dark:text-slate-300">
                    <span className="font-semibold text-emerald-700">Low Risk:</span> Minimal regulatory exposure. Subject to voluntary codes of conduct and internal best practices. Standard logging and human oversight checkpoints apply.
                  </p>
                )}
              </div>
            </div>
            <div>
              <SectionLabel>Confidence Breakdown</SectionLabel>
              <div className="mt-2 space-y-2">
                {[
                  { label: "Bias & Fairness", val: system.confidence - 12 },
                  { label: "Compliance Coverage", val: system.confidence - 6 },
                  { label: "Drift Score", val: system.confidence + 4 },
                  { label: "Misuse Resistance", val: system.confidence + 10 },
                ].map((item) => (
                  <div key={item.label} className="grid grid-cols-[130px_1fr_36px] items-center gap-2">
                    <p className="text-[11px] text-slate-700 dark:text-slate-300">{item.label}</p>
                    <div className="h-1.5 rounded bg-slate-200 dark:bg-slate-700">
                      <div
                        className={clsx("h-full rounded", item.val >= 80 ? "bg-emerald-500" : item.val >= 60 ? "bg-amber-400" : "bg-red-500")}
                        style={{ width: `${Math.min(100, Math.max(0, item.val))}%` }}
                      />
                    </div>
                    <span className="text-right text-[11px] font-medium text-slate-950 dark:text-white">{Math.min(100, Math.max(0, item.val))}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === "Frameworks" && (
          <div>
            <SectionLabel>Applicable Governance Frameworks</SectionLabel>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {(system.frameworks.length ? system.frameworks : ["No frameworks selected"]).map((fw) => {
                const displayName = frameworkDescriptions[fw] ? fw : labelize(fw);
                return (
                  <div key={fw} className="rounded border border-slate-200 bg-slate-50 p-3 transition-colors hover:border-blue-300 hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-blue-700 dark:hover:bg-blue-950/30">
                    <p className="text-[12px] font-semibold text-slate-950 dark:text-white">{displayName}</p>
                    <p className="mt-1 text-[11px] leading-4 text-slate-600 dark:text-slate-300">
                      {frameworkDescriptions[fw] ?? "Stored with this registered AI system for future governance runs."}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === "Actions" && (
          <div className="grid gap-3 md:grid-cols-3">
            {[
              {
                label: "View Live Run",
                desc: "Open the active governance pipeline for this system with real-time agent status.",
                path: "/runs",
                icon: ExternalLink,
                tone: "blue",
              },
              {
                label: "View Agent Findings",
                desc: "Explore each specialist agent's probes, findings, and evidence for this system.",
                path: "/findings",
                icon: BookOpen,
                tone: "violet",
              },
              {
                label: "View Verdicts",
                desc: "See prescribed actions, confidence score, and tier assignment from the last run.",
                path: "/verdicts",
                icon: ShieldAlert,
                tone: "amber",
              },
            ].map((action) => (
              <button
                key={action.label}
                onClick={() => onNavigate(action.path)}
                className="group flex flex-col items-start gap-1.5 rounded border border-slate-200 bg-white p-3 text-left transition-all hover:border-blue-300 hover:bg-blue-50 hover:shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:hover:border-blue-700 dark:hover:bg-blue-950/30"
              >
                <action.icon className="h-4 w-4 text-blue-700" />
                <p className="text-[13px] font-semibold text-slate-950 group-hover:text-blue-800 dark:text-white dark:group-hover:text-blue-300">{action.label}</p>
                <p className="text-[11px] leading-4 text-slate-500 dark:text-slate-400">{action.desc}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const ACP_SECTIONS: Array<{ letter: string; title: string; owner: string; key: keyof ContextProfile }> = [
  { letter: "A", title: "Application Identity & Purpose", owner: "Orchestrator, Compliance Mapper", key: "identity_purpose" },
  { letter: "B", title: "Pre-Model Business Rules", owner: "Bias Auditor, Misuse Detector, Drift Analyst", key: "pre_model_controls" },
  { letter: "C", title: "Model Configuration", owner: "All probing agents", key: "model_configuration" },
  { letter: "D", title: "Post-Model Business Rules", owner: "Bias Auditor, Misuse Detector, Explainability Agent", key: "post_model_controls" },
  { letter: "E", title: "Integration Context", owner: "Risk Scorer", key: "integration_context" },
];

function formatAcpValue(value: unknown): string {
  if (value == null) return "Not provided";
  if (Array.isArray(value)) return value.length ? value.map(formatAcpValue).join(", ") : "None";
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function acpRows(section: Record<string, unknown> | undefined): [string, string][] {
  const rows = Object.entries(section ?? {}).map(([k, v]) => [labelize(k), formatAcpValue(v)] as [string, string]);
  return rows.length ? rows : [["Status", "No fields provided"]];
}

function AcpPanel({ systemId }: { systemId: string }) {
  const [activeSection, setActiveSection] = useState<string>("A");
  const [profile, setProfile] = useState<ContextProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getContextProfile(systemId)
      .then((p) => { if (!cancelled) setProfile(p); })
      .catch(() => { if (!cancelled) setProfile(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [systemId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded border border-slate-200 dark:border-slate-700 p-8 text-[12px] text-slate-500 dark:text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading context profile…
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="rounded border border-dashed border-slate-300 dark:border-slate-600 p-6 text-center">
        <p className="text-[13px] font-semibold text-slate-600 dark:text-slate-300">No context profile registered</p>
        <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">Fill in sections A–E before running a governance audit. The profile tells agents exactly how this system behaves in production.</p>
      </div>
    );
  }

  const activeConfig = ACP_SECTIONS.find((s) => s.letter === activeSection) ?? ACP_SECTIONS[0];
  const fields = acpRows(profile[activeConfig.key] as Record<string, unknown> | undefined);

  return (
    <div className="space-y-4">
      {/* Why mandatory callout */}
      <div className="rounded border border-brand-200 dark:border-brand-800/50 bg-brand-50 dark:bg-brand-950/20 px-4 py-2.5">
        <p className="text-[11px] leading-5 text-brand-800 dark:text-brand-300">
          <span className="font-semibold">Why this profile is mandatory.</span> Without it, agents test a model in a lab — not in production. The Bias Auditor needs Section B; the Risk Scorer needs Section E; the Council needs all five sections to produce verdicts that reflect production reality.
        </p>
      </div>

      {/* Section tabs + content */}
      <div className="rounded border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="flex">
          {/* Tab strip */}
          <div className="flex flex-col border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 shrink-0 py-1">
            {ACP_SECTIONS.map((s) => (
              <button
                key={s.letter}
                onClick={() => setActiveSection(s.letter)}
                className={clsx(
                  "flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors",
                  activeSection === s.letter
                    ? "bg-white dark:bg-slate-900 border-r-2 border-brand-500 -mr-px"
                    : "hover:bg-white/60 dark:hover:bg-slate-800"
                )}
              >
                <span className={clsx(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold",
                  activeSection === s.letter
                    ? "bg-brand-600 text-white"
                    : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400"
                )}>{s.letter}</span>
                <span className={clsx(
                  "text-[11px] font-medium whitespace-nowrap",
                  activeSection === s.letter ? "text-slate-900 dark:text-white" : "text-slate-500 dark:text-slate-400"
                )}>{s.title}</span>
              </button>
            ))}
          </div>

          {/* Section content */}
          <div className="flex-1 p-4 bg-white dark:bg-slate-900">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-[13px] font-semibold text-slate-900 dark:text-white">{activeConfig.title}</p>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{activeConfig.owner}</p>
              </div>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-brand-600 text-[11px] font-bold text-white">{activeConfig.letter}</span>
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {fields.map(([key, val]) => (
                <div key={key} className="flex items-start justify-between gap-3 rounded border border-slate-100 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-800/50 px-3 py-2">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 shrink-0">{key}</p>
                  <p className="text-right text-[11px] font-medium text-slate-900 dark:text-white">{val}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Target Endpoints panel ───────────────────────────────────────────────────

type EndpointForm = {
  name: string;
  url: string;
  environment: string;
  http_method: BackendTargetEndpointCreate["http_method"];
  auth_header: string;
  auth_scheme: string;
  request_field: string;
  response_field: string;
  timeout_seconds: string;
  secret: string;
  enabled: boolean;
  is_default: boolean;
};

const emptyEndpointForm: EndpointForm = {
  name: "",
  url: "",
  environment: "production",
  http_method: "POST",
  auth_header: "Authorization",
  auth_scheme: "Bearer",
  request_field: "message",
  response_field: "response",
  timeout_seconds: "60",
  secret: "",
  enabled: true,
  is_default: false,
};

const endpointEnvOptions = ["production", "staging", "development", "shadow"];
const endpointMethods: BackendTargetEndpointCreate["http_method"][] = ["POST", "GET", "PUT", "PATCH", "DELETE"];

function TargetEndpointsPanel({ systemId, canManage }: { systemId: string; canManage: boolean }) {
  const [endpoints, setEndpoints] = useState<BackendTargetEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EndpointForm>(emptyEndpointForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEndpoints(await listTargetEndpoints(systemId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load target endpoints.");
    } finally {
      setLoading(false);
    }
  }, [systemId]);

  useEffect(() => {
    void load();
  }, [load]);

  const setField = <K extends keyof EndpointForm>(key: K, value: EndpointForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...emptyEndpointForm, is_default: endpoints.length === 0 });
    setFormOpen(true);
  };

  const openEdit = (endpoint: BackendTargetEndpoint) => {
    setEditingId(endpoint.id);
    setForm({
      name: endpoint.name,
      url: endpoint.url,
      environment: endpoint.environment,
      http_method: endpoint.http_method,
      auth_header: endpoint.auth_header,
      auth_scheme: endpoint.auth_scheme,
      request_field: endpoint.request_field,
      response_field: endpoint.response_field,
      timeout_seconds: String(endpoint.timeout_seconds),
      secret: "",
      enabled: endpoint.enabled,
      is_default: endpoint.is_default,
    });
    setFormOpen(true);
  };

  const submit = async () => {
    if (!form.name.trim() || !form.url.trim()) {
      setError("Name and URL are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const base: BackendTargetEndpointCreate = {
        name: form.name.trim(),
        url: form.url.trim(),
        environment: form.environment,
        http_method: form.http_method,
        auth_header: form.auth_header.trim() || "Authorization",
        auth_scheme: form.auth_scheme,
        request_field: form.request_field.trim() || "message",
        response_field: form.response_field.trim() || "response",
        timeout_seconds: Number(form.timeout_seconds) || 60,
        enabled: form.enabled,
        is_default: form.is_default,
      };
      if (editingId) {
        // Only send the secret when the user actually typed a new one.
        const payload = form.secret.trim() ? { ...base, secret: form.secret } : base;
        await updateTargetEndpoint(systemId, editingId, payload);
      } else {
        await createTargetEndpoint(systemId, form.secret.trim() ? { ...base, secret: form.secret } : base);
      }
      setFormOpen(false);
      setForm(emptyEndpointForm);
      setEditingId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save target endpoint.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (endpoint: BackendTargetEndpoint) => {
    if (!window.confirm(`Delete target endpoint "${endpoint.name}"? This cannot be undone.`)) return;
    setError(null);
    try {
      await deleteTargetEndpoint(systemId, endpoint.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to delete target endpoint.");
    }
  };

  const makeDefault = async (endpoint: BackendTargetEndpoint) => {
    setError(null);
    try {
      await updateTargetEndpoint(systemId, endpoint.id, { is_default: true });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to set default endpoint.");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded border border-slate-200 dark:border-slate-700 p-8 text-[12px] text-slate-500 dark:text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading target endpoints…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded border border-brand-200 dark:border-brand-800/50 bg-brand-50 dark:bg-brand-950/20 px-4 py-2.5">
        <p className="text-[11px] leading-5 text-brand-800 dark:text-brand-300">
          <span className="font-semibold">Where the engine probes.</span> An application usually runs at several endpoints — production, staging, regional instances. Register each here; a run probes the <span className="font-semibold">default</span> endpoint unless it selects another. API keys are encrypted at rest and never returned by the API.
        </p>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <SectionLabel>Registered endpoints ({endpoints.length})</SectionLabel>
        {canManage && !formOpen && (
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-brand-700"
          >
            <Plus className="h-3.5 w-3.5" /> Add endpoint
          </button>
        )}
      </div>

      {endpoints.length === 0 && !formOpen && (
        <div className="rounded border border-dashed border-slate-300 dark:border-slate-600 p-6 text-center">
          <p className="text-[13px] font-semibold text-slate-600 dark:text-slate-300">No target endpoints registered</p>
          <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">Add at least one HTTP endpoint the governance engine can probe.</p>
        </div>
      )}

      <div className="space-y-2">
        {endpoints.map((endpoint) => (
          <div
            key={endpoint.id}
            className="rounded border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Server className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="text-[13px] font-semibold text-slate-900 dark:text-white">{endpoint.name}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{endpoint.environment}</span>
                  {endpoint.is_default && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                      <CheckCircle2 className="h-2.5 w-2.5" /> Default
                    </span>
                  )}
                  {!endpoint.enabled && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">Disabled</span>
                  )}
                  {endpoint.has_secret && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">🔒 key stored</span>
                  )}
                </div>
                <p className="mt-1 truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
                  {endpoint.http_method} {endpoint.url}
                </p>
              </div>
              {canManage && (
                <div className="flex shrink-0 items-center gap-1">
                  {!endpoint.is_default && endpoint.enabled && (
                    <button
                      onClick={() => makeDefault(endpoint)}
                      title="Make default"
                      className="rounded p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-emerald-600 dark:hover:bg-slate-800"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => openEdit(endpoint)}
                    title="Edit"
                    className="rounded p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => remove(endpoint)}
                    title="Delete"
                    className="rounded p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {formOpen && canManage && (
        <div className="rounded border border-slate-300 bg-slate-50 p-4 dark:border-slate-600 dark:bg-slate-800/50">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[13px] font-semibold text-slate-900 dark:text-white">
              {editingId ? "Edit endpoint" : "Add endpoint"}
            </p>
            <button onClick={() => { setFormOpen(false); setEditingId(null); }} className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <EndpointField label="Name *">
              <input value={form.name} onChange={(e) => setField("name", e.target.value)} placeholder="prod-us" className={endpointInputClass} />
            </EndpointField>
            <EndpointField label="Environment">
              <select value={form.environment} onChange={(e) => setField("environment", e.target.value)} className={endpointInputClass}>
                {endpointEnvOptions.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </EndpointField>
            <EndpointField label="URL *" full>
              <input value={form.url} onChange={(e) => setField("url", e.target.value)} placeholder="https://api.example.com/chat" className={endpointInputClass} />
            </EndpointField>
            <EndpointField label="HTTP method">
              <select value={form.http_method} onChange={(e) => setField("http_method", e.target.value as EndpointForm["http_method"])} className={endpointInputClass}>
                {endpointMethods.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </EndpointField>
            <EndpointField label="Timeout (seconds)">
              <input type="number" value={form.timeout_seconds} onChange={(e) => setField("timeout_seconds", e.target.value)} className={endpointInputClass} />
            </EndpointField>
            <EndpointField label="Auth header">
              <input value={form.auth_header} onChange={(e) => setField("auth_header", e.target.value)} placeholder="Authorization" className={endpointInputClass} />
            </EndpointField>
            <EndpointField label="Auth scheme" hint="Prefix before the key; blank sends the raw key (e.g. Azure api-key).">
              <input value={form.auth_scheme} onChange={(e) => setField("auth_scheme", e.target.value)} placeholder="Bearer" className={endpointInputClass} />
            </EndpointField>
            <EndpointField label="Request field" hint="JSON body field the probe prompt is sent as.">
              <input value={form.request_field} onChange={(e) => setField("request_field", e.target.value)} placeholder="message" className={endpointInputClass} />
            </EndpointField>
            <EndpointField label="Response field" hint="JSON field the reply is read from.">
              <input value={form.response_field} onChange={(e) => setField("response_field", e.target.value)} placeholder="response" className={endpointInputClass} />
            </EndpointField>
            <EndpointField label="API key" full hint={editingId ? "Leave blank to keep the stored key. Encrypted at rest — never returned by the API." : "Encrypted at rest — never returned by the API."}>
              <input type="password" value={form.secret} onChange={(e) => setField("secret", e.target.value)} placeholder={editingId ? "••••••• (unchanged)" : "Paste API key"} className={endpointInputClass} autoComplete="new-password" />
            </EndpointField>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-1.5 text-[12px] text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={form.enabled} onChange={(e) => setField("enabled", e.target.checked)} /> Enabled
            </label>
            <label className="flex items-center gap-1.5 text-[12px] text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={form.is_default} onChange={(e) => setField("is_default", e.target.checked)} /> Default endpoint
            </label>
            <div className="ml-auto flex gap-2">
              <button onClick={() => { setFormOpen(false); setEditingId(null); }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-[12px] font-medium text-slate-600 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
                Cancel
              </button>
              <button onClick={submit} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-1.5 text-[12px] font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-400">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {editingId ? "Save changes" : "Add endpoint"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const endpointInputClass =
  "w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-[12px] text-slate-900 outline-none transition focus:border-brand-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white";

function EndpointField({ label, hint, full, children }: { label: string; hint?: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={clsx(full && "sm:col-span-2")}>
      <label className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[10px] leading-4 text-slate-400 dark:text-slate-500">{hint}</p>}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{children}</p>;
}

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <p className="text-[11px] text-slate-500 dark:text-slate-400">{label}</p>
      <p className={clsx("text-right text-[12px] font-medium text-slate-950 dark:text-white", mono && "font-mono")}>{value}</p>
    </div>
  );
}

// ─── Register Application Modal ───────────────────────────────────────────────

type RegisterSystemModalProps = {
  mode: "create" | "edit";
  form: RegisterForm;
  step: "form" | "success";
  onChange: (field: keyof RegisterForm, value: string) => void;
  onToggleFramework: (fw: string) => void;
  onSubmit: () => void | Promise<void>;
  onClose: () => void;
  canEditTechnical: boolean;
  isSubmitting: boolean;
  error: string | null;
};

function RegisterSystemModal({
  mode,
  form,
  step,
  onChange,
  onToggleFramework,
  onSubmit,
  onClose,
  canEditTechnical,
  isSubmitting,
  error,
}: RegisterSystemModalProps) {
  const [wizardStep, setWizardStep] = useState(0);
  const baseComplete = form.name && form.version && form.owner && form.domain && form.riskTier && form.applicationType && form.environment;
  const canSubmit = baseComplete && form.endpoint.trim().length > 0;

  const wizardSteps = ["System Identity", "Application Functionality", "Risk & Frameworks", "Technical Connection", "Capabilities", "Review & Register"];
  // Short labels keep the stepper on one line; full titles stay in the step heading.
  const stepperLabels = ["Identity", "Functionality", "Risk", "Connection", "Capabilities", "Review"];
  // Per-step helper card explaining what the step captures and why it matters.
  const stepHelp: { title: string; body: string; points: string[] }[] = [
    {
      title: "What this captures",
      body: "The anchor record for the whole governance run — every layer, finding, and ledger entry is keyed to this system.",
      points: ["Business name auditors recognize", "Version tag for traceability", "Accountable owner for sign-off"],
    },
    {
      title: "What this captures",
      body: "How the application is built and what it does. The orchestrator uses it to scope which obligations and probes apply.",
      points: ["Technical architecture (type)", "Business domain", "Purpose, data sources & known risks"],
    },
    {
      title: "What this captures",
      body: "Regulatory exposure and the frameworks that drive which clauses, rubrics, and metrics run during the audit.",
      points: ["Risk tier under EU AI Act Annex III", "Deployment environment", "Applicable governance frameworks"],
    },
    {
      title: "What this captures",
      body: "The endpoint the governance backend calls during active probing. A reference only — credentials are never stored here.",
      points: ["Target API endpoint", "Model provider & name", "No API keys entered here"],
    },
    {
      title: "What this captures",
      body: "The first callable capability registered for the target. Agents probe capabilities to test real behaviour.",
      points: ["One capability created on register", "POST: message in / response out", "Add more on the Capabilities page"],
    },
    {
      title: "Before you register",
      body: "Confirm the details below. You can edit any step, then register the application into the governance registry.",
      points: ["Required fields must be complete", "Endpoint is needed to run a governance audit", "Frameworks can be adjusted later"],
    },
  ];
  const lastStep = wizardSteps.length - 1;
  // Per-step gate for the Next button.
  const stepValid = [
    Boolean(form.name && form.version && form.owner),
    Boolean(form.applicationType && form.domain),
    Boolean(form.riskTier && form.environment),
    Boolean(form.endpoint.trim()),
    true,
    Boolean(canSubmit),
  ];
  const inputCls =
    "w-full rounded border border-slate-300 bg-white px-3 py-2 text-[12px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-brand-400";

  const title = mode === "edit"
    ? canEditTechnical ? "Edit AI Application" : "Update Application Details"
    : "Register AI Application";
  const successTitle = mode === "edit" ? `${form.name} updated` : `${form.name} registered`;
  const subtitle = canEditTechnical
    ? "Capture business details and technical connection settings for governance evaluation."
    : "Capture the business, governance, and target endpoint details for evaluation. Credentials remain developer-managed.";

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center overflow-hidden px-4 py-4 sm:px-6">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[3px]" onClick={onClose} />

      {/* Centered modal card */}
      <div className="relative z-10 flex h-[min(760px,calc(100vh-2rem))] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/10 dark:bg-slate-900 dark:ring-white/10">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div>
            <p className="text-[15px] font-semibold text-slate-950 dark:text-white">{title}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{subtitle}</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {step === "success" ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 overflow-y-auto p-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <Server className="h-7 w-7" />
            </div>
            <div>
              <p className="text-[16px] font-semibold text-slate-950 dark:text-white">{successTitle}</p>
              <p className="mt-1 text-[12px] leading-5 text-slate-600 dark:text-slate-300">
                <span className="font-mono font-medium">{form.name} v{form.version}</span> is ready in the governance registry.
              </p>
            </div>
            <div className="w-full rounded border border-slate-200 bg-slate-50 p-3 text-left dark:border-slate-700 dark:bg-slate-800">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {[
                  ["Owner", form.owner],
                  ["Domain", form.domain],
                  ["Risk Tier", form.riskTier],
                  ["Environment", form.environment],
                  ["Target Endpoint", form.endpoint ? "Registered" : "Not provided"],
                  ["Credentials", canEditTechnical ? "Developer managed" : "Pending developer setup"],
                  ["Frameworks", form.frameworks.length ? form.frameworks.join(", ") : "None selected"],
                ].map(([label, value]) => (
                  <div key={label}>
                    <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</p>
                    <p className="text-[12px] font-medium text-slate-950 dark:text-white">{value}</p>
                  </div>
                ))}
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-full rounded bg-[#111827] py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-slate-800"
            >
              Back to Registry
            </button>
          </div>
        ) : (
          <>
            {/* Stepper */}
            <div className="shrink-0 border-b border-slate-200 px-5 py-3 dark:border-slate-700">
              <div className="flex items-center gap-0.5">
                {stepperLabels.map((label, i) => {
                  const reachable = i <= wizardStep || stepValid.slice(0, i).every(Boolean);
                  return (
                    <Fragment key={label}>
                      <button
                        type="button"
                        disabled={!reachable}
                        onClick={() => reachable && setWizardStep(i)}
                        title={wizardSteps[i]}
                        className={clsx(
                          "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition",
                          i === wizardStep
                            ? "bg-brand-600 text-white"
                            : i < wizardStep
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                              : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
                          !reachable && "cursor-not-allowed opacity-60",
                        )}
                      >
                        <span className={clsx("flex h-4 w-4 items-center justify-center rounded-full text-[9px]", i < wizardStep ? "bg-emerald-600 text-white" : i === wizardStep ? "bg-white/25" : "bg-slate-300 text-white dark:bg-slate-600")}>
                          {i < wizardStep ? <CheckCircle2 className="h-3 w-3" /> : i + 1}
                        </span>
                        <span className="whitespace-nowrap">{label}</span>
                      </button>
                      {i < lastStep && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300 dark:text-slate-600" />}
                    </Fragment>
                  );
                })}
              </div>
            </div>

            {/* Step body */}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-700 dark:text-brand-400">Step {wizardStep + 1} of 6 · {wizardSteps[wizardStep]}</p>

              <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_15rem]">
                <div className="min-w-0 space-y-5">

              {/* Step 1 — System Identity */}
              {wizardStep === 0 && (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Application Name *" hint="The business or product name auditors recognize.">
                      <input value={form.name} onChange={(e) => onChange("name", e.target.value)} placeholder="Customer Support Assistant" className={inputCls} />
                    </Field>
                    <Field label="Version *" hint="Semantic version tag">
                      <input value={form.version} onChange={(e) => onChange("version", e.target.value)} placeholder="v1" className={inputCls} />
                    </Field>
                    <Field label="Owner / Team *" hint="Accountable team for governance sign-off">
                      <input value={form.owner} onChange={(e) => onChange("owner", e.target.value)} placeholder="AI Governance Office" className={inputCls} />
                    </Field>
                    <Field label="Daily Active Users" hint="Approximate end-users affected">
                      <input value={form.users} onChange={(e) => onChange("users", e.target.value)} placeholder="Internal pilot" className={inputCls} />
                    </Field>
                  </div>
                  <Field label="Short Description" hint="A one-line summary of what this application is. Appears across the registry.">
                    <input value={form.shortDescription} onChange={(e) => onChange("shortDescription", e.target.value)} placeholder="AI assistant answering customer questions over the TechVest knowledge base." className={inputCls} />
                  </Field>
                </div>
              )}

              {/* Step 2 — Application Functionality */}
              {wizardStep === 1 && (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Application Type *" hint="Technical architecture of the model">
                      <select value={form.applicationType} onChange={(e) => onChange("applicationType", e.target.value)} className={inputCls}>
                        <option value="">Select…</option>
                        {appTypes.map((t) => <option key={t}>{t}</option>)}
                      </select>
                    </Field>
                    <Field label="Domain *" hint="Business area the system operates in">
                      <select value={form.domain} onChange={(e) => onChange("domain", e.target.value)} className={inputCls}>
                        <option value="">Select…</option>
                        {domains.map((d) => <option key={d}>{d}</option>)}
                      </select>
                    </Field>
                  </div>
                  <Field label="What does it do? / Context" hint="Purpose, data sources, and known risks. Used to scope obligations and probes.">
                    <textarea value={form.notes} onChange={(e) => onChange("notes", e.target.value)} rows={3} placeholder="AI-assisted customer support over the TechVest knowledge base; advisory only, human agent reviews before acting…" className={clsx(inputCls, "resize-none")} />
                  </Field>
                </div>
              )}

              {/* Step 3 — Risk & Frameworks */}
              {wizardStep === 2 && (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Risk Tier *" hint="Regulatory classification under EU AI Act Annex III">
                      <select value={form.riskTier} onChange={(e) => onChange("riskTier", e.target.value)} className={inputCls}>
                        <option value="">Select…</option>
                        {riskTiers.map((r) => <option key={r}>{r}</option>)}
                      </select>
                    </Field>
                    <Field label="Environment *" hint="Where the system is currently deployed">
                      <select value={form.environment} onChange={(e) => onChange("environment", e.target.value)} className={inputCls}>
                        <option value="">Select…</option>
                        {envOptions.map((e) => <option key={e}>{e}</option>)}
                      </select>
                    </Field>
                  </div>
                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-300">Applicable Frameworks</p>
                    <p className="mb-2 text-[10px] text-slate-400 dark:text-slate-500">Select the regulatory and risk frameworks that apply. They drive which clauses and metrics run.</p>
                    <div className="flex flex-wrap gap-2">
                      {frameworkOptions.map((fw) => {
                        const active = form.frameworks.includes(fw);
                        return (
                          <button key={fw} type="button" title={frameworkDescriptions[fw]} onClick={() => onToggleFramework(fw)}
                            className={clsx("rounded border px-2.5 py-1.5 text-[12px] font-medium transition-colors",
                              active
                                ? "border-brand-500 bg-brand-50 text-brand-800 dark:border-brand-600 dark:bg-brand-900/40 dark:text-brand-300"
                                : "border-slate-200 bg-white text-slate-700 hover:border-slate-400 hover:text-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-400 dark:hover:text-white")}>
                            {fw}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Step 4 — Technical Connection */}
              {wizardStep === 3 && (
                <div className="space-y-3">
                  <Field label="Target API Endpoint *" hint="The endpoint the governance backend calls during probing. A reference only — no credentials.">
                    <input value={form.endpoint} onChange={(e) => onChange("endpoint", e.target.value)} placeholder="https://api.company.com/ai/chat" className={inputCls} />
                  </Field>
                  {canEditTechnical ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Model Provider" hint="Provider used by the target application">
                        <input value={form.modelProvider} onChange={(e) => onChange("modelProvider", e.target.value)} placeholder="azure_foundry" className={inputCls} />
                      </Field>
                      <Field label="Model Name" hint="Deployment/model name if known">
                        <input value={form.modelName} onChange={(e) => onChange("modelName", e.target.value)} placeholder="gpt-4.1-mini" className={inputCls} />
                      </Field>
                    </div>
                  ) : (
                    <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-900/50 dark:bg-blue-950/30">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-700 dark:text-blue-300">Credential Handling</p>
                      <p className="mt-1 text-[11px] leading-4 text-blue-900 dark:text-blue-200">Do not enter API keys here. The developer team attaches credentials and schemas through technical setup.</p>
                    </div>
                  )}
                </div>
              )}

              {/* Step 5 — Capabilities */}
              {wizardStep === 4 && (
                <div className="space-y-3">
                  <Field label="First Capability" hint="The initial callable capability registered for the target.">
                    <input value={form.capabilityName} onChange={(e) => onChange("capabilityName", e.target.value)} placeholder="Chat response generation" className={inputCls} />
                  </Field>
                  <div className="flex items-start gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <p className="text-[11px] leading-5 text-slate-600 dark:text-slate-300">
                      One capability is created from the target endpoint on register (POST, message in / response out). Add more — with schemas, permissions, and side-effect levels — later on the Capabilities page.
                    </p>
                  </div>
                </div>
              )}

              {/* Step 6 — Review & Register */}
              {wizardStep === 5 && (
                <div className="space-y-3">
                  <div className="rounded border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                      {[
                        ["Name", `${form.name || "—"} ${form.version}`],
                        ["Short description", form.shortDescription.trim() || "—"],
                        ["Owner", form.owner || "—"],
                        ["Type · Domain", `${form.applicationType || "—"} · ${form.domain || "—"}`],
                        ["Risk · Env", `${form.riskTier || "—"} · ${form.environment || "—"}`],
                        ["Frameworks", form.frameworks.length ? form.frameworks.join(", ") : "None selected"],
                        ["Target endpoint", form.endpoint ? "Provided" : "Not provided"],
                        ["First capability", form.capabilityName || "—"],
                        ["Credentials", canEditTechnical ? "Developer managed" : "Pending developer setup"],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</p>
                          <p className="text-[12px] font-medium text-slate-950 dark:text-white">{value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  {!canSubmit && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">Complete the required fields (name, version, owner, type, domain, risk, environment, endpoint) before registering.</p>
                  )}
                </div>
              )}

                </div>

                {/* Helper card — what this step captures */}
                <aside className="lg:sticky lg:top-0 h-fit rounded-lg border border-brand-100 bg-brand-50/60 p-4 dark:border-brand-900/50 dark:bg-brand-950/20">
                  <div className="flex items-center gap-1.5">
                    <Info className="h-3.5 w-3.5 shrink-0 text-brand-600 dark:text-brand-400" />
                    <p className="text-[11px] font-semibold text-brand-800 dark:text-brand-300">{stepHelp[wizardStep].title}</p>
                  </div>
                  <p className="mt-2 text-[11px] leading-5 text-slate-600 dark:text-slate-300">{stepHelp[wizardStep].body}</p>
                  <ul className="mt-3 space-y-1.5">
                    {stepHelp[wizardStep].points.map((point) => (
                      <li key={point} className="flex items-start gap-1.5 text-[11px] leading-4 text-slate-600 dark:text-slate-400">
                        <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-brand-500 dark:text-brand-400" />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </aside>
              </div>
            </div>

            {/* Footer — wizard nav */}
            <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-900">
              {error && (
                <p className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-[11px] leading-4 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">{error}</p>
              )}
              <div className="flex items-center justify-between gap-2">
                <button
                  onClick={wizardStep === 0 ? onClose : () => setWizardStep((s) => s - 1)}
                  className="inline-flex items-center gap-1.5 rounded border border-slate-300 px-4 py-2 text-[13px] font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {wizardStep === 0 ? "Cancel" : <><ArrowLeft className="h-3.5 w-3.5" /> Back</>}
                </button>
                {wizardStep < lastStep ? (
                  <button
                    disabled={!stepValid[wizardStep]}
                    onClick={() => setWizardStep((s) => s + 1)}
                    className={clsx("inline-flex items-center gap-1.5 rounded px-4 py-2 text-[13px] font-semibold text-white transition-colors",
                      stepValid[wizardStep] ? "bg-brand-600 hover:bg-brand-700" : "cursor-not-allowed bg-slate-300 dark:bg-slate-700")}
                  >
                    Next <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <button
                    disabled={!canSubmit || isSubmitting}
                    onClick={onSubmit}
                    className={clsx("inline-flex items-center gap-1.5 rounded px-4 py-2 text-[13px] font-semibold text-white transition-colors",
                      canSubmit && !isSubmitting ? "bg-brand-600 hover:bg-brand-700" : "cursor-not-allowed bg-slate-300 dark:bg-slate-700")}
                  >
                    {isSubmitting ? "Saving…" : mode === "edit" ? "Save Changes" : "Register Application"}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function DeleteSystemDialog({
  system,
  isDeleting,
  error,
  onCancel,
  onConfirm,
}: {
  system: RegistrySystem;
  isDeleting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-md rounded-lg bg-white shadow-2xl ring-1 ring-black/10 dark:bg-slate-900 dark:ring-white/10">
        <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400">
            <Trash2 className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[15px] font-semibold text-slate-950 dark:text-white">Delete AI application?</p>
            <p className="mt-1 text-[12px] leading-5 text-slate-600 dark:text-slate-300">
              Please confirm that you want to remove <span className="font-semibold">{system.name}</span> from the active registry. Existing audit history, evidence, and reports will remain available for traceability.
            </p>
          </div>
        </div>
        <div className="space-y-3 px-5 py-4">
          <div className="rounded border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
            <InfoRow label="Owner" value={system.owner} />
            <InfoRow label="Risk Tier" value={system.riskTier} />
            <InfoRow label="Environment" value={system.environment} />
          </div>
          {error && (
            <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[11px] leading-4 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">{error}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              disabled={isDeleting}
              className="flex-1 rounded border border-slate-300 py-2.5 text-[13px] font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={isDeleting}
              className="flex-1 rounded bg-red-600 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isDeleting ? "Deleting..." : "Delete Application"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">{label}</label>
      {hint && <p className="text-[10px] text-slate-400 dark:text-slate-500">{hint}</p>}
      {children}
    </div>
  );
}
