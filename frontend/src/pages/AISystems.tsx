import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Info,
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
import { useAppStore } from "@/store/useAppStore";
import { useAuthStore } from "@/store/useAuthStore";
import { useSelectionStore } from "@/store/useSelectionStore";
import { personaForRole } from "@/lib/persona";
import { useEvaluationRunner } from "@/hooks/useEvaluationRunner";
import {
  createAISystem,
  createAISystemCapability,
  deleteAISystem,
  getRegistrationOptions,
  listAISystems,
  listRegistrationFrameworks,
  updateAISystem,
  type BackendAISystem,
  type BackendAISystemCapabilityCreate,
  type BackendAISystemCreate,
  type OptionItem,
  type RegistrationFrameworkOption,
  type RegistrationOptions,
} from "@/api/governanceApi";
import { RegisterAISystemModal } from "@/components/registration/RegisterAISystemModal";
import { StartAuditModal } from "@/components/execution/StartAuditModal";
import { applicationContextProfiles } from "@/data/mockData";

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

// Classification dropdowns + the applicable framework list are sourced from the
// backend (GET /governance-config/options and /governance-config/frameworks).
const frameworkOptions = Object.keys(frameworkDescriptions);

// One target API endpoint captured at registration — persisted as a capability.
type EndpointDraft = {
  key: string;
  name: string;
  url: string;
  httpMethod: string;
  capabilityType: string;
  sideEffectLevel: string;
};

type RegisterForm = {
  name: string;
  version: string;
  owner: string;
  domain: string;
  applicationType: string;
  environment: string;
  riskTier: string;
  modality: string;
  users: string;
  frameworks: string[]; // backend framework_id values
  notes: string;
  modelProvider: string;
  modelName: string;
  endpoints: EndpointDraft[];
};

let _endpointSeq = 0;
function newEndpoint(overrides: Partial<EndpointDraft> = {}): EndpointDraft {
  _endpointSeq += 1;
  return {
    key: `ep-${_endpointSeq}`,
    name: "",
    url: "",
    httpMethod: "POST",
    capabilityType: "generation",
    sideEffectLevel: "none",
    ...overrides,
  };
}

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
  applicationType: "", environment: "", riskTier: "", modality: "text",
  users: "", frameworks: [], notes: "",
  modelProvider: "azure_foundry", modelName: "", endpoints: [],
};

const techvestPreset: RegisterForm = {
  name: "TechVest RAG Chatbot",
  version: "v1",
  owner: "TechVest Global",
  domain: "knowledge_management",
  applicationType: "rag_chatbot",
  environment: "production",
  riskTier: "medium",
  modality: "text",
  users: "Public website visitors",
  frameworks: ["nist_ai_rmf", "iso_42001", "eu_ai_act"],
  notes: "Production RAG chatbot powered by Microsoft Foundry AI (GPT-4.1-mini) and Azure AI Search with parent-child chunking. Serves TechVest Global website visitors with document-grounded Q&A.",
  modelProvider: "azure_foundry",
  modelName: "gpt-4.1-mini",
  endpoints: [
    newEndpoint({
      name: "Chat Q&A",
      url: "https://techvest-chatbot-api-2026.azurewebsites.net/api/chat",
      capabilityType: "generation",
    }),
  ],
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
  const endpoints: EndpointDraft[] = system.target_endpoint_ref
    ? [newEndpoint({ name: "Primary endpoint", url: system.target_endpoint_ref })]
    : [];
  return {
    name: system.name,
    version: system.model_version ?? "v1",
    owner: system.owner,
    // Classification fields hold backend option *values* (e.g. "production").
    domain: typeof metadata.domain === "string" ? metadata.domain : "",
    applicationType: system.system_type,
    environment: system.deployment_environment,
    riskTier: system.risk_tier,
    modality: typeof metadata.modality === "string" ? metadata.modality : "text",
    users: typeof metadata.daily_active_users === "string" ? metadata.daily_active_users : "",
    frameworks: system.selected_frameworks,
    notes: system.description ?? "",
    modelProvider: system.model_provider,
    modelName: system.model_name ?? "",
    endpoints,
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

function buildCapabilityPayload(ep: EndpointDraft): BackendAISystemCapabilityCreate {
  return {
    name: ep.name.trim() || "Target endpoint",
    description: "Target application endpoint registered from the governance portal.",
    capability_type: (ep.capabilityType || "generation") as BackendAISystemCapabilityCreate["capability_type"],
    endpoint_ref: ep.url.trim(),
    http_method: (ep.httpMethod || "POST") as BackendAISystemCapabilityCreate["http_method"],
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
    side_effect_level: (ep.sideEffectLevel || "none") as BackendAISystemCapabilityCreate["side_effect_level"],
    requires_human_review: false,
    enabled: true,
    metadata_json: {
      registered_from: "frontend_portal",
    },
  };
}

function buildSystemPayload(form: RegisterForm): BackendAISystemCreate {
  const primaryEndpoint = form.endpoints.find((e) => e.url.trim());
  return {
    name: form.name.trim(),
    description: form.notes.trim() || null,
    owner: form.owner.trim(),
    system_type: form.applicationType || "other",
    risk_tier: mapRiskTier(form.riskTier),
    modality: form.modality || "text",
    deployment_environment: form.environment || "production",
    selected_frameworks: form.frameworks,
    model_provider: form.modelProvider || "azure_foundry",
    model_name: form.modelName.trim() || null,
    model_version: form.version.trim() || null,
    target_endpoint_ref: primaryEndpoint?.url.trim() || null,
    metadata_json: {
      domain: form.domain,
      daily_active_users: form.users || "Not provided",
      modality: form.modality || "text",
      registered_from: "frontend_portal",
    },
  };
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
  // System whose audit-scope modal is open (null = closed).
  const [auditSystem, setAuditSystem] = useState<BackendAISystem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RegistrySystem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const setHeaderHidden = useAppStore((state) => state.setHeaderHidden);
  const runner = useEvaluationRunner();
  // Backend-sourced registration options + applicable frameworks.
  const [registrationOptions, setRegistrationOptions] = useState<RegistrationOptions | null>(null);
  const [registrationFrameworks, setRegistrationFrameworks] = useState<RegistrationFrameworkOption[]>([]);
  const [frameworksError, setFrameworksError] = useState(false);

  const loadRegistrationMeta = useCallback(async () => {
    setFrameworksError(false);
    const [opts, frameworks] = await Promise.all([
      getRegistrationOptions().catch(() => null),
      listRegistrationFrameworks().catch(() => null),
    ]);
    if (opts) setRegistrationOptions(opts);
    if (frameworks) setRegistrationFrameworks(frameworks);
    else setFrameworksError(true);
  }, []);

  useEffect(() => {
    void loadRegistrationMeta();
  }, [loadRegistrationMeta]);

  const handleRunEvaluation = useCallback(
    (systemId: string) => {
      const system = backendSystems.find((s) => s.id === systemId);
      if (!system) return;
      // Open the scope picker; the run is started from the modal so the auditor
      // can choose whole-app or specific functions.
      setAuditSystem(system);
    },
    [backendSystems],
  );

  const loadSystems = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError(null);
      setBackendSystems(await listAISystems());
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
  const highRisk = registrySystems.filter((s) => s.riskTier === "High").length;
  const blocked = registrySystems.filter((s) => s.status === "Blocked").length;
  const avg = registrySystems.length
    ? Math.round(registrySystems.reduce((sum, s) => sum + s.confidence, 0) / registrySystems.length)
    : 0;

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
        // Register each target API endpoint as a capability on the new system.
        for (const ep of registerForm.endpoints) {
          if (ep.url.trim()) {
            await createAISystemCapability(createdSystem.id, buildCapabilityPayload(ep));
          }
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
      {auditSystem && (
        <StartAuditModal
          system={auditSystem}
          runner={runner}
          onClose={() => setAuditSystem(null)}
          onRunCreated={(run) => {
            focusRun(run.id, auditSystem.id);
            navigateTo("/runs");
          }}
          onStarted={(run) => {
            focusRun(run.id, auditSystem.id);
            setAuditSystem(null);
          }}
        />
      )}
      {showRegisterForm && formMode === "create" && (
        <RegisterAISystemModal
          options={registrationOptions}
          frameworks={registrationFrameworks}
          frameworksError={frameworksError}
          onReloadFrameworks={() => void loadRegistrationMeta()}
          onClose={() => setShowRegisterForm(false)}
          onRegistered={() => {
            void loadSystems();
          }}
        />
      )}
      {showRegisterForm && formMode === "edit" && (
        <RegisterSystemModal
          mode={formMode}
          form={registerForm}
          step={registerStep}
          options={registrationOptions}
          frameworks={registrationFrameworks}
          onChange={(field, value) => setRegisterForm((prev) => ({ ...prev, [field]: value }))}
          onToggleFramework={(fw) =>
            setRegisterForm((prev) => ({
              ...prev,
              frameworks: prev.frameworks.includes(fw)
                ? prev.frameworks.filter((f) => f !== fw)
                : [...prev.frameworks, fw],
            }))
          }
          onAddEndpoint={() =>
            setRegisterForm((prev) => ({ ...prev, endpoints: [...prev.endpoints, newEndpoint()] }))
          }
          onUpdateEndpoint={(key, patch) =>
            setRegisterForm((prev) => ({
              ...prev,
              endpoints: prev.endpoints.map((ep) => (ep.key === key ? { ...ep, ...patch } : ep)),
            }))
          }
          onRemoveEndpoint={(key) =>
            setRegisterForm((prev) => ({
              ...prev,
              endpoints: prev.endpoints.filter((ep) => ep.key !== key),
            }))
          }
          onFillPreset={(preset) => setRegisterForm(preset)}
          onSubmit={handleSaveSubmit}
          onClose={() => setShowRegisterForm(false)}
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
      {/* Page intro + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-700">
        <div>
          <p className="text-[15px] font-semibold text-slate-950 dark:text-white">
            AI system registry
          </p>
          <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
            Register the target AI system, assign frameworks, then run the governance audit.
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
              <Plus className="h-4 w-4" /> Register AI System
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
        <div title="Average confidence score across all systems based on the last governance run" className="cursor-default">
          <MetricCard label="Avg Confidence" value={`${avg}%`} icon={TrendingUp} tone="green" compact />
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
  const [activeTab, setActiveTab] = useState<"Overview" | "Context Profile" | "Risk" | "Frameworks" | "Actions">("Overview");
  const verdict = verdictDescriptions[system.verdict];
  const tabs = ["Overview", "Context Profile", "Risk", "Frameworks", "Actions"] as const;

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
          <Badge tone={toneForStatus(system.verdict)}>{system.verdict}</Badge>
          <Badge tone={toneForRisk(system.riskTier)}>{system.riskTier} Risk</Badge>
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

function AcpPanel({ systemId }: { systemId: string }) {
  const [activeSection, setActiveSection] = useState<string>("A");
  const acp = applicationContextProfiles.find((p) => p.systemId === systemId);

  if (!acp) {
    return (
      <div className="rounded border border-dashed border-slate-300 dark:border-slate-600 p-6 text-center">
        <p className="text-[13px] font-semibold text-slate-600 dark:text-slate-300">No context profile registered</p>
        <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">Fill in sections A–E before running a governance audit. The profile tells agents exactly how this system behaves in production.</p>
      </div>
    );
  }

  const sec = acp.sections.find((s) => s.letter === activeSection) ?? acp.sections[0];

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
            {acp.sections.map((s) => (
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
                <p className="text-[13px] font-semibold text-slate-900 dark:text-white">{sec.title}</p>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{sec.owner}</p>
              </div>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-brand-600 text-[11px] font-bold text-white">{sec.letter}</span>
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {sec.fields.map(([key, val]) => (
                <div key={key} className="flex items-start justify-between gap-3 rounded border border-slate-100 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-800/50 px-3 py-2">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 shrink-0">{key}</p>
                  <p className="text-right text-[11px] font-medium text-slate-900 dark:text-white">{val}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Frameworks footer */}
        <div className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-4 py-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Governance Frameworks</p>
          <div className="flex flex-wrap gap-2">
            {acp.frameworks.map((fw) => (
              <span
                key={fw.name}
                title={fw.desc}
                className={clsx(
                  "rounded border px-2.5 py-1 text-[11px] font-medium",
                  fw.active
                    ? "border-brand-300 dark:border-brand-700 bg-brand-50 dark:bg-brand-950/30 text-brand-700 dark:text-brand-400"
                    : "border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-400 dark:text-slate-500 line-through"
                )}
              >{fw.name}</span>
            ))}
          </div>
        </div>
      </div>
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

const modalInputCls =
  "w-full rounded border border-slate-300 bg-white px-3 py-2 text-[12px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-brand-400";

function ModalSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
}: {
  value: string;
  onChange: (v: string) => void;
  options: OptionItem[];
  placeholder?: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={modalInputCls}>
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

type RegisterSystemModalProps = {
  mode: "create" | "edit";
  form: RegisterForm;
  step: "form" | "success";
  options: RegistrationOptions | null;
  frameworks: RegistrationFrameworkOption[];
  onChange: (field: keyof RegisterForm, value: string) => void;
  onToggleFramework: (fw: string) => void;
  onAddEndpoint: () => void;
  onUpdateEndpoint: (key: string, patch: Partial<EndpointDraft>) => void;
  onRemoveEndpoint: (key: string) => void;
  onFillPreset: (preset: RegisterForm) => void;
  onSubmit: () => void | Promise<void>;
  onClose: () => void;
  isSubmitting: boolean;
  error: string | null;
};

function RegisterSystemModal({
  mode,
  form,
  step,
  options,
  frameworks,
  onChange,
  onToggleFramework,
  onAddEndpoint,
  onUpdateEndpoint,
  onRemoveEndpoint,
  onFillPreset,
  onSubmit,
  onClose,
  isSubmitting,
  error,
}: RegisterSystemModalProps) {
  const opts = options;
  const frameworkNameById = new Map(frameworks.map((f) => [f.framework_id, f.framework_name]));
  const hasEndpoint = form.endpoints.some((e) => e.url.trim().length > 0);
  const baseComplete =
    form.name && form.version && form.owner && form.domain && form.riskTier && form.applicationType && form.environment;
  const canSubmit = Boolean(baseComplete && hasEndpoint);
  const title = mode === "edit" ? "Edit AI System" : "Register AI System";
  const successTitle = mode === "edit" ? `${form.name} updated` : `${form.name} registered`;
  const selectedFrameworkNames = form.frameworks.map((id) => frameworkNameById.get(id) ?? id);

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center overflow-hidden px-4 py-4 sm:px-6">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[3px]" onClick={onClose} />
      <div className="relative z-10 flex h-[min(780px,calc(100vh-2rem))] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/10 dark:bg-slate-900 dark:ring-white/10">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div>
            <p className="text-[15px] font-semibold text-slate-950 dark:text-white">{title}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Capture identity, classification, target API endpoints, and applicable frameworks for governance evaluation.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {mode === "create" && (
              <button
                type="button"
                onClick={() => onFillPreset(techvestPreset)}
                className="rounded border border-blue-300 bg-blue-50 px-3 py-1.5 text-[11px] font-semibold text-blue-800 transition-colors hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-900/40"
                title="Pre-fill with TechVest RAG Chatbot details"
              >
                ⚡ Quick fill: TechVest Chatbot
              </button>
            )}
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {step === "success" ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 overflow-y-auto p-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <Server className="h-7 w-7" />
            </div>
            <div>
              <p className="text-[16px] font-semibold text-slate-950 dark:text-white">{successTitle}</p>
              <p className="mt-1 text-[12px] leading-5 text-slate-600 dark:text-slate-300">
                <span className="font-mono font-medium">{form.name} {form.version}</span> is ready in the governance registry.
              </p>
            </div>
            <div className="w-full rounded border border-slate-200 bg-slate-50 p-3 text-left dark:border-slate-700 dark:bg-slate-800">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {[
                  ["Owner", form.owner],
                  ["Risk Tier", form.riskTier || "—"],
                  ["Environment", form.environment || "—"],
                  ["Target endpoints", `${form.endpoints.filter((e) => e.url.trim()).length} registered`],
                  ["Frameworks", selectedFrameworkNames.length ? selectedFrameworkNames.join(", ") : "None selected"],
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
            {/* Vertical form — all sections top to bottom */}
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
              <section className="space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">System Identity</p>
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Application Name *" hint="Use the business or product name auditors recognize.">
                      <input value={form.name} onChange={(e) => onChange("name", e.target.value)} placeholder="Customer Support Assistant" className={modalInputCls} />
                    </Field>
                    <Field label="Version *" hint="Semantic version tag">
                      <input value={form.version} onChange={(e) => onChange("version", e.target.value)} placeholder="v1" className={modalInputCls} />
                    </Field>
                    <Field label="Owner / Team *" hint="Accountable team for governance sign-off">
                      <input value={form.owner} onChange={(e) => onChange("owner", e.target.value)} placeholder="AI Governance Office" className={modalInputCls} />
                    </Field>
                    <Field label="Daily Active Users" hint="Approximate number of end-users affected">
                      <input value={form.users} onChange={(e) => onChange("users", e.target.value)} placeholder="Internal pilot" className={modalInputCls} />
                    </Field>
                  </div>
                  <Field label="Notes / Context" hint="Describe the system purpose, data sources, or known risks">
                    <textarea value={form.notes} onChange={(e) => onChange("notes", e.target.value)} rows={3} placeholder="Production RAG chatbot answering customer questions over the knowledge base…" className={clsx(modalInputCls, "resize-none")} />
                  </Field>
                </div>
              </section>

              <section className="space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Classification</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Application Type *" hint="Technical architecture of the system">
                    <ModalSelect value={form.applicationType} onChange={(v) => onChange("applicationType", v)} options={opts?.application_types ?? []} />
                  </Field>
                  <Field label="Domain *" hint="Business area the system operates in">
                    <ModalSelect value={form.domain} onChange={(v) => onChange("domain", v)} options={opts?.domains ?? []} />
                  </Field>
                  <Field label="Risk Tier *" hint="Regulatory classification under EU AI Act Annex III">
                    <ModalSelect value={form.riskTier} onChange={(v) => onChange("riskTier", v)} options={opts?.risk_tiers ?? []} />
                  </Field>
                  <Field label="Environment *" hint="Where the system is currently deployed">
                    <ModalSelect value={form.environment} onChange={(v) => onChange("environment", v)} options={opts?.deployment_environments ?? []} />
                  </Field>
                  <Field label="Modality" hint="Primary input/output modality">
                    <ModalSelect value={form.modality} onChange={(v) => onChange("modality", v)} options={opts?.modalities ?? []} />
                  </Field>
                </div>
              </section>

              <section className="space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Model</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Model Provider" hint="Provider powering the target application">
                    <ModalSelect value={form.modelProvider} onChange={(v) => onChange("modelProvider", v)} options={opts?.model_providers ?? []} />
                  </Field>
                  <Field label="Model Name" hint="Deployment / model name if known">
                    <input value={form.modelName} onChange={(e) => onChange("modelName", e.target.value)} placeholder="gpt-4.1-mini" className={modalInputCls} />
                  </Field>
                </div>
              </section>

              <section className="space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Target API Endpoints</p>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[12px] font-semibold text-slate-800 dark:text-slate-200">Target API Endpoints</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">Each endpoint the governance engine can probe. Registered as a capability on the system.</p>
                    </div>
                    <button
                      type="button"
                      onClick={onAddEndpoint}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-brand-300 bg-brand-50/50 px-3 py-1.5 text-[12px] font-semibold text-brand-700 transition hover:bg-brand-50 dark:border-brand-800 dark:bg-brand-950/20 dark:text-brand-300"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add endpoint
                    </button>
                  </div>
                  {form.endpoints.length === 0 && (
                    <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-[12px] text-slate-500 dark:border-slate-600 dark:text-slate-400">
                      No endpoints yet — add at least one target API endpoint the engine can call.
                    </div>
                  )}
                  {form.endpoints.map((ep, i) => (
                    <div key={ep.key} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">Endpoint {i + 1}</p>
                        <button type="button" onClick={() => onRemoveEndpoint(ep.key)} title="Remove" className="rounded p-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Endpoint Name">
                          <input value={ep.name} onChange={(e) => onUpdateEndpoint(ep.key, { name: e.target.value })} placeholder="Chat Q&A" className={modalInputCls} />
                        </Field>
                        <Field label="Endpoint URL *">
                          <input value={ep.url} onChange={(e) => onUpdateEndpoint(ep.key, { url: e.target.value })} placeholder="https://api.company.com/ai/chat" className={modalInputCls} />
                        </Field>
                        <Field label="HTTP Method">
                          <ModalSelect value={ep.httpMethod} onChange={(v) => onUpdateEndpoint(ep.key, { httpMethod: v })} options={opts?.http_methods ?? []} />
                        </Field>
                        <Field label="Capability Type">
                          <ModalSelect value={ep.capabilityType} onChange={(v) => onUpdateEndpoint(ep.key, { capabilityType: v })} options={opts?.capability_types ?? []} />
                        </Field>
                        <Field label="Side-effect Level" hint="Impact of invoking this endpoint">
                          <ModalSelect value={ep.sideEffectLevel} onChange={(v) => onUpdateEndpoint(ep.key, { sideEffectLevel: v })} options={opts?.side_effect_levels ?? []} />
                        </Field>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Applicable Frameworks</p>
                <div className="space-y-3">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Applicable governance frameworks the platform implements. Select the ones this system is evaluated against.
                  </p>
                  {frameworks.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-[12px] text-slate-500 dark:border-slate-600 dark:text-slate-400">
                      Loading frameworks from backend…
                    </div>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {frameworks.map((fw) => {
                        const active = form.frameworks.includes(fw.framework_id);
                        return (
                          <button
                            key={fw.framework_id}
                            type="button"
                            onClick={() => onToggleFramework(fw.framework_id)}
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
                            <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">{fw.rubric_count} rubric items · {fw.probe_count} probes</p>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>

              <section className="space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Review</p>
                <div className="space-y-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      ["Name", `${form.name || "—"} ${form.version}`.trim()],
                      ["Type / Environment", [form.applicationType, form.environment].filter(Boolean).join(" · ") || "—"],
                      ["Risk Tier", form.riskTier || "—"],
                      ["Modality", form.modality || "—"],
                      ["Owner", form.owner || "—"],
                      ["Model", [form.modelProvider, form.modelName].filter(Boolean).join(" · ") || "—"],
                      ["Target endpoints", String(form.endpoints.filter((e) => e.url.trim()).length)],
                      ["Frameworks", selectedFrameworkNames.length ? selectedFrameworkNames.join(", ") : "None"],
                    ].map(([label, value]) => (
                      <div key={label} className="flex items-start justify-between gap-3 rounded border border-slate-100 bg-slate-50/60 px-3 py-2 dark:border-slate-700/60 dark:bg-slate-800/40">
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">{label}</span>
                        <span className="text-right text-[11px] font-medium text-slate-900 dark:text-white">{value}</span>
                      </div>
                    ))}
                  </div>
                  <div className={clsx(
                    "rounded-lg border px-3 py-2 text-[12px]",
                    canSubmit
                      ? "border-emerald-200 bg-emerald-50/60 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300"
                      : "border-amber-200 bg-amber-50/60 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-400",
                  )}>
                    {canSubmit
                      ? "All required fields complete — ready to register."
                      : "Missing required fields: name, version, owner, application type, domain, risk tier, environment, and at least one endpoint URL."}
                  </div>
                </div>
              </section>
            </div>

            {/* Footer */}
            <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-900">
              {error && (
                <p className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-[11px] leading-4 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">{error}</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="flex-1 rounded border border-slate-300 py-2.5 text-[13px] font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  disabled={!canSubmit || isSubmitting}
                  onClick={onSubmit}
                  className={clsx(
                    "flex-1 rounded py-2.5 text-[13px] font-semibold text-white transition-colors",
                    canSubmit && !isSubmitting ? "bg-brand-600 hover:bg-brand-700" : "cursor-not-allowed bg-slate-300 dark:bg-slate-700",
                  )}
                >
                  {isSubmitting ? "Saving…" : mode === "edit" ? "Save Changes" : "Register AI System"}
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
