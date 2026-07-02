import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  Building2,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Database,
  FilePlus,
  FileText,
  Gauge,
  Info,
  Layers,
  Loader2,
  Plug,
  Plus,
  Save,
  Send,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { AISystems } from "@/pages/AISystems";
import {
  createAISystem,
  createTargetEndpoint,
  listAISystems,
  updateAISystem,
  type BackendAISystem,
  type BackendAISystemCreate,
} from "@/api/governanceApi";

/* ────────────────────────────────────────────────────────── Option sets ── */

const SYSTEM_TYPES = [
  "LLM Application", "RAG System", "AI Agent", "Traditional ML Model",
  "Multimodal AI System", "Recommendation System", "Classification System",
  "Scoring System", "Prediction System",
];
const DEPLOY_ENVS = ["Development", "Staging", "Production", "Sandbox"];
const STATUSES = ["Draft", "Registered", "Needs Update", "Archived"];
const MODALITIES = ["Text", "Image", "Audio", "Video", "Tabular", "Code", "Multimodal"];
const CRITICALITY = ["Low", "Medium", "High", "Business Critical"];
const DECISION_IMPACT = [
  "Informational Only", "Recommendation", "Ranking", "Scoring",
  "Approval / Rejection", "Automated Decision", "Human-in-the-loop Decision",
];
const AUTOMATION_LEVEL = ["Manual Assist", "Human-in-the-loop", "Human-on-the-loop", "Fully Autonomous"];
const REVIEW_FREQ = ["Monthly", "Quarterly", "Semi-Annual", "Annual", "Ad-hoc"];
const FRAMEWORKS = ["NIST AI RMF", "ISO/IEC 42001", "EU AI Act", "OWASP LLM Top 10"];
const PRIORITIES = ["Low", "Medium", "High", "Critical"];
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const GATEWAY_TYPES = ["Direct API", "LiteLLM Gateway", "Azure API Management", "Internal Gateway", "Custom Proxy"];
const AUTH_TYPES = ["API Key", "Bearer Token", "OAuth 2.0", "Azure AD", "mTLS", "None"];
const DATA_SOURCE_TYPES = [
  "User Input", "Uploaded Documents", "Database", "API", "Vector Database",
  "File Storage", "Third-Party Dataset", "Internal Knowledge Base",
];
const DATA_CLASSIFICATIONS = ["Public", "Internal", "Confidential", "Restricted", "Sensitive"];
const RETRIEVAL_METHODS = ["Similarity", "MMR", "Hybrid", "Keyword", "Semantic + Rerank"];
const DOC_TYPES = [
  "Architecture Document", "API Specification", "Model Card", "Data Sheet",
  "Risk Assessment", "Security Review", "Prompt Injection Test Result",
  "Red Teaming Report", "Privacy Assessment", "Compliance Evidence",
  "Vendor Documentation", "SLA / SOC 2 Document", "Other",
];
const RISK_TIERS = ["Low", "Medium", "High", "Critical"];
const IMPACT_LEVELS = ["Negligible", "Minor", "Moderate", "Major", "Severe"];
const LIKELIHOOD_LEVELS = ["Rare", "Unlikely", "Possible", "Likely", "Almost Certain"];
const LEVELS = ["Low", "Medium", "High", "Critical"];
const REQUIREMENT_LEVELS = ["Not Required", "Recommended", "Required", "Mandatory"];
const METRIC_DIMENSIONS = [
  "Accuracy", "Robustness", "Security", "Privacy", "Fairness", "Explainability",
  "Safety", "Hallucination", "Latency", "Cost", "Reliability", "Human Oversight", "Compliance",
];
const METRIC_TOOLS = [
  "Langfuse", "Promptfoo", "DeepEval", "garak", "PyRIT", "Evidently",
  "RAGAS", "Inspect AI", "Manual Review", "Custom Tool",
];
const SEVERITIES = ["Info", "Low", "Medium", "High", "Critical"];
const RUN_FREQ = ["Per Run", "Hourly", "Daily", "Weekly", "Monthly", "On Deploy"];
const MONITOR_FREQ = ["Real-time", "Hourly", "Daily", "Weekly", "Monthly", "Manual Only"];
const NOTIFICATION_CHANNELS = ["Email", "Slack", "Microsoft Teams", "Webhook", "Dashboard Only"];
const ALERT_FREQ = ["Immediate", "Hourly Digest", "Daily Digest", "Weekly Summary", "Critical Alerts Only"];

const RISK_QUESTIONS: { key: string; q: string }[] = [
  { key: "influencesDecisions", q: "Does the system make or influence decisions about people?" },
  { key: "processesPersonalData", q: "Does it process personal data?" },
  { key: "affectsCriticalDomains", q: "Does it affect employment, finance, healthcare, education, or legal decisions?" },
  { key: "userHarm", q: "Can users be harmed by incorrect output?" },
  { key: "humanReview", q: "Is there human review before action is taken?" },
  { key: "externalUsers", q: "Is the system exposed to external users?" },
  { key: "thirdPartyModels", q: "Does it use third-party models?" },
  { key: "freeFormText", q: "Does it generate free-form text?" },
  { key: "autonomousActions", q: "Does it use tools or autonomous actions?" },
];

/* ───────────────────────────────────────────────────────────── Types ── */

type Basic = {
  name: string; description: string; systemType: string; deploymentEnvironment: string;
  status: string; businessUnit: string; organization: string; version: string;
  primaryUseCase: string; modality: string; criticality: string;
};
type Context = {
  businessPurpose: string; intendedUsers: string; affectedUsers: string; industryDomain: string;
  geographicScope: string; decisionImpact: string; automationLevel: string; humanOversight: string;
  expectedUsageVolume: string; fallbackProcess: string; escalationProcess: string;
};
type Owners = {
  systemOwnerName: string; systemOwnerEmail: string; technicalOwnerName: string; technicalOwnerEmail: string;
  businessOwnerName: string; businessOwnerEmail: string; complianceOwnerName: string; complianceOwnerEmail: string;
  securityOwnerName: string; securityOwnerEmail: string; dataOwnerName: string; dataOwnerEmail: string;
  reviewFrequency: string; nextReviewDate: string; escalationContact: string;
};
type FrameworkSel = {
  selected: boolean; applicabilityReason: string; priority: string;
  complianceOwner: string; reviewFrequency: string; evidenceRequired: string;
};
type ModelEntry = {
  id: number; name: string; provider: string; version: string; modelType: string; hostingLocation: string;
  inputModality: string; outputModality: string; fineTuned: boolean; openSource: boolean; thirdParty: boolean;
  trainingDataKnown: boolean; safetyFilters: boolean; fallbackModel: string; defaultParameters: string;
};
type EndpointEntry = {
  id: number; name: string; url: string; httpMethod: string; gatewayType: string; authType: string;
  connectedModel: string; inputSchema: string; outputSchema: string; rateLimit: string; timeout: string;
  visibility: string; loggingEnabled: boolean; monitoringEnabled: boolean; piiAllowed: boolean;
  dataRetention: string; status: string;
};
type DataSourceEntry = {
  id: number; name: string; sourceType: string; classification: string; containsPii: boolean;
  containsSensitive: boolean; dataOwner: string; sourceSystem: string; usedForTraining: boolean;
  usedForInference: boolean; usedForRag: boolean; retentionPeriod: string; dataResidency: string;
  encryptionEnabled: boolean; consentRequired: boolean; accessControl: string; deletionProcess: string;
  vectorDatabase: string; embeddingModel: string; chunkSize: string; chunkOverlap: string;
  retrievalMethod: string; topK: string; refreshFrequency: string; citationRequired: boolean;
};
type DocumentEntry = {
  id: number; name: string; docType: string; linkedFramework: string; linkedSection: string;
  version: string; fileName: string; requirement: string; expiryDate: string; reviewer: string; notes: string;
};
type MetricEntry = {
  id: number; name: string; dimension: string; frameworkMapping: string; tool: string; threshold: string;
  severity: string; runFrequency: string; requiredForApproval: boolean; appliesToEndpoint: string; appliesToModel: string;
};
type Risk = {
  riskTier: string; riskScore: string; impactLevel: string; likelihoodLevel: string; dataSensitivity: string;
  automationRisk: string; userHarmPotential: string; biasRisk: string; privacyRisk: string; securityRisk: string;
  explainabilityRequirement: string; humanOversightRequirement: string; finalRiskRationale: string;
  questions: Record<string, boolean>;
};
type Monitoring = {
  enabled: boolean; frequency: string; monitoredEndpoints: string; monitoredModels: string;
  latency: boolean; errorRate: boolean; cost: boolean; tokenUsage: boolean; promptInjection: boolean;
  hallucination: boolean; piiLeakage: boolean; biasDrift: boolean; dataDrift: boolean;
  humanOverride: boolean; feedback: boolean;
};
type Alerts = {
  enabled: boolean; primaryEmail: string; technicalEmail: string; complianceEmail: string;
  securityEmail: string; businessOwnerEmail: string; alertFrequency: string; severityThreshold: string;
  escalationFrequency: string; escalationContact: string; channels: string[];
};

// Full form snapshot persisted to ai_systems.metadata_json.registration so an
// edit round-trips every section, not just the columns the backend has today.
type Snapshot = {
  basic: Basic; context: Context; owners: Owners; frameworks: Record<string, FrameworkSel>;
  risk: Risk; monitoring: Monitoring; alerts: Alerts;
  models: Omit<ModelEntry, "id">[]; endpoints: Omit<EndpointEntry, "id">[];
  dataSources: Omit<DataSourceEntry, "id">[]; documents: Omit<DocumentEntry, "id">[]; metrics: Omit<MetricEntry, "id">[];
};

/* ──────────────────────────────────────────────────────────── Helpers ── */

const inputCls =
  "w-full rounded border border-slate-300 bg-white px-3 py-2 text-[12px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-brand-400";

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const isHttpUrl = (v: string) => /^https?:\/\//i.test(v.trim());
const titleCase = (v: string) => (v ? v.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : v);
const mapRiskTier = (t: string): "low" | "medium" | "high" =>
  t === "Low" ? "low" : t === "High" || t === "Critical" ? "high" : "medium";

function withoutId<T extends { id: number }>(item: T): Omit<T, "id"> {
  const copy: Partial<T> = { ...item };
  delete copy.id;
  return copy as Omit<T, "id">;
}

function useSection<T extends object>(initial: T) {
  const [value, setValue] = useState<T>(initial);
  const set = <K extends keyof T>(key: K, v: T[K]) => setValue((p) => ({ ...p, [key]: v }));
  return [value, set, setValue] as const;
}

function useList<T extends { id: number }>() {
  const idRef = useRef(1);
  const [items, setItems] = useState<T[]>([]);
  const add = (factory: (id: number) => T) => setItems((p) => [...p, factory(idRef.current++)]);
  const remove = (id: number) => setItems((p) => p.filter((it) => it.id !== id));
  const update = (id: number, patch: Partial<T>) =>
    setItems((p) => p.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  const replace = (arr: Omit<T, "id">[]) => setItems(arr.map((it) => ({ ...(it as T), id: idRef.current++ })));
  return { items, add, remove, update, replace };
}

/* ──────────────────────────────────────────────────── Field primitives ── */

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
        {label}{required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {hint && <p className="text-[10px] text-slate-400 dark:text-slate-500">{hint}</p>}
      {children}
    </div>
  );
}

function TextField({ value, onChange, placeholder, type = "text" }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={inputCls} />;
}

function TextArea({ value, onChange, placeholder, rows = 3 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows} className={clsx(inputCls, "resize-y")} />;
}

function SelectField({ value, onChange, options, placeholder = "Select…" }: { value: string; onChange: (v: string) => void; options: string[]; placeholder?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function BoolField({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded border border-slate-300 text-[11px] dark:border-slate-600">
      {[{ label: "Yes", v: true }, { label: "No", v: false }].map((opt) => (
        <button
          key={opt.label}
          type="button"
          onClick={() => onChange(opt.v)}
          className={clsx(
            "px-3 py-1.5 font-medium transition-colors",
            value === opt.v
              ? opt.v ? "bg-emerald-600 text-white" : "bg-slate-600 text-white"
              : "bg-white text-slate-500 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Grid({ children, cols = 2 }: { children: React.ReactNode; cols?: 2 | 3 }) {
  return <div className={clsx("grid gap-4", cols === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2")}>{children}</div>;
}

function SectionCard({
  index, title, description, icon: Icon, children,
}: { index: number; title: string; description?: string; icon: typeof Info; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 border-b border-[#eef0f6] px-5 py-3.5 text-left dark:border-white/10"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/40">
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-slate-400">{String(index).padStart(2, "0")}</span>
            <h2 className="font-display text-[15px] text-ink dark:text-slate-100">{title}</h2>
          </span>
          {description && <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{description}</p>}
        </span>
        <ChevronDown className={clsx("h-4 w-4 shrink-0 text-slate-400 transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="space-y-4 p-5">{children}</div>}
    </Card>
  );
}

function RepeatableItem({ title, onRemove, children }: { title: string; onRemove: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-800/40">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[12px] font-semibold text-slate-800 dark:text-slate-200">{title}</p>
        <button type="button" onClick={onRemove} title="Remove" className="rounded p-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-brand-300 bg-brand-50/50 px-3.5 py-2 text-[12px] font-semibold text-brand-700 transition hover:bg-brand-50 dark:border-brand-800 dark:bg-brand-950/20 dark:text-brand-300"
    >
      <Plus className="h-3.5 w-3.5" /> {label}
    </button>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-[12px] text-slate-500 dark:border-slate-600 dark:text-slate-400">
      {children}
    </div>
  );
}

/* ───────────────────────────────────────────── Entry factory functions ── */

const newModel = (id: number): ModelEntry => ({
  id, name: "", provider: "", version: "", modelType: "", hostingLocation: "",
  inputModality: "", outputModality: "", fineTuned: false, openSource: false, thirdParty: false,
  trainingDataKnown: false, safetyFilters: true, fallbackModel: "", defaultParameters: "",
});
const newEndpoint = (id: number): EndpointEntry => ({
  id, name: "", url: "", httpMethod: "POST", gatewayType: "", authType: "", connectedModel: "",
  inputSchema: "", outputSchema: "", rateLimit: "", timeout: "60", visibility: "Internal",
  loggingEnabled: true, monitoringEnabled: true, piiAllowed: false, dataRetention: "", status: "Active",
});
const newDataSource = (id: number): DataSourceEntry => ({
  id, name: "", sourceType: "", classification: "", containsPii: false, containsSensitive: false,
  dataOwner: "", sourceSystem: "", usedForTraining: false, usedForInference: false, usedForRag: false,
  retentionPeriod: "", dataResidency: "", encryptionEnabled: true, consentRequired: false,
  accessControl: "", deletionProcess: "", vectorDatabase: "", embeddingModel: "", chunkSize: "",
  chunkOverlap: "", retrievalMethod: "", topK: "", refreshFrequency: "", citationRequired: false,
});
const newDocument = (id: number): DocumentEntry => ({
  id, name: "", docType: "", linkedFramework: "", linkedSection: "", version: "",
  fileName: "", requirement: "Required", expiryDate: "", reviewer: "", notes: "",
});
const newMetric = (id: number): MetricEntry => ({
  id, name: "", dimension: "", frameworkMapping: "", tool: "", threshold: "", severity: "Medium",
  runFrequency: "Per Run", requiredForApproval: false, appliesToEndpoint: "", appliesToModel: "",
});

const emptyFrameworks = (): Record<string, FrameworkSel> =>
  Object.fromEntries(
    FRAMEWORKS.map((f) => [f, { selected: false, applicabilityReason: "", priority: "", complianceOwner: "", reviewFrequency: "", evidenceRequired: "" }]),
  );

/* ══════════════════════════════════════════════════ Workspace container ══ */

export function AISystemsWorkspace() {
  const [tab, setTab] = useState<"systems" | "register">("systems");
  const [nonce, setNonce] = useState(0);
  const [count, setCount] = useState<number | null>(null);

  const reloadCount = useCallback(async () => {
    try {
      setCount((await listAISystems()).length);
    } catch {
      /* count badge is best-effort */
    }
  }, []);

  useEffect(() => { void reloadCount(); }, [reloadCount]);

  const startRegister = () => { setNonce((n) => n + 1); setTab("register"); };
  const finishRegister = () => { setTab("systems"); void reloadCount(); };

  const tabs = [
    { id: "systems" as const, label: "AI Systems", icon: ShieldCheck, count },
    { id: "register" as const, label: "Registration", icon: FilePlus, count: null as number | null },
  ];

  return (
    <div className="flex flex-col gap-5 lg:flex-row">
      {/* Left tab rail */}
      <nav className="flex gap-2 lg:w-56 lg:shrink-0 lg:flex-col lg:gap-1">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => (t.id === "register" ? startRegister() : setTab("systems"))}
              className={clsx(
                "flex flex-1 items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-[13px] font-medium transition-colors lg:flex-none",
                active
                  ? "border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-800 dark:bg-brand-950/30 dark:text-brand-300"
                  : "border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white",
              )}
            >
              <t.icon className="h-4 w-4 shrink-0" />
              <span className="flex-1">{t.label}</span>
              {t.count !== null && (
                <span className={clsx(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                  active ? "bg-brand-600 text-white" : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
                )}>
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Content */}
      <div className="min-w-0 flex-1">
        {tab === "systems" ? (
          <AISystems />
        ) : (
          <RegistrationForm
            key={`new-${nonce}`}
            editSystem={null}
            onCancel={() => setTab("systems")}
            onDone={finishRegister}
          />
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════ Registration form ══ */

function RegistrationForm({
  editSystem, onCancel, onDone,
}: {
  editSystem: BackendAISystem | null;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [basic, setBasic, setBasicAll] = useSection<Basic>({
    name: "", description: "", systemType: "", deploymentEnvironment: "", status: "Draft",
    businessUnit: "", organization: "", version: "", primaryUseCase: "", modality: "", criticality: "",
  });
  const [context, setContext, setContextAll] = useSection<Context>({
    businessPurpose: "", intendedUsers: "", affectedUsers: "", industryDomain: "", geographicScope: "",
    decisionImpact: "", automationLevel: "", humanOversight: "", expectedUsageVolume: "",
    fallbackProcess: "", escalationProcess: "",
  });
  const [owners, setOwners, setOwnersAll] = useSection<Owners>({
    systemOwnerName: "", systemOwnerEmail: "", technicalOwnerName: "", technicalOwnerEmail: "",
    businessOwnerName: "", businessOwnerEmail: "", complianceOwnerName: "", complianceOwnerEmail: "",
    securityOwnerName: "", securityOwnerEmail: "", dataOwnerName: "", dataOwnerEmail: "",
    reviewFrequency: "", nextReviewDate: "", escalationContact: "",
  });
  const [frameworks, setFrameworks] = useState<Record<string, FrameworkSel>>(emptyFrameworks);
  const models = useList<ModelEntry>();
  const endpoints = useList<EndpointEntry>();
  const dataSources = useList<DataSourceEntry>();
  const documents = useList<DocumentEntry>();
  const metrics = useList<MetricEntry>();
  const [risk, setRisk, setRiskAll] = useSection<Risk>({
    riskTier: "", riskScore: "", impactLevel: "", likelihoodLevel: "", dataSensitivity: "",
    automationRisk: "", userHarmPotential: "", biasRisk: "", privacyRisk: "", securityRisk: "",
    explainabilityRequirement: "", humanOversightRequirement: "", finalRiskRationale: "",
    questions: Object.fromEntries(RISK_QUESTIONS.map((q) => [q.key, false])),
  });
  const [monitoring, setMonitoring, setMonitoringAll] = useSection<Monitoring>({
    enabled: true, frequency: "", monitoredEndpoints: "", monitoredModels: "", latency: true,
    errorRate: true, cost: false, tokenUsage: false, promptInjection: true, hallucination: true,
    piiLeakage: true, biasDrift: false, dataDrift: false, humanOverride: false, feedback: false,
  });
  const [alerts, setAlerts, setAlertsAll] = useSection<Alerts>({
    enabled: true, primaryEmail: "", technicalEmail: "", complianceEmail: "", securityEmail: "",
    businessOwnerEmail: "", alertFrequency: "", severityThreshold: "", escalationFrequency: "",
    escalationContact: "", channels: ["Email"],
  });

  const [banner, setBanner] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Rehydrate on edit. Runs once — the parent remounts this via `key`.
  useEffect(() => {
    if (!editSystem) return;
    const meta = editSystem.metadata_json as Record<string, unknown> | undefined;
    const snap = meta?.registration as Snapshot | undefined;
    if (snap) {
      setBasicAll(snap.basic);
      setContextAll(snap.context);
      setOwnersAll(snap.owners);
      setFrameworks(snap.frameworks);
      setRiskAll(snap.risk);
      setMonitoringAll(snap.monitoring);
      setAlertsAll(snap.alerts);
      models.replace(snap.models ?? []);
      endpoints.replace(snap.endpoints ?? []);
      dataSources.replace(snap.dataSources ?? []);
      documents.replace(snap.documents ?? []);
      metrics.replace(snap.metrics ?? []);
    } else {
      // Legacy system without a saved snapshot — prefill the columns we have.
      setBasicAll((p) => ({
        ...p,
        name: editSystem.name,
        description: editSystem.description ?? "",
        version: editSystem.model_version ?? "",
        status: titleCase(editSystem.status),
        deploymentEnvironment: titleCase(editSystem.deployment_environment),
      }));
      setOwnersAll((p) => ({ ...p, systemOwnerName: editSystem.owner }));
      setFrameworks((p) => {
        const next = { ...p };
        for (const fw of FRAMEWORKS) {
          if (editSystem.selected_frameworks.some((sf) => sf.toLowerCase().replace(/[^a-z]/g, "") === fw.toLowerCase().replace(/[^a-z]/g, ""))) {
            next[fw] = { ...next[fw], selected: true };
          }
        }
        return next;
      });
    }
  }, [editSystem]);

  const setFw = (fw: string, patch: Partial<FrameworkSel>) => setFrameworks((p) => ({ ...p, [fw]: { ...p[fw], ...patch } }));
  const selectedFrameworks = useMemo(() => FRAMEWORKS.filter((f) => frameworks[f].selected), [frameworks]);
  const toggleChannel = (ch: string) =>
    setAlerts("channels", alerts.channels.includes(ch) ? alerts.channels.filter((c) => c !== ch) : [...alerts.channels, ch]);

  const missing = useMemo(() => {
    const m: string[] = [];
    if (!basic.name.trim()) m.push("AI System Name");
    if (!basic.systemType) m.push("System Type");
    if (!basic.deploymentEnvironment) m.push("Deployment Environment");
    if (!basic.status) m.push("Current Status");
    if (!context.businessPurpose.trim()) m.push("Business Purpose");
    if (!owners.systemOwnerName.trim()) m.push("System Owner Name");
    if (!owners.systemOwnerEmail.trim() || !isEmail(owners.systemOwnerEmail)) m.push("System Owner Email (valid)");
    if (selectedFrameworks.length === 0) m.push("At least one Framework");
    if (!risk.riskTier) m.push("Risk Tier");
    if (alerts.enabled && (!alerts.primaryEmail.trim() || !isEmail(alerts.primaryEmail))) m.push("Primary Alert Email (valid)");
    return m;
  }, [basic, context, owners, selectedFrameworks, risk, alerts]);

  const snapshot = (): Snapshot => ({
    basic, context, owners, frameworks, risk, monitoring, alerts,
    models: models.items.map(withoutId),
    endpoints: endpoints.items.map(withoutId),
    dataSources: dataSources.items.map(withoutId),
    documents: documents.items.map(withoutId),
    metrics: metrics.items.map(withoutId),
  });

  const persist = async (returnToList: boolean) => {
    const snap = snapshot();
    const core: BackendAISystemCreate = {
      name: basic.name.trim(),
      description: basic.description.trim() || null,
      owner: (owners.systemOwnerName || owners.systemOwnerEmail || "Unassigned").trim(),
      system_type: (basic.systemType || "other").toLowerCase().replace(/[\s/]+/g, "_"),
      risk_tier: mapRiskTier(risk.riskTier),
      deployment_environment: (basic.deploymentEnvironment || "production").toLowerCase(),
      selected_frameworks: selectedFrameworks,
      model_provider: models.items[0]?.provider.trim() || "azure_foundry",
      model_name: models.items[0]?.name.trim() || null,
      model_version: models.items[0]?.version.trim() || basic.version.trim() || null,
      target_endpoint_ref: endpoints.items.find((e) => isHttpUrl(e.url))?.url.trim() ?? null,
      metadata_json: { registration: snap, criticality: basic.criticality, modality: basic.modality },
    };

    setSubmitting(true);
    setBanner(null);
    try {
      const saved = editSystem?.id
        ? await updateAISystem(editSystem.id, core)
        : await createAISystem(core);

      // On first registration, register any HTTP endpoints as target endpoints.
      // Skipped on edit to avoid duplicate-name conflicts on repeated saves.
      if (!editSystem?.id) {
        for (const [i, e] of endpoints.items.entries()) {
          if (!isHttpUrl(e.url)) continue;
          try {
            await createTargetEndpoint(saved.id, {
              name: e.name.trim() || `endpoint-${i + 1}`,
              url: e.url.trim(),
              http_method: e.httpMethod as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
              is_default: i === 0,
            });
          } catch {
            /* best-effort — endpoint issues shouldn't block registration */
          }
        }
      }

      console.info("[RegisterAISystem] persisted", { id: saved.id, snapshot: snap });
      if (returnToList) {
        onDone();
      } else {
        setBanner({ tone: "success", text: `Draft saved — "${saved.name}" is registered. Continue editing or return to the list.` });
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (err) {
      setBanner({ tone: "error", text: err instanceof Error ? err.message : "Unable to save the AI system." });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveDraft = () => {
    if (!basic.name.trim()) {
      setBanner({ tone: "error", text: "AI System Name is required before saving." });
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    void persist(false);
  };

  const handleSubmit = () => {
    if (missing.length > 0) {
      setBanner({ tone: "error", text: `Cannot submit — ${missing.length} required field${missing.length === 1 ? "" : "s"} missing. See Review & Submit.` });
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    void persist(true);
  };

  return (
    <div className="space-y-5 pb-16">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-[16px] text-ink dark:text-white">
            {editSystem ? `Edit — ${editSystem.name}` : "Register AI System"}
          </h2>
          <p className="text-[12px] text-slate-500 dark:text-slate-400">
            {editSystem ? "Update this AI system's governance registration." : "Register one AI system end-to-end for enterprise AI governance."}
          </p>
        </div>
        <button type="button" onClick={onCancel} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-[12px] font-medium text-slate-600 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
          <X className="h-3.5 w-3.5" /> Close
        </button>
      </div>

      {banner && (
        <div className={clsx(
          "flex items-start gap-2 rounded-lg border px-4 py-3 text-[12px]",
          banner.tone === "success"
            ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300"
            : "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400",
        )}>
          {banner.tone === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span className="flex-1">{banner.text}</span>
          <button type="button" onClick={() => setBanner(null)} className="text-current/70 hover:text-current"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* 1 — Basic System Information */}
      <SectionCard index={1} title="Basic System Information" icon={Info} description="Identity and classification of the AI system.">
        <Grid>
          <Field label="AI System Name" required><TextField value={basic.name} onChange={(v) => setBasic("name", v)} placeholder="Customer Support Assistant" /></Field>
          <Field label="System Type" required><SelectField value={basic.systemType} onChange={(v) => setBasic("systemType", v)} options={SYSTEM_TYPES} /></Field>
        </Grid>
        <Field label="Description"><TextArea value={basic.description} onChange={(v) => setBasic("description", v)} placeholder="What the system does and how it is used." /></Field>
        <Grid cols={3}>
          <Field label="Deployment Environment" required><SelectField value={basic.deploymentEnvironment} onChange={(v) => setBasic("deploymentEnvironment", v)} options={DEPLOY_ENVS} /></Field>
          <Field label="Current Status" required><SelectField value={basic.status} onChange={(v) => setBasic("status", v)} options={STATUSES} /></Field>
          <Field label="Production Criticality"><SelectField value={basic.criticality} onChange={(v) => setBasic("criticality", v)} options={CRITICALITY} /></Field>
        </Grid>
        <Grid cols={3}>
          <Field label="Business Unit"><TextField value={basic.businessUnit} onChange={(v) => setBasic("businessUnit", v)} placeholder="Customer Operations" /></Field>
          <Field label="Organization / Tenant"><TextField value={basic.organization} onChange={(v) => setBasic("organization", v)} placeholder="Northwind Financial" /></Field>
          <Field label="Version"><TextField value={basic.version} onChange={(v) => setBasic("version", v)} placeholder="v1.0" /></Field>
        </Grid>
        <Grid>
          <Field label="Primary Use Case"><TextField value={basic.primaryUseCase} onChange={(v) => setBasic("primaryUseCase", v)} placeholder="Answer product questions over the knowledge base" /></Field>
          <Field label="Modality"><SelectField value={basic.modality} onChange={(v) => setBasic("modality", v)} options={MODALITIES} /></Field>
        </Grid>
      </SectionCard>

      {/* 2 — Application Context */}
      <SectionCard index={2} title="Application Context" icon={Layers} description="How the system operates in production.">
        <Field label="Business Purpose" required><TextArea value={context.businessPurpose} onChange={(v) => setContext("businessPurpose", v)} placeholder="The business problem this system solves." /></Field>
        <Grid>
          <Field label="Intended Users"><TextField value={context.intendedUsers} onChange={(v) => setContext("intendedUsers", v)} placeholder="Internal support agents" /></Field>
          <Field label="Affected Users"><TextField value={context.affectedUsers} onChange={(v) => setContext("affectedUsers", v)} placeholder="End customers" /></Field>
          <Field label="Industry Domain"><TextField value={context.industryDomain} onChange={(v) => setContext("industryDomain", v)} placeholder="Financial services" /></Field>
          <Field label="Geographic Scope"><TextField value={context.geographicScope} onChange={(v) => setContext("geographicScope", v)} placeholder="EU, US" /></Field>
          <Field label="Decision Impact"><SelectField value={context.decisionImpact} onChange={(v) => setContext("decisionImpact", v)} options={DECISION_IMPACT} /></Field>
          <Field label="Automation Level"><SelectField value={context.automationLevel} onChange={(v) => setContext("automationLevel", v)} options={AUTOMATION_LEVEL} /></Field>
          <Field label="Human Oversight"><TextField value={context.humanOversight} onChange={(v) => setContext("humanOversight", v)} placeholder="Agent reviews before send" /></Field>
          <Field label="Expected Usage Volume"><TextField value={context.expectedUsageVolume} onChange={(v) => setContext("expectedUsageVolume", v)} placeholder="~5,000 requests/day" /></Field>
        </Grid>
        <Field label="Fallback Process"><TextArea value={context.fallbackProcess} onChange={(v) => setContext("fallbackProcess", v)} rows={2} placeholder="What happens when the system is unavailable or low-confidence." /></Field>
        <Field label="Escalation Process"><TextArea value={context.escalationProcess} onChange={(v) => setContext("escalationProcess", v)} rows={2} placeholder="How issues are escalated to a human." /></Field>
      </SectionCard>

      {/* 3 — Ownership & Contacts */}
      <SectionCard index={3} title="Ownership & Contacts" icon={Users} description="Accountable owners across the system lifecycle.">
        {([
          ["System Owner", "systemOwnerName", "systemOwnerEmail"],
          ["Technical Owner", "technicalOwnerName", "technicalOwnerEmail"],
          ["Business Owner", "businessOwnerName", "businessOwnerEmail"],
          ["Compliance Owner", "complianceOwnerName", "complianceOwnerEmail"],
          ["Security Owner", "securityOwnerName", "securityOwnerEmail"],
          ["Data Owner", "dataOwnerName", "dataOwnerEmail"],
        ] as const).map(([label, nameKey, emailKey]) => (
          <Grid key={label}>
            <Field label={`${label} Name`} required={nameKey === "systemOwnerName"}>
              <TextField value={owners[nameKey]} onChange={(v) => setOwners(nameKey, v)} placeholder="Full name" />
            </Field>
            <Field label={`${label} Email`} required={emailKey === "systemOwnerEmail"}>
              <TextField value={owners[emailKey]} onChange={(v) => setOwners(emailKey, v)} type="email" placeholder="name@company.com" />
            </Field>
          </Grid>
        ))}
        <Grid cols={3}>
          <Field label="Review Frequency"><SelectField value={owners.reviewFrequency} onChange={(v) => setOwners("reviewFrequency", v)} options={REVIEW_FREQ} /></Field>
          <Field label="Next Review Date"><TextField value={owners.nextReviewDate} onChange={(v) => setOwners("nextReviewDate", v)} type="date" /></Field>
          <Field label="Escalation Contact"><TextField value={owners.escalationContact} onChange={(v) => setOwners("escalationContact", v)} placeholder="oncall@company.com" /></Field>
        </Grid>
      </SectionCard>

      {/* 4 — Framework Selection */}
      <SectionCard index={4} title="Framework Selection" icon={ClipboardCheck} description="Select applicable governance frameworks and capture their details.">
        <div className="grid gap-3 sm:grid-cols-2">
          {FRAMEWORKS.map((fw) => {
            const sel = frameworks[fw];
            return (
              <div key={fw} className={clsx("rounded-lg border p-3 transition-colors", sel.selected ? "border-brand-400 bg-brand-50/50 dark:border-brand-700 dark:bg-brand-950/20" : "border-slate-200 dark:border-slate-700")}>
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={sel.selected} onChange={(e) => setFw(fw, { selected: e.target.checked })} />
                  <span className="text-[13px] font-semibold text-slate-900 dark:text-white">{fw}</span>
                </label>
                {sel.selected && (
                  <div className="mt-3 space-y-3">
                    <Field label="Applicability Reason"><TextArea value={sel.applicabilityReason} onChange={(v) => setFw(fw, { applicabilityReason: v })} rows={2} placeholder="Why this framework applies." /></Field>
                    <Grid>
                      <Field label="Priority"><SelectField value={sel.priority} onChange={(v) => setFw(fw, { priority: v })} options={PRIORITIES} /></Field>
                      <Field label="Compliance Owner"><TextField value={sel.complianceOwner} onChange={(v) => setFw(fw, { complianceOwner: v })} placeholder="name@company.com" /></Field>
                      <Field label="Review Frequency"><SelectField value={sel.reviewFrequency} onChange={(v) => setFw(fw, { reviewFrequency: v })} options={REVIEW_FREQ} /></Field>
                      <Field label="Evidence Required"><TextField value={sel.evidenceRequired} onChange={(v) => setFw(fw, { evidenceRequired: v })} placeholder="Model card, red-team report…" /></Field>
                    </Grid>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* 5 — Model Details */}
      <SectionCard index={5} title="Model Details" icon={Boxes} description="One or more models powering this system.">
        {models.items.length === 0 && <EmptyHint>No models added yet.</EmptyHint>}
        {models.items.map((m, i) => (
          <RepeatableItem key={m.id} title={`Model ${i + 1}`} onRemove={() => models.remove(m.id)}>
            <Grid>
              <Field label="Model Name"><TextField value={m.name} onChange={(v) => models.update(m.id, { name: v })} placeholder="gpt-4.1" /></Field>
              <Field label="Provider"><TextField value={m.provider} onChange={(v) => models.update(m.id, { provider: v })} placeholder="Azure OpenAI" /></Field>
              <Field label="Model Version"><TextField value={m.version} onChange={(v) => models.update(m.id, { version: v })} placeholder="2024-08" /></Field>
              <Field label="Model Type"><TextField value={m.modelType} onChange={(v) => models.update(m.id, { modelType: v })} placeholder="LLM / embedding / classifier" /></Field>
              <Field label="Hosting Location"><TextField value={m.hostingLocation} onChange={(v) => models.update(m.id, { hostingLocation: v })} placeholder="Azure Sweden Central" /></Field>
              <Field label="Fallback Model"><TextField value={m.fallbackModel} onChange={(v) => models.update(m.id, { fallbackModel: v })} placeholder="gpt-4o-mini" /></Field>
              <Field label="Input Modality"><SelectField value={m.inputModality} onChange={(v) => models.update(m.id, { inputModality: v })} options={MODALITIES} /></Field>
              <Field label="Output Modality"><SelectField value={m.outputModality} onChange={(v) => models.update(m.id, { outputModality: v })} options={MODALITIES} /></Field>
            </Grid>
            <Field label="Default Parameters"><TextArea value={m.defaultParameters} onChange={(v) => models.update(m.id, { defaultParameters: v })} rows={2} placeholder='{"temperature": 0.2, "max_tokens": 1024}' /></Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Is Fine-Tuned?"><BoolField value={m.fineTuned} onChange={(v) => models.update(m.id, { fineTuned: v })} /></Field>
              <Field label="Is Open Source?"><BoolField value={m.openSource} onChange={(v) => models.update(m.id, { openSource: v })} /></Field>
              <Field label="Is Third-Party?"><BoolField value={m.thirdParty} onChange={(v) => models.update(m.id, { thirdParty: v })} /></Field>
              <Field label="Training Data Known?"><BoolField value={m.trainingDataKnown} onChange={(v) => models.update(m.id, { trainingDataKnown: v })} /></Field>
              <Field label="Safety Filters Enabled?"><BoolField value={m.safetyFilters} onChange={(v) => models.update(m.id, { safetyFilters: v })} /></Field>
            </div>
          </RepeatableItem>
        ))}
        <AddButton label="Add Model" onClick={() => models.add(newModel)} />
      </SectionCard>

      {/* 6 — Endpoint / Gateway Details */}
      <SectionCard index={6} title="Endpoint / Gateway Details" icon={Plug} description="HTTP endpoints and gateways the system is reachable at.">
        {endpoints.items.length === 0 && <EmptyHint>No endpoints added yet.</EmptyHint>}
        {endpoints.items.map((e, i) => (
          <RepeatableItem key={e.id} title={`Endpoint ${i + 1}`} onRemove={() => endpoints.remove(e.id)}>
            <Grid>
              <Field label="Endpoint Name"><TextField value={e.name} onChange={(v) => endpoints.update(e.id, { name: v })} placeholder="prod-us" /></Field>
              <Field label="Endpoint URL"><TextField value={e.url} onChange={(v) => endpoints.update(e.id, { url: v })} placeholder="https://api.example.com/chat" /></Field>
              <Field label="HTTP Method"><SelectField value={e.httpMethod} onChange={(v) => endpoints.update(e.id, { httpMethod: v })} options={HTTP_METHODS} /></Field>
              <Field label="Gateway Type"><SelectField value={e.gatewayType} onChange={(v) => endpoints.update(e.id, { gatewayType: v })} options={GATEWAY_TYPES} /></Field>
              <Field label="Authentication Type"><SelectField value={e.authType} onChange={(v) => endpoints.update(e.id, { authType: v })} options={AUTH_TYPES} /></Field>
              <Field label="Connected Model"><TextField value={e.connectedModel} onChange={(v) => endpoints.update(e.id, { connectedModel: v })} placeholder="gpt-4.1" /></Field>
              <Field label="Rate Limit"><TextField value={e.rateLimit} onChange={(v) => endpoints.update(e.id, { rateLimit: v })} placeholder="60 req/min" /></Field>
              <Field label="Timeout (seconds)"><TextField value={e.timeout} onChange={(v) => endpoints.update(e.id, { timeout: v })} type="number" /></Field>
              <Field label="Public or Internal"><SelectField value={e.visibility} onChange={(v) => endpoints.update(e.id, { visibility: v })} options={["Internal", "Public"]} /></Field>
              <Field label="Data Retention"><TextField value={e.dataRetention} onChange={(v) => endpoints.update(e.id, { dataRetention: v })} placeholder="30 days" /></Field>
              <Field label="Endpoint Status"><SelectField value={e.status} onChange={(v) => endpoints.update(e.id, { status: v })} options={["Active", "Inactive", "Deprecated"]} /></Field>
            </Grid>
            <Grid>
              <Field label="Input Schema"><TextArea value={e.inputSchema} onChange={(v) => endpoints.update(e.id, { inputSchema: v })} rows={2} placeholder='{"message": "string"}' /></Field>
              <Field label="Output Schema"><TextArea value={e.outputSchema} onChange={(v) => endpoints.update(e.id, { outputSchema: v })} rows={2} placeholder='{"response": "string"}' /></Field>
            </Grid>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Logging Enabled"><BoolField value={e.loggingEnabled} onChange={(v) => endpoints.update(e.id, { loggingEnabled: v })} /></Field>
              <Field label="Monitoring Enabled"><BoolField value={e.monitoringEnabled} onChange={(v) => endpoints.update(e.id, { monitoringEnabled: v })} /></Field>
              <Field label="PII Allowed"><BoolField value={e.piiAllowed} onChange={(v) => endpoints.update(e.id, { piiAllowed: v })} /></Field>
            </div>
          </RepeatableItem>
        ))}
        <AddButton label="Add Endpoint" onClick={() => endpoints.add(newEndpoint)} />
      </SectionCard>

      {/* 7 — Data Sources */}
      <SectionCard index={7} title="Data Sources" icon={Database} description="Data the system trains on, retrieves from, or serves at inference.">
        {dataSources.items.length === 0 && <EmptyHint>No data sources added yet.</EmptyHint>}
        {dataSources.items.map((d, i) => (
          <RepeatableItem key={d.id} title={`Data Source ${i + 1}`} onRemove={() => dataSources.remove(d.id)}>
            <Grid>
              <Field label="Data Source Name"><TextField value={d.name} onChange={(v) => dataSources.update(d.id, { name: v })} placeholder="Product KB" /></Field>
              <Field label="Data Source Type"><SelectField value={d.sourceType} onChange={(v) => dataSources.update(d.id, { sourceType: v })} options={DATA_SOURCE_TYPES} /></Field>
              <Field label="Data Classification"><SelectField value={d.classification} onChange={(v) => dataSources.update(d.id, { classification: v })} options={DATA_CLASSIFICATIONS} /></Field>
              <Field label="Data Owner"><TextField value={d.dataOwner} onChange={(v) => dataSources.update(d.id, { dataOwner: v })} placeholder="data-team@company.com" /></Field>
              <Field label="Source System"><TextField value={d.sourceSystem} onChange={(v) => dataSources.update(d.id, { sourceSystem: v })} placeholder="Confluence" /></Field>
              <Field label="Retention Period"><TextField value={d.retentionPeriod} onChange={(v) => dataSources.update(d.id, { retentionPeriod: v })} placeholder="90 days" /></Field>
              <Field label="Data Residency"><TextField value={d.dataResidency} onChange={(v) => dataSources.update(d.id, { dataResidency: v })} placeholder="EU" /></Field>
              <Field label="Access Control"><TextField value={d.accessControl} onChange={(v) => dataSources.update(d.id, { accessControl: v })} placeholder="RBAC / SSO" /></Field>
            </Grid>
            <Field label="Deletion Process"><TextArea value={d.deletionProcess} onChange={(v) => dataSources.update(d.id, { deletionProcess: v })} rows={2} placeholder="How data is deleted on request." /></Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Contains PII?"><BoolField value={d.containsPii} onChange={(v) => dataSources.update(d.id, { containsPii: v })} /></Field>
              <Field label="Contains Sensitive Data?"><BoolField value={d.containsSensitive} onChange={(v) => dataSources.update(d.id, { containsSensitive: v })} /></Field>
              <Field label="Encryption Enabled"><BoolField value={d.encryptionEnabled} onChange={(v) => dataSources.update(d.id, { encryptionEnabled: v })} /></Field>
              <Field label="Used for Training?"><BoolField value={d.usedForTraining} onChange={(v) => dataSources.update(d.id, { usedForTraining: v })} /></Field>
              <Field label="Used for Inference?"><BoolField value={d.usedForInference} onChange={(v) => dataSources.update(d.id, { usedForInference: v })} /></Field>
              <Field label="Used for RAG?"><BoolField value={d.usedForRag} onChange={(v) => dataSources.update(d.id, { usedForRag: v })} /></Field>
              <Field label="Consent Required"><BoolField value={d.consentRequired} onChange={(v) => dataSources.update(d.id, { consentRequired: v })} /></Field>
            </div>
            {d.usedForRag && (
              <div className="rounded-lg border border-brand-200 bg-brand-50/40 p-3 dark:border-brand-800/50 dark:bg-brand-950/20">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">RAG Configuration</p>
                <Grid>
                  <Field label="Vector Database"><TextField value={d.vectorDatabase} onChange={(v) => dataSources.update(d.id, { vectorDatabase: v })} placeholder="pgvector / Pinecone" /></Field>
                  <Field label="Embedding Model"><TextField value={d.embeddingModel} onChange={(v) => dataSources.update(d.id, { embeddingModel: v })} placeholder="text-embedding-3-large" /></Field>
                  <Field label="Chunk Size"><TextField value={d.chunkSize} onChange={(v) => dataSources.update(d.id, { chunkSize: v })} type="number" placeholder="800" /></Field>
                  <Field label="Chunk Overlap"><TextField value={d.chunkOverlap} onChange={(v) => dataSources.update(d.id, { chunkOverlap: v })} type="number" placeholder="100" /></Field>
                  <Field label="Retrieval Method"><SelectField value={d.retrievalMethod} onChange={(v) => dataSources.update(d.id, { retrievalMethod: v })} options={RETRIEVAL_METHODS} /></Field>
                  <Field label="Top-K"><TextField value={d.topK} onChange={(v) => dataSources.update(d.id, { topK: v })} type="number" placeholder="5" /></Field>
                  <Field label="Document Refresh Frequency"><SelectField value={d.refreshFrequency} onChange={(v) => dataSources.update(d.id, { refreshFrequency: v })} options={MONITOR_FREQ} /></Field>
                  <Field label="Citation Required"><BoolField value={d.citationRequired} onChange={(v) => dataSources.update(d.id, { citationRequired: v })} /></Field>
                </Grid>
              </div>
            )}
          </RepeatableItem>
        ))}
        <AddButton label="Add Data Source" onClick={() => dataSources.add(newDataSource)} />
      </SectionCard>

      {/* 8 — Documents Upload */}
      <SectionCard index={8} title="Documents Upload" icon={FileText} description="Governance evidence and supporting documentation.">
        {documents.items.length === 0 && <EmptyHint>No documents added yet.</EmptyHint>}
        {documents.items.map((doc, i) => (
          <RepeatableItem key={doc.id} title={`Document ${i + 1}`} onRemove={() => documents.remove(doc.id)}>
            <Grid>
              <Field label="Document Name"><TextField value={doc.name} onChange={(v) => documents.update(doc.id, { name: v })} placeholder="System Architecture v2" /></Field>
              <Field label="Document Type"><SelectField value={doc.docType} onChange={(v) => documents.update(doc.id, { docType: v })} options={DOC_TYPES} /></Field>
              <Field label="Linked Framework"><SelectField value={doc.linkedFramework} onChange={(v) => documents.update(doc.id, { linkedFramework: v })} options={FRAMEWORKS} /></Field>
              <Field label="Linked Section"><TextField value={doc.linkedSection} onChange={(v) => documents.update(doc.id, { linkedSection: v })} placeholder="Art. 11 / Annex IV" /></Field>
              <Field label="Version"><TextField value={doc.version} onChange={(v) => documents.update(doc.id, { version: v })} placeholder="1.0" /></Field>
              <Field label="Required or Optional"><SelectField value={doc.requirement} onChange={(v) => documents.update(doc.id, { requirement: v })} options={["Required", "Optional"]} /></Field>
              <Field label="Expiry Date"><TextField value={doc.expiryDate} onChange={(v) => documents.update(doc.id, { expiryDate: v })} type="date" /></Field>
              <Field label="Reviewer"><TextField value={doc.reviewer} onChange={(v) => documents.update(doc.id, { reviewer: v })} placeholder="compliance@company.com" /></Field>
            </Grid>
            <Field label="Uploaded File" hint={doc.fileName ? `Selected: ${doc.fileName}` : "Mock upload — filename is captured, file is not sent."}>
              <input type="file" onChange={(ev) => documents.update(doc.id, { fileName: ev.target.files?.[0]?.name ?? "" })} className="block w-full text-[12px] text-slate-600 file:mr-3 file:rounded file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-[12px] file:font-semibold file:text-brand-700 dark:text-slate-400 dark:file:bg-brand-950/40 dark:file:text-brand-300" />
            </Field>
            <Field label="Notes"><TextArea value={doc.notes} onChange={(v) => documents.update(doc.id, { notes: v })} rows={2} /></Field>
          </RepeatableItem>
        ))}
        <AddButton label="Add Document" onClick={() => documents.add(newDocument)} />
      </SectionCard>

      {/* 9 — Risk & Impact Assessment */}
      <SectionCard index={9} title="Risk & Impact Assessment" icon={ShieldAlert} description="Risk tier, impact, and screening questions.">
        <Grid cols={3}>
          <Field label="Risk Tier" required><SelectField value={risk.riskTier} onChange={(v) => setRisk("riskTier", v)} options={RISK_TIERS} /></Field>
          <Field label="Risk Score"><TextField value={risk.riskScore} onChange={(v) => setRisk("riskScore", v)} type="number" placeholder="0–100" /></Field>
          <Field label="Impact Level"><SelectField value={risk.impactLevel} onChange={(v) => setRisk("impactLevel", v)} options={IMPACT_LEVELS} /></Field>
          <Field label="Likelihood Level"><SelectField value={risk.likelihoodLevel} onChange={(v) => setRisk("likelihoodLevel", v)} options={LIKELIHOOD_LEVELS} /></Field>
          <Field label="Data Sensitivity"><SelectField value={risk.dataSensitivity} onChange={(v) => setRisk("dataSensitivity", v)} options={DATA_CLASSIFICATIONS} /></Field>
          <Field label="Automation Risk"><SelectField value={risk.automationRisk} onChange={(v) => setRisk("automationRisk", v)} options={LEVELS} /></Field>
          <Field label="User Harm Potential"><SelectField value={risk.userHarmPotential} onChange={(v) => setRisk("userHarmPotential", v)} options={LEVELS} /></Field>
          <Field label="Bias / Fairness Risk"><SelectField value={risk.biasRisk} onChange={(v) => setRisk("biasRisk", v)} options={LEVELS} /></Field>
          <Field label="Privacy Risk"><SelectField value={risk.privacyRisk} onChange={(v) => setRisk("privacyRisk", v)} options={LEVELS} /></Field>
          <Field label="Security Risk"><SelectField value={risk.securityRisk} onChange={(v) => setRisk("securityRisk", v)} options={LEVELS} /></Field>
          <Field label="Explainability Requirement"><SelectField value={risk.explainabilityRequirement} onChange={(v) => setRisk("explainabilityRequirement", v)} options={REQUIREMENT_LEVELS} /></Field>
          <Field label="Human Oversight Requirement"><SelectField value={risk.humanOversightRequirement} onChange={(v) => setRisk("humanOversightRequirement", v)} options={REQUIREMENT_LEVELS} /></Field>
        </Grid>
        <Field label="Final Risk Rationale"><TextArea value={risk.finalRiskRationale} onChange={(v) => setRisk("finalRiskRationale", v)} placeholder="Justification for the assigned risk tier." /></Field>
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Risk Screening Questions</p>
          <div className="space-y-2">
            {RISK_QUESTIONS.map((q) => (
              <div key={q.key} className="flex items-center justify-between gap-3 rounded border border-slate-200 bg-slate-50/60 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/40">
                <span className="text-[12px] text-slate-700 dark:text-slate-300">{q.q}</span>
                <BoolField value={risk.questions[q.key]} onChange={(v) => setRisk("questions", { ...risk.questions, [q.key]: v })} />
              </div>
            ))}
          </div>
        </div>
      </SectionCard>

      {/* 10 — Metrics & Threshold Configuration */}
      <SectionCard index={10} title="Metrics & Threshold Configuration" icon={Gauge} description="Evaluation metrics, thresholds, and tooling.">
        {metrics.items.length === 0 && <EmptyHint>No metrics added yet.</EmptyHint>}
        {metrics.items.map((mt, i) => (
          <RepeatableItem key={mt.id} title={`Metric ${i + 1}`} onRemove={() => metrics.remove(mt.id)}>
            <Grid>
              <Field label="Metric Name"><TextField value={mt.name} onChange={(v) => metrics.update(mt.id, { name: v })} placeholder="Hallucination Rate" /></Field>
              <Field label="Metric Dimension"><SelectField value={mt.dimension} onChange={(v) => metrics.update(mt.id, { dimension: v })} options={METRIC_DIMENSIONS} /></Field>
              <Field label="Framework Mapping"><SelectField value={mt.frameworkMapping} onChange={(v) => metrics.update(mt.id, { frameworkMapping: v })} options={FRAMEWORKS} /></Field>
              <Field label="Tool Used"><SelectField value={mt.tool} onChange={(v) => metrics.update(mt.id, { tool: v })} options={METRIC_TOOLS} /></Field>
              <Field label="Threshold"><TextField value={mt.threshold} onChange={(v) => metrics.update(mt.id, { threshold: v })} placeholder="< 0.05" /></Field>
              <Field label="Severity"><SelectField value={mt.severity} onChange={(v) => metrics.update(mt.id, { severity: v })} options={SEVERITIES} /></Field>
              <Field label="Run Frequency"><SelectField value={mt.runFrequency} onChange={(v) => metrics.update(mt.id, { runFrequency: v })} options={RUN_FREQ} /></Field>
              <Field label="Applies to Endpoint"><TextField value={mt.appliesToEndpoint} onChange={(v) => metrics.update(mt.id, { appliesToEndpoint: v })} placeholder="All / prod-us" /></Field>
              <Field label="Applies to Model"><TextField value={mt.appliesToModel} onChange={(v) => metrics.update(mt.id, { appliesToModel: v })} placeholder="All / gpt-4.1" /></Field>
            </Grid>
            <Field label="Required for Approval?"><BoolField value={mt.requiredForApproval} onChange={(v) => metrics.update(mt.id, { requiredForApproval: v })} /></Field>
          </RepeatableItem>
        ))}
        <AddButton label="Add Metric" onClick={() => metrics.add(newMetric)} />
      </SectionCard>

      {/* 11 — Monitoring Configuration */}
      <SectionCard index={11} title="Monitoring Configuration" icon={Gauge} description="What to monitor in production and how often.">
        <Grid cols={3}>
          <Field label="Monitoring Enabled"><BoolField value={monitoring.enabled} onChange={(v) => setMonitoring("enabled", v)} /></Field>
          <Field label="Monitoring Frequency"><SelectField value={monitoring.frequency} onChange={(v) => setMonitoring("frequency", v)} options={MONITOR_FREQ} /></Field>
          <div />
          <Field label="Monitored Endpoints"><TextField value={monitoring.monitoredEndpoints} onChange={(v) => setMonitoring("monitoredEndpoints", v)} placeholder="All / prod-us" /></Field>
          <Field label="Monitored Models"><TextField value={monitoring.monitoredModels} onChange={(v) => setMonitoring("monitoredModels", v)} placeholder="All / gpt-4.1" /></Field>
        </Grid>
        <div className="grid gap-3 sm:grid-cols-3">
          {([
            ["Latency Monitoring", "latency"], ["Error Rate Monitoring", "errorRate"], ["Cost Monitoring", "cost"],
            ["Token Usage Monitoring", "tokenUsage"], ["Prompt Injection Monitoring", "promptInjection"], ["Hallucination Monitoring", "hallucination"],
            ["PII Leakage Monitoring", "piiLeakage"], ["Bias Drift Monitoring", "biasDrift"], ["Data Drift Monitoring", "dataDrift"],
            ["Human Override Monitoring", "humanOverride"], ["Feedback Monitoring", "feedback"],
          ] as const).map(([label, key]) => (
            <Field key={key} label={label}><BoolField value={monitoring[key]} onChange={(v) => setMonitoring(key, v)} /></Field>
          ))}
        </div>
      </SectionCard>

      {/* 12 — Alerts & Notification Settings */}
      <SectionCard index={12} title="Alerts & Notification Settings" icon={AlertTriangle} description="Who gets notified, how, and how often.">
        <Field label="Enable Alerts"><BoolField value={alerts.enabled} onChange={(v) => setAlerts("enabled", v)} /></Field>
        <Grid>
          <Field label="Primary Alert Email" required={alerts.enabled}><TextField value={alerts.primaryEmail} onChange={(v) => setAlerts("primaryEmail", v)} type="email" placeholder="alerts@company.com" /></Field>
          <Field label="Technical Alert Email"><TextField value={alerts.technicalEmail} onChange={(v) => setAlerts("technicalEmail", v)} type="email" /></Field>
          <Field label="Compliance Alert Email"><TextField value={alerts.complianceEmail} onChange={(v) => setAlerts("complianceEmail", v)} type="email" /></Field>
          <Field label="Security Alert Email"><TextField value={alerts.securityEmail} onChange={(v) => setAlerts("securityEmail", v)} type="email" /></Field>
          <Field label="Business Owner Alert Email"><TextField value={alerts.businessOwnerEmail} onChange={(v) => setAlerts("businessOwnerEmail", v)} type="email" /></Field>
          <Field label="Escalation Contact"><TextField value={alerts.escalationContact} onChange={(v) => setAlerts("escalationContact", v)} placeholder="oncall@company.com" /></Field>
          <Field label="Alert Frequency"><SelectField value={alerts.alertFrequency} onChange={(v) => setAlerts("alertFrequency", v)} options={ALERT_FREQ} /></Field>
          <Field label="Alert Severity Threshold"><SelectField value={alerts.severityThreshold} onChange={(v) => setAlerts("severityThreshold", v)} options={SEVERITIES} /></Field>
          <Field label="Escalation Frequency"><SelectField value={alerts.escalationFrequency} onChange={(v) => setAlerts("escalationFrequency", v)} options={ALERT_FREQ} /></Field>
        </Grid>
        <Field label="Notification Channels">
          <div className="flex flex-wrap gap-2">
            {NOTIFICATION_CHANNELS.map((ch) => (
              <button
                key={ch}
                type="button"
                onClick={() => toggleChannel(ch)}
                className={clsx(
                  "rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors",
                  alerts.channels.includes(ch)
                    ? "border-brand-400 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-950/30 dark:text-brand-300"
                    : "border-slate-300 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400",
                )}
              >
                {ch}
              </button>
            ))}
          </div>
        </Field>
      </SectionCard>

      {/* 13 — Review & Submit */}
      <SectionCard index={13} title="Review & Submit" icon={ClipboardCheck} description="Confirm the registration summary before submitting.">
        <div className="grid gap-2 sm:grid-cols-2">
          <SummaryRow label="System" value={basic.name || "—"} />
          <SummaryRow label="Type / Environment" value={[basic.systemType, basic.deploymentEnvironment].filter(Boolean).join(" · ") || "—"} />
          <SummaryRow label="Selected Frameworks" value={selectedFrameworks.length ? selectedFrameworks.join(", ") : "None"} />
          <SummaryRow label="Models Added" value={String(models.items.length)} />
          <SummaryRow label="Endpoints Added" value={String(endpoints.items.length)} />
          <SummaryRow label="Data Sources Added" value={String(dataSources.items.length)} />
          <SummaryRow label="Documents Uploaded" value={String(documents.items.length)} />
          <SummaryRow label="Metrics Configured" value={String(metrics.items.length)} />
          <SummaryRow label="Risk Tier" value={risk.riskTier || "—"} />
          <SummaryRow label="Monitoring Enabled" value={monitoring.enabled ? "Yes" : "No"} />
          <SummaryRow label="Alert Owners" value={[alerts.primaryEmail, alerts.technicalEmail, alerts.complianceEmail].filter(Boolean).join(", ") || "—"} />
        </div>

        <div className={clsx(
          "rounded-lg border px-4 py-3",
          missing.length === 0
            ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/50 dark:bg-emerald-950/20"
            : "border-amber-200 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-950/20",
        )}>
          {missing.length === 0 ? (
            <p className="flex items-center gap-2 text-[12px] font-medium text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" /> All required fields complete — ready to submit.
            </p>
          ) : (
            <div>
              <p className="flex items-center gap-2 text-[12px] font-semibold text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4" /> Missing required fields ({missing.length})
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {missing.map((m) => (
                  <span key={m} className="rounded-full border border-amber-300 bg-white px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-300">{m}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-2 text-[12px] font-medium text-slate-600 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
            Cancel
          </button>
          <button type="button" onClick={handleSaveDraft} disabled={submitting} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-[12px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
            <Save className="h-3.5 w-3.5" /> Save as Draft
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12px] font-semibold text-white transition disabled:opacity-70",
              missing.length === 0 ? "bg-brand-600 hover:bg-brand-700" : "bg-slate-400 hover:bg-slate-500",
            )}
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {editSystem ? "Save Changes" : "Submit Registration"}
          </button>
        </div>
      </SectionCard>

      <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-slate-400 dark:text-slate-500">
        <Building2 className="h-3 w-3" /> Enterprise AI Governance · Registration maps to ai_system, application_context, owners, frameworks, models, endpoints, data_sources, documents, risk_assessment, metrics, monitoring_config, alert_settings.
      </p>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded border border-slate-100 bg-slate-50/60 px-3 py-2 dark:border-slate-700/60 dark:bg-slate-800/40">
      <span className="text-[11px] text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-right text-[11px] font-medium text-slate-900 dark:text-white">{value}</span>
    </div>
  );
}
