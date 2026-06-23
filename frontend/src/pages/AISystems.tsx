import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  ExternalLink,
  Filter,
  Info,
  Plus,
  Server,
  ShieldAlert,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import clsx from "clsx";
import { Badge, toneForRisk, toneForStatus } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { MetricCard } from "@/components/ui/MetricCard";
import { useAppStore } from "@/store/useAppStore";
import {
  createAISystem,
  createAISystemCapability,
  listAISystems,
  type BackendAISystem,
  type BackendAISystemCapabilityCreate,
  type BackendAISystemCreate,
} from "@/api/governanceApi";

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
  System: "Model identifier, version, and daily active user count.",
  "Application Type": "Technical architecture and AI methodology.",
  Domain: "Business domain the system operates within.",
  Env: "Deployment environment: Production, Shadow (parallel monitoring), or Staging.",
  "Risk Tier": "Regulatory risk classification. High-risk systems face stricter EU AI Act requirements.",
  Owner: "Accountable team responsible for governance sign-off.",
  "Last Run": "Timestamp of most recent completed governance evaluation.",
  Verdict: "Governance outcome: Pass (autonomous), Medium (supervised), or Blocked.",
  Confidence: "Aggregate confidence score from all specialist agents in the last run.",
  "Next Review": "Scheduled date for the next mandatory governance evaluation.",
  Status: "Current operational status of the AI system.",
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
  users: "", frameworks: [], notes: "",
  modelProvider: "azure_foundry", modelName: "", endpoint: "", capabilityName: "Chat response generation",
};

const techVestChatbotTemplate: RegisterForm = {
  name: "TechVest RAG Chatbot",
  version: "v1",
  owner: "TechVest Global",
  domain: "Customer Operations",
  applicationType: "RAG Chatbot",
  environment: "Development",
  riskTier: "Medium",
  users: "Internal pilot",
  frameworks: ["NIST AI RMF", "OWASP LLM Top 10", "ISO 42001"],
  notes: "Azure Foundry and Azure AI Search RAG chatbot used as the first target AI application for governance testing.",
  modelProvider: "azure_foundry",
  modelName: "gpt-4.1-mini",
  endpoint: "http://localhost:8000/api/chat",
  capabilityName: "Chat response generation",
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

export function AISystems() {
  const navigateTo = useAppStore((state) => state.navigateTo);
  const [expandedSystem, setExpandedSystem] = useState<string | null>(null);
  const [hoveredFramework, setHoveredFramework] = useState<string | null>(null);
  const [hoveredColumn, setHoveredColumn] = useState<string | null>(null);
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [registerForm, setRegisterForm] = useState<RegisterForm>(emptyForm);
  const [registerStep, setRegisterStep] = useState<"form" | "success">("form");
  const [backendSystems, setBackendSystems] = useState<BackendAISystem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const setHeaderHidden = useAppStore((state) => state.setHeaderHidden);

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

  async function handleRegisterSubmit() {
    const payload: BackendAISystemCreate = {
      name: registerForm.name.trim(),
      description: registerForm.notes.trim() || null,
      owner: registerForm.owner.trim(),
      system_type: normalizeFramework(registerForm.applicationType || "other"),
      risk_tier: mapRiskTier(registerForm.riskTier),
      deployment_environment: normalizeFramework(registerForm.environment || "local"),
      selected_frameworks: registerForm.frameworks.map(normalizeFramework),
      model_provider: normalizeFramework(registerForm.modelProvider || "azure_foundry"),
      model_name: registerForm.modelName.trim() || null,
      model_version: registerForm.version.trim() || null,
      target_endpoint_ref: registerForm.endpoint.trim(),
      metadata_json: {
        domain: registerForm.domain,
        daily_active_users: registerForm.users || "Not provided",
        registered_from: "frontend_portal",
      },
    };

    try {
      setIsSubmitting(true);
      setSubmitError(null);
      const createdSystem = await createAISystem(payload);
      await createAISystemCapability(createdSystem.id, buildCapabilityPayload(registerForm));
      await loadSystems();
      setRegisterStep("success");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Registration failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      {showRegisterForm && (
        <RegisterSystemModal
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
          onSubmit={handleRegisterSubmit}
          onClose={() => setShowRegisterForm(false)}
          onUseTemplate={() => setRegisterForm(techVestChatbotTemplate)}
          isSubmitting={isSubmitting}
          error={submitError}
        />
      )}
      {/* Page intro + actions */}
      <div className="flex items-start justify-between border-b border-slate-200 pb-5">
        <div className="max-w-2xl space-y-1">
          <p className="text-[13px] leading-5 text-slate-600">
            Every AI system registered here is bound to a model owner, risk tier, and applicable regulatory frameworks. Governance runs evaluate each system continuously — click any row to explore its current posture.
          </p>
          <p className="text-[11px] text-slate-400">Click a row to expand full system details · Click a framework tag for its description · Hover column headers for field definitions</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            title="Filter registry by risk tier, domain, or status"
            className="flex items-center gap-2 rounded border border-slate-300 bg-white px-3 py-2 text-[12px] font-medium text-slate-900 transition-colors hover:border-slate-400 hover:bg-slate-50"
          >
            <Filter className="h-4 w-4" /> Filter
          </button>
          <button
            title="Export registry data as CSV or JSON"
            className="flex items-center gap-2 rounded border border-slate-300 bg-white px-3 py-2 text-[12px] font-medium text-slate-900 transition-colors hover:border-slate-400 hover:bg-slate-50"
          >
            <Download className="h-4 w-4" /> Export
          </button>
          <button
            title="Onboard a new AI system to the governance registry"
            onClick={() => { setRegisterForm(emptyForm); setRegisterStep("form"); setShowRegisterForm(true); }}
            className="flex items-center gap-2 rounded bg-[#111827] px-3 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-slate-700"
          >
            <Plus className="h-4 w-4" /> Register System
          </button>
        </div>
      </div>

      {loadError && (
        <div className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-[12px] leading-5 text-amber-900">
          Backend registry is unavailable. Start the FastAPI backend, then refresh this page to view and register real AI applications.
          <span className="mt-1 block font-mono text-[11px] text-amber-800">{loadError}</span>
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
          <table className="w-full min-w-[1320px] border-collapse text-left">
            <thead className="bg-slate-50">
              <tr className="border-b border-slate-200">
                <th className="w-6 px-3 py-2.5" />
                {Object.keys(columnDescriptions).map((heading) => (
                  <th
                    key={heading}
                    className="relative px-3 py-2.5 text-left"
                    onMouseEnter={() => setHoveredColumn(heading)}
                    onMouseLeave={() => setHoveredColumn(null)}
                  >
                    <span className="flex cursor-default items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600 hover:text-slate-950">
                      {heading}
                      <Info className="h-3 w-3 text-slate-400" />
                    </span>
                    {hoveredColumn === heading && (
                      <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded border border-slate-200 bg-white p-2.5 text-[11px] leading-4 text-slate-700 shadow-lg">
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
                const verdict = verdictDescriptions[system.verdict];
                return (
                  <Fragment key={system.id}>
                    <tr
                      onClick={() => setExpandedSystem(expanded ? null : system.id)}
                      className={clsx(
                        "group cursor-pointer border-b border-slate-100 transition-colors",
                        expanded ? "bg-brand-50/60" : "hover:bg-slate-50"
                      )}
                    >
                      <td className="px-3 py-3 text-slate-400">
                        {expanded
                          ? <ChevronDown className="h-4 w-4 text-brand-600" />
                          : <ChevronRight className="h-4 w-4 group-hover:text-slate-700" />}
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-mono text-[13px] font-semibold text-slate-950">{system.name}</p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-500">
                          <span>{system.version}</span>
                          <span>·</span>
                          <Users className="h-3 w-3" />
                          <span>{system.users} daily users</span>
                        </p>
                      </td>
                      <td className="px-3 py-3 text-[12px] text-slate-700">{system.applicationType}</td>
                      <td className="px-3 py-3 text-[12px] font-medium text-slate-950">{system.domain}</td>
                      <td className="px-3 py-3">
                        <Badge tone="neutral">
                          {system.environment === "Production" ? "Active" : system.environment}
                        </Badge>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={toneForRisk(system.riskTier)}>{system.riskTier}</Badge>
                      </td>
                      <td className="px-3 py-3 text-[12px] text-slate-700">{system.owner}</td>
                      <td className="px-3 py-3">
                        <p className="font-mono text-[11px] text-slate-700">{system.lastRun}</p>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={toneForStatus(system.verdict)}>{system.verdict}</Badge>
                        <p className={clsx("mt-1 text-[10px] font-medium", verdict.color)}>{verdict.label}</p>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <span className={clsx("w-8 text-[12px] font-semibold",
                            system.confidence >= 80 ? "text-emerald-700" :
                            system.confidence >= 60 ? "text-amber-700" : "text-red-700"
                          )}>{system.confidence}%</span>
                          <div className="h-1.5 w-20 rounded bg-slate-200">
                            <div
                              className={clsx("h-full rounded transition-all",
                                system.confidence >= 80 ? "bg-emerald-600" :
                                system.confidence >= 60 ? "bg-amber-500" : "bg-red-500"
                              )}
                              style={{ width: `${system.confidence}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-mono text-[11px] text-slate-700">{system.nextReview}</p>
                        <p className="mt-0.5 text-[10px] text-slate-400">
                          <Clock className="mr-0.5 inline h-2.5 w-2.5" />
                          Scheduled
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={toneForStatus(system.status)}>{system.status}</Badge>
                      </td>
                    </tr>

                    {/* Inline expanded detail */}
                    {expanded && (
                      <tr key={`${system.id}-expanded`} className="border-b border-blue-100 bg-blue-50/60">
                        <td colSpan={12} className="px-4 py-4">
                          <SystemDetail system={system} onNavigate={navigateTo} onClose={() => setExpandedSystem(null)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!isLoading && registrySystems.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-4 py-12 text-center">
                    <p className="text-[14px] font-semibold text-slate-950">No AI systems registered yet</p>
                    <p className="mt-1 text-[12px] text-slate-500">
                      Register the TechVest chatbot or another target AI application to start governance testing.
                    </p>
                  </td>
                </tr>
              )}
              {isLoading && (
                <tr>
                  <td colSpan={12} className="px-4 py-12 text-center text-[12px] text-slate-500">
                    Loading registered AI systems from backend...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Footer info bar */}
      <div className="grid gap-5 rounded-md border border-slate-200 bg-white p-4 lg:grid-cols-3">
        <div>
          <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">
            Frameworks Tracked Across Registry
          </p>
          <div className="relative flex flex-wrap gap-2">
            {Object.keys(frameworkDescriptions).map((fw) => (
              <span
                key={fw}
                onMouseEnter={() => setHoveredFramework(fw)}
                onMouseLeave={() => setHoveredFramework(null)}
                className="cursor-default rounded border border-slate-300 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-900 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-800"
              >
                {fw}
              </span>
            ))}
            {hoveredFramework && (
              <div className="absolute bottom-full left-0 z-20 mb-2 max-w-xs rounded border border-slate-200 bg-white p-2.5 text-[11px] leading-4 text-slate-700 shadow-lg">
                <p className="mb-1 font-semibold text-slate-950">{hoveredFramework}</p>
                {frameworkDescriptions[hoveredFramework]}
              </div>
            )}
          </div>
        </div>
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">Onboarding Policy</p>
          <p className="text-[12px] leading-5 text-slate-600">
            Every system requires an intended-use declaration, prohibited-use list, and dual-control sign-off before reaching Production tier. Shadow deployments run in parallel for 30 days before promotion.
          </p>
        </div>
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">Governance Disclaimer</p>
          <p className="text-[12px] leading-5 text-slate-600">
            Registry entries reflect the current automated governance posture. Final compliance determinations and production decisions require authorized human review per the organization's model risk policy.
          </p>
        </div>
      </div>
    </div>
  );
}

function SystemDetail({
  system,
  onNavigate,
  onClose,
}: {
  system: RegistrySystem;
  onNavigate: (path: string) => void;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"Overview" | "Risk" | "Frameworks" | "Actions">("Overview");
  const verdict = verdictDescriptions[system.verdict];
  const tabs = ["Overview", "Risk", "Frameworks", "Actions"] as const;

  return (
    <div className="rounded-md border border-blue-200 bg-white shadow-sm">
      {/* Detail header */}
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-3">
          <div>
            <p className="font-mono text-[14px] font-bold text-slate-950">{system.name}</p>
            <p className="text-[11px] text-slate-500">
              {system.version} · {system.applicationType} · {system.domain}
            </p>
          </div>
          <Badge tone={toneForStatus(system.verdict)}>{system.verdict}</Badge>
          <Badge tone={toneForRisk(system.riskTier)}>{system.riskTier} Risk</Badge>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onNavigate("/runs")}
            className="flex items-center gap-1.5 rounded border border-blue-300 bg-blue-50 px-3 py-1.5 text-[12px] font-medium text-blue-800 transition-colors hover:bg-blue-100"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View Live Run
          </button>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 px-4 pt-2">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={clsx(
              "rounded-t border border-b-0 px-3 py-1.5 text-[12px] font-medium transition-colors",
              activeTab === tab
                ? "border-slate-300 bg-white text-slate-950"
                : "border-transparent text-slate-500 hover:text-slate-900"
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
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Verdict Meaning</p>
                <p className={clsx("mt-1 text-[12px] font-medium", verdict.color)}>{verdict.label}</p>
                <p className="mt-0.5 text-[11px] leading-4 text-slate-600">{verdict.description}</p>
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

        {activeTab === "Risk" && (
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <SectionLabel>Risk Tier Explanation</SectionLabel>
              <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-3">
                {system.riskTier === "High" && (
                  <p className="text-[12px] leading-5 text-slate-700">
                    <span className="font-semibold text-red-700">High Risk:</span> This system falls under EU AI Act Annex III. It must complete a conformity assessment, maintain an Annex IV technical file, and implement post-market monitoring. Deployers carry obligations under Art.26.
                  </p>
                )}
                {system.riskTier === "Medium" && (
                  <p className="text-[12px] leading-5 text-slate-700">
                    <span className="font-semibold text-amber-700">Medium Risk:</span> Not categorized as high-risk under Annex III but still subject to transparency obligations (Art.52) and internal model risk governance (SR 11-7). Requires periodic re-evaluation.
                  </p>
                )}
                {system.riskTier === "Low" && (
                  <p className="text-[12px] leading-5 text-slate-700">
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
                    <p className="text-[11px] text-slate-700">{item.label}</p>
                    <div className="h-1.5 rounded bg-slate-200">
                      <div
                        className={clsx("h-full rounded", item.val >= 80 ? "bg-emerald-500" : item.val >= 60 ? "bg-amber-400" : "bg-red-500")}
                        style={{ width: `${Math.min(100, Math.max(0, item.val))}%` }}
                      />
                    </div>
                    <span className="text-right text-[11px] font-medium text-slate-950">{Math.min(100, Math.max(0, item.val))}%</span>
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
                  <div key={fw} className="rounded border border-slate-200 bg-slate-50 p-3 transition-colors hover:border-blue-300 hover:bg-blue-50">
                    <p className="text-[12px] font-semibold text-slate-950">{displayName}</p>
                    <p className="mt-1 text-[11px] leading-4 text-slate-600">
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
                path: "/agents",
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
                className="group flex flex-col items-start gap-1.5 rounded border border-slate-200 bg-white p-3 text-left transition-all hover:border-blue-300 hover:bg-blue-50 hover:shadow-sm"
              >
                <action.icon className="h-4 w-4 text-blue-700" />
                <p className="text-[13px] font-semibold text-slate-950 group-hover:text-blue-800">{action.label}</p>
                <p className="text-[11px] leading-4 text-slate-500">{action.desc}</p>
              </button>
            ))}
          </div>
        )}
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
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={clsx("text-right text-[12px] font-medium text-slate-950", mono && "font-mono")}>{value}</p>
    </div>
  );
}

// ─── Register System Modal ────────────────────────────────────────────────────

type RegisterSystemModalProps = {
  form: RegisterForm;
  step: "form" | "success";
  onChange: (field: keyof RegisterForm, value: string) => void;
  onToggleFramework: (fw: string) => void;
  onSubmit: () => void | Promise<void>;
  onClose: () => void;
  onUseTemplate: () => void;
  isSubmitting: boolean;
  error: string | null;
};

function RegisterSystemModal({
  form,
  step,
  onChange,
  onToggleFramework,
  onSubmit,
  onClose,
  onUseTemplate,
  isSubmitting,
  error,
}: RegisterSystemModalProps) {
  const canSubmit = form.name && form.version && form.owner && form.domain && form.riskTier && form.applicationType && form.environment && form.endpoint;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[3px]" onClick={onClose} />

      {/* Centered modal card */}
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/10">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-[15px] font-semibold text-slate-950">Register AI System</p>
            <p className="text-[11px] text-slate-500">Onboard a new system to the governance registry</p>
          </div>
          <div className="flex items-center gap-2">
            {step === "form" && (
              <button
                type="button"
                onClick={onUseTemplate}
                className="rounded border border-blue-300 bg-blue-50 px-3 py-1.5 text-[11px] font-semibold text-blue-800 transition-colors hover:bg-blue-100"
              >
                Use TechVest Chatbot
              </button>
            )}
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
          </div>
        </div>

        {step === "success" ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <Server className="h-7 w-7" />
            </div>
            <div>
              <p className="text-[16px] font-semibold text-slate-950">{form.name} registered</p>
              <p className="mt-1 text-[12px] leading-5 text-slate-600">
                <span className="font-mono font-medium">{form.name} v{form.version}</span> has been added to the governance registry. A baseline governance run will be scheduled automatically.
              </p>
            </div>
            <div className="w-full rounded border border-slate-200 bg-slate-50 p-3 text-left">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {[
                  ["Owner", form.owner],
                  ["Domain", form.domain],
                  ["Risk Tier", form.riskTier],
                  ["Environment", form.environment],
                  ["Endpoint", form.endpoint],
                  ["Frameworks", form.frameworks.length ? form.frameworks.join(", ") : "None selected"],
                ].map(([label, value]) => (
                  <div key={label}>
                    <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                    <p className="text-[12px] font-medium text-slate-950">{value}</p>
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
            {/* Form body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {/* System Identity */}
              <section>
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">System Identity</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="System Name *" hint="e.g. TechVest RAG Chatbot">
                    <input
                      value={form.name}
                      onChange={(e) => onChange("name", e.target.value)}
                      placeholder="TechVest RAG Chatbot"
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-[12px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-500"
                    />
                  </Field>
                  <Field label="Version *" hint="Semantic version tag">
                    <input
                      value={form.version}
                      onChange={(e) => onChange("version", e.target.value)}
                      placeholder="v1"
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-[12px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-500"
                    />
                  </Field>
                  <Field label="Owner / Team *" hint="Accountable team for governance sign-off">
                    <input
                      value={form.owner}
                      onChange={(e) => onChange("owner", e.target.value)}
                      placeholder="TechVest Global"
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-[12px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-500"
                    />
                  </Field>
                  <Field label="Daily Active Users" hint="Approximate number of end-users affected">
                    <input
                      value={form.users}
                      onChange={(e) => onChange("users", e.target.value)}
                      placeholder="Internal pilot"
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-[12px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-500"
                    />
                  </Field>
                </div>
              </section>

              {/* Classification */}
              <section>
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Classification</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Application Type *" hint="Technical architecture of the model">
                    <select value={form.applicationType} onChange={(e) => onChange("applicationType", e.target.value)} className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-[12px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-500">
                      <option value="">Select…</option>
                      {appTypes.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field label="Domain *" hint="Business area the system operates in">
                    <select value={form.domain} onChange={(e) => onChange("domain", e.target.value)} className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-[12px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-500">
                      <option value="">Select…</option>
                      {domains.map((d) => <option key={d}>{d}</option>)}
                    </select>
                  </Field>
                  <Field label="Risk Tier *" hint="Regulatory classification under EU AI Act Annex III">
                    <select value={form.riskTier} onChange={(e) => onChange("riskTier", e.target.value)} className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-[12px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-500">
                      <option value="">Select…</option>
                      {riskTiers.map((r) => <option key={r}>{r}</option>)}
                    </select>
                  </Field>
                  <Field label="Environment *" hint="Where the system is currently deployed">
                    <select value={form.environment} onChange={(e) => onChange("environment", e.target.value)} className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-[12px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-500">
                      <option value="">Select…</option>
                      {envOptions.map((e) => <option key={e}>{e}</option>)}
                    </select>
                  </Field>
                </div>
              </section>

              {/* Model and target endpoint */}
              <section>
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Model and Target Endpoint</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Model Provider" hint="Provider used by the target application">
                    <input
                      value={form.modelProvider}
                      onChange={(e) => onChange("modelProvider", e.target.value)}
                      placeholder="azure_foundry"
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-[12px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-500"
                    />
                  </Field>
                  <Field label="Model Name" hint="Deployment/model name if known">
                    <input
                      value={form.modelName}
                      onChange={(e) => onChange("modelName", e.target.value)}
                      placeholder="gpt-4.1-mini"
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-[12px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-500"
                    />
                  </Field>
                  <Field label="Target Endpoint *" hint="The endpoint our governance backend will call for testing">
                    <input
                      value={form.endpoint}
                      onChange={(e) => onChange("endpoint", e.target.value)}
                      placeholder="http://localhost:8000/api/chat"
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-[12px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-500"
                    />
                  </Field>
                  <Field label="First Capability" hint="The initial endpoint/capability to store">
                    <input
                      value={form.capabilityName}
                      onChange={(e) => onChange("capabilityName", e.target.value)}
                      placeholder="Chat response generation"
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-[12px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-500"
                    />
                  </Field>
                </div>
              </section>

              {/* Frameworks */}
              <section>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Applicable Frameworks</p>
                <p className="mb-3 text-[11px] text-slate-400">Select all regulatory and risk frameworks that apply to this system.</p>
                <div className="flex flex-wrap gap-2">
                  {frameworkOptions.map((fw) => {
                    const active = form.frameworks.includes(fw);
                    return (
                      <button
                        key={fw}
                        type="button"
                        title={frameworkDescriptions[fw]}
                        onClick={() => onToggleFramework(fw)}
                        className={clsx(
                          "rounded border px-2.5 py-1.5 text-[12px] font-medium transition-colors",
                          active
                            ? "border-brand-500 bg-brand-50 text-brand-800"
                            : "border-slate-200 bg-white text-slate-700 hover:border-slate-400 hover:text-slate-950"
                        )}
                      >
                        {fw}
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Notes */}
              <section>
                <Field label="Notes / Context" hint="Describe the system purpose, data sources, or known risks">
                  <textarea
                    value={form.notes}
                    onChange={(e) => onChange("notes", e.target.value)}
                    rows={3}
                    placeholder="This model evaluates chatbot response quality using bureau data and application features…"
                    className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-[12px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-500 resize-none"
                  />
                </Field>
              </section>
            </div>

            {/* Footer */}
            <div className="border-t border-slate-200 px-5 py-4">
              {!canSubmit && (
                <p className="mb-2 text-[11px] text-slate-400">* Fill in all required fields and a target endpoint to continue</p>
              )}
              {error && (
                <p className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-[11px] leading-4 text-red-700">{error}</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="flex-1 rounded border border-slate-300 py-2.5 text-[13px] font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  disabled={!canSubmit || isSubmitting}
                  onClick={onSubmit}
                  className={clsx(
                    "flex-1 rounded py-2.5 text-[13px] font-semibold text-white transition-colors",
                    canSubmit && !isSubmitting ? "bg-brand-600 hover:bg-brand-700" : "cursor-not-allowed bg-slate-300"
                  )}
                >
                  {isSubmitting ? "Registering..." : "Register System"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-[11px] font-semibold text-slate-700">{label}</label>
      {hint && <p className="text-[10px] text-slate-400">{hint}</p>}
      {children}
    </div>
  );
}
