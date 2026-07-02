import { useState } from "react";
import { AlertTriangle, Bot, CheckCircle2, ChevronDown, ChevronRight, Scale, ShieldCheck, Loader2, ExternalLink } from "lucide-react";
import clsx from "clsx";
import { DetailDrawer } from "@/components/layout/DetailDrawer";
import { Badge } from "@/components/ui/Badge";
import { useAppStore } from "@/store/useAppStore";
import type {
  AgentExecution,
  AuditLedgerEntry,
  BackendFinding,
  EvidenceRecord,
  GovernanceReport,
  GovernanceStateEntry,
  MetricResult,
  RunMetricPlanEntry,
  Verdict,
} from "@/api/governanceApi";

/** What the workflow can open in the side panel. */
export type WorkflowDrawerTarget =
  | { kind: "context" }
  | { kind: "agent"; agentKey: string }
  | { kind: "agents" }
  | { kind: "metric-plan" }
  | { kind: "council" }
  | { kind: "verdict" }
  | { kind: "ledger" }
  | { kind: "evidence"; findingId?: string };

/** Canonical specialist agents, in pipeline order. Rendered even when they have
 *  not run yet so a developer can see every agent's slot. */
const AGENT_ORDER = ["bias_agent", "drift_agent", "misuse_agent", "compliance_mapper", "explainability_agent", "risk_scorer"];

type BackendLike = {
  report: GovernanceReport | null;
  agentExecutions: AgentExecution[];
  findings: BackendFinding[];
  ledgerEntries: AuditLedgerEntry[];
  stateEntries: GovernanceStateEntry[];
  deliberate: () => Promise<unknown>;
};

const AGENT_LABELS: Record<string, string> = {
  bias_agent: "Bias Auditor",
  quality_agent: "Quality Evaluator",
  misuse_agent: "Misuse Detector",
  drift_agent: "Drift Analyst",
  compliance_mapper: "Compliance Mapper",
  risk_scorer: "Risk Scorer",
  explainability_agent: "Explainability Agent",
};

const AGENT_PURPOSE: Record<string, string> = {
  bias_agent: "Tests for systematic demographic disparity using controlled probe pairs — identical scenarios with only the protected attribute changed.",
  quality_agent: "Scores task success, instruction following, and output-format adherence against the run's quality metrics.",
  misuse_agent: "Red-teams the target with jailbreaks, prompt injection, role confusion, and tool-use manipulation probes.",
  drift_agent: "Compares current behaviour against a validated baseline — detecting tone shift, boundary erosion, and knowledge staleness.",
  compliance_mapper: "Maps system behaviour and documentation to selected framework clauses at pass / partial / fail granularity.",
  risk_scorer: "Aggregates every specialist finding into a composite risk score with a blast-radius multiplier. Does not call the target model.",
  explainability_agent: "Probes whether the model can explain its decisions accurately and whether those explanations are factually grounded.",
};

export function agentLabel(key: string): string {
  return AGENT_LABELS[key] ?? key.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function titleCase(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function severityTone(severity: string): "red" | "amber" | "green" | "slate" {
  const s = severity.toLowerCase();
  if (s === "critical" || s === "high") return "red";
  if (s === "medium") return "amber";
  if (s === "low") return "green";
  return "slate";
}

function statusTone(status: string): "green" | "amber" | "red" | "slate" {
  if (status === "completed") return "green";
  if (status === "running") return "amber";
  if (status === "failed") return "red";
  return "slate";
}

/** Dispatcher — renders the correct side-panel for the active workflow target. */
export function WorkflowDrawer({
  target,
  backend,
  onClose,
}: {
  target: WorkflowDrawerTarget | null;
  backend: BackendLike;
  onClose: () => void;
}) {
  if (!target) return null;
  switch (target.kind) {
    case "context":
      return <ContextDrawer backend={backend} onClose={onClose} />;
    case "agent":
      return <AgentDrawer agentKey={target.agentKey} backend={backend} onClose={onClose} />;
    case "agents":
      return <AgentsOverviewDrawer backend={backend} onClose={onClose} />;
    case "metric-plan":
      return <MetricPlanDrawer backend={backend} onClose={onClose} />;
    case "council":
      return <CouncilDrawer backend={backend} onClose={onClose} />;
    case "verdict":
      return <VerdictDrawer backend={backend} onClose={onClose} />;
    case "ledger":
      return <LedgerDrawer backend={backend} onClose={onClose} />;
    case "evidence":
      return <EvidenceDrawer backend={backend} findingId={target.findingId} onClose={onClose} />;
    default:
      return null;
  }
}

/* ─────────────────────────────────────────────────────────── Agent ─────── */

function AgentDrawer({ agentKey, backend, onClose }: { agentKey: string; backend: BackendLike; onClose: () => void }) {
  const [tab, setTab] = useState<"Overview" | "Inputs" | "Actions" | "Outputs" | "Evidence" | "Findings" | "Trace">("Overview");
  const report = backend.report;
  const execution = backend.agentExecutions.find((e) => e.agent_name === agentKey) ?? null;
  const agentFindings = backend.findings.filter((f) => f.agent_name === agentKey);
  const agentMetrics = (report?.metric_plan?.metrics ?? []).filter((m) => isAgentMatch(m.primary_agent, agentKey));
  const agentMetricIds = new Set(agentMetrics.map((m) => m.metric_id));
  const metricResults = (report?.metric_results ?? []).filter((m) => agentMetricIds.has(m.metric_id) || textMentionsAgent(m.tool_name, agentKey));
  const evidenceIds = new Set<string>([
    ...metricResults.flatMap((m) => m.evidence_ids),
    ...agentFindings.flatMap((f) => f.evidence_ids),
  ]);
  const evidence = (report?.evidence ?? []).filter((e) => evidenceIds.has(e.id) || evidenceMentionsAgent(e, agentKey));
  const usedCapabilityIds = new Set(
    [...evidence.map((e) => e.ai_system_capability_id), ...metricResults.map((m) => m.ai_system_capability_id)].filter(isNonEmptyString),
  );
  const capabilities = (report?.capabilities ?? []).filter((cap) => usedCapabilityIds.has(cap.id));
  const ledgerEntries = backend.ledgerEntries.filter((entry) => traceMentionsAgent(entry, agentKey));
  const stateEntries = backend.stateEntries.filter((entry) => stateMentionsAgent(entry, agentKey));
  const metadata = execution?.metadata_json ?? {};
  const actions = uniqueStrings(agentFindings.map((f) => f.recommended_action).filter(isNonEmptyString));
  const status = execution?.status ?? "pending";
  const duration =
    execution?.started_at && execution?.completed_at
      ? `${Math.round((new Date(execution.completed_at).getTime() - new Date(execution.started_at).getTime()) / 1000)}s`
      : execution?.started_at
        ? "Running..."
        : "-";
  const confidence = agentFindings.length
    ? `${Math.round((agentFindings.reduce((sum, f) => sum + f.confidence, 0) / agentFindings.length) * 100)}%`
    : metadataNumber(metadata, ["confidence", "confidence_score", "score"]);
  const hasRunData = Boolean(execution || agentFindings.length || metricResults.length || evidence.length || ledgerEntries.length || stateEntries.length);
  const tabs = ["Overview", "Inputs", "Actions", "Outputs", "Evidence", "Findings", "Trace"] as const;

  return (
    <DetailDrawer
      open
      onClose={onClose}
      eyebrow="Specialist Agent"
      title={agentLabel(agentKey)}
      badge={<Badge tone={statusTone(status)}>{titleCase(status)}</Badge>}
    >
      <div className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-3 dark:border-slate-700">
        {tabs.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            className={clsx(
              "rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition-colors",
              tab === name
                ? "bg-brand-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700",
            )}
          >
            {name}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="space-y-4 pt-4">
          {!hasRunData && <EmptyNote>Agent has not run yet.</EmptyNote>}
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-600/10 text-brand-600 dark:bg-brand-600/20 dark:text-brand-400">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[13px] font-semibold text-slate-900 dark:text-white">{report?.ai_system?.name ?? "No AI system selected"}</p>
              <p className="mt-1 text-[12px] leading-5 text-slate-600 dark:text-slate-300">
                {execution ? "Run-specific agent execution loaded from backend." : "Agent has not run yet."}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <StatBox label="Status" value={titleCase(status)} />
            <StatBox label="Findings" value={String(execution?.finding_count ?? agentFindings.length)} />
            <StatBox label="Confidence" value={confidence ?? "-"} />
            <StatBox label="Duration" value={duration} />
            <StatBox label="Evidence" value={String(evidence.length)} />
            <StatBox label="Trace Entries" value={String(ledgerEntries.length + stateEntries.length)} />
          </div>
          <SectionTitle>Selected AI system</SectionTitle>
          {report?.ai_system ? <KeyValueGrid rows={systemRows(report.ai_system)} /> : <EmptyNote>No selected AI system found for this run.</EmptyNote>}
        </div>
      )}

      {tab === "Inputs" && (
        <div className="space-y-5 pt-4">
          <div>
            <SectionTitle>Application context used</SectionTitle>
            {report?.context_profile ? <ContextProfileView profile={report.context_profile} /> : <EmptyNote>No application context found for this run.</EmptyNote>}
          </div>
          <div>
            <SectionTitle>Capabilities used</SectionTitle>
            {capabilities.length ? (
              <div className="space-y-2">{capabilities.map((cap) => <CapabilityCard key={cap.id} capability={cap} />)}</div>
            ) : (
              <EmptyNote>No capability usage recorded for this agent yet.</EmptyNote>
            )}
          </div>
          <div>
            <SectionTitle>Frameworks used</SectionTitle>
            {(report?.run.selected_frameworks.length ?? 0) > 0 ? <PillList values={report!.run.selected_frameworks} /> : <EmptyNote>No frameworks recorded for this run.</EmptyNote>}
          </div>
          <div>
            <SectionTitle>Metrics read</SectionTitle>
            {agentMetrics.length ? <MetricList metrics={agentMetrics} /> : <EmptyNote>Agent has not run yet.</EmptyNote>}
          </div>
          <div>
            <SectionTitle>Evidence read</SectionTitle>
            {evidence.length ? <EvidenceList evidence={evidence} /> : <EmptyNote>No evidence produced yet.</EmptyNote>}
          </div>
        </div>
      )}

      {tab === "Actions" && (
        <div className="space-y-5 pt-4">
          <div>
            <SectionTitle>What the agent checked for this application</SectionTitle>
            {agentMetrics.length ? (
              <MetricList metrics={agentMetrics} />
            ) : execution ? (
              <EmptyNote>No metric-level checks were recorded for this agent.</EmptyNote>
            ) : (
              <EmptyNote>Agent has not run yet.</EmptyNote>
            )}
          </div>
          <div>
            <SectionTitle>Recommended actions</SectionTitle>
            {actions.length ? <ActionList actions={actions} /> : <EmptyNote>No recommended actions recorded for this agent yet.</EmptyNote>}
          </div>
        </div>
      )}

      {tab === "Outputs" && (
        <div className="space-y-5 pt-4">
          <SectionTitle>Outputs produced</SectionTitle>
          {execution ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <StatBox label="Status" value={titleCase(execution.status)} />
                <StatBox label="Evidence Created" value={String(evidence.length)} />
                <StatBox label="Findings Created" value={String(agentFindings.length)} />
              </div>
              {Object.keys(metadata).length ? <JsonBlock value={metadata} /> : <EmptyNote>No structured output metadata recorded for this agent.</EmptyNote>}
            </>
          ) : (
            <EmptyNote>Agent has not run yet.</EmptyNote>
          )}
        </div>
      )}

      {tab === "Evidence" && (
        <div className="space-y-3 pt-4">
          <SectionTitle>Evidence created</SectionTitle>
          {evidence.length ? <EvidenceList evidence={evidence} /> : <EmptyNote>No evidence produced yet.</EmptyNote>}
        </div>
      )}

      {tab === "Findings" && (
        <div className="space-y-3 pt-4">
          <SectionTitle>Findings created</SectionTitle>
          {agentFindings.length ? agentFindings.map((f) => <FindingCard key={f.id} finding={f} />) : <EmptyNote>No findings created yet.</EmptyNote>}
        </div>
      )}

      {tab === "Trace" && (
        <div className="space-y-5 pt-4">
          <div>
            <SectionTitle>Trace entries</SectionTitle>
            {ledgerEntries.length ? <TraceList entries={ledgerEntries} /> : <EmptyNote>No trace entries recorded for this agent yet.</EmptyNote>}
          </div>
          <div>
            <SectionTitle>State entries</SectionTitle>
            {stateEntries.length ? <StateList entries={stateEntries} /> : <EmptyNote>No state entries recorded for this agent yet.</EmptyNote>}
          </div>
        </div>
      )}
    </DetailDrawer>
  );
}

/* Shared per-agent derivation — used by both the single-agent drawer and the
 * agents overview so run-specific inputs/work/outputs stay identical. */
type AgentDetail = ReturnType<typeof computeAgentDetail>;

function computeAgentDetail(agentKey: string, backend: BackendLike) {
  const report = backend.report;
  const execution = backend.agentExecutions.find((e) => e.agent_name === agentKey) ?? null;
  const agentFindings = backend.findings.filter((f) => f.agent_name === agentKey);
  const agentMetrics = (report?.metric_plan?.metrics ?? []).filter((m) => isAgentMatch(m.primary_agent, agentKey));
  const agentMetricIds = new Set(agentMetrics.map((m) => m.metric_id));
  const metricResults = (report?.metric_results ?? []).filter((m) => agentMetricIds.has(m.metric_id) || textMentionsAgent(m.tool_name, agentKey));
  const evidenceIds = new Set<string>([...metricResults.flatMap((m) => m.evidence_ids), ...agentFindings.flatMap((f) => f.evidence_ids)]);
  const evidence = (report?.evidence ?? []).filter((e) => evidenceIds.has(e.id) || evidenceMentionsAgent(e, agentKey));
  const usedCapabilityIds = new Set(
    [...evidence.map((e) => e.ai_system_capability_id), ...metricResults.map((m) => m.ai_system_capability_id)].filter(isNonEmptyString),
  );
  const capabilities = (report?.capabilities ?? []).filter((cap) => usedCapabilityIds.has(cap.id));
  const ledgerEntries = backend.ledgerEntries.filter((entry) => traceMentionsAgent(entry, agentKey));
  const stateEntries = backend.stateEntries.filter((entry) => stateMentionsAgent(entry, agentKey));
  const metadata = execution?.metadata_json ?? {};
  const actions = uniqueStrings(agentFindings.map((f) => f.recommended_action).filter(isNonEmptyString));
  const status = execution?.status ?? "pending";
  const duration =
    execution?.started_at && execution?.completed_at
      ? `${Math.round((new Date(execution.completed_at).getTime() - new Date(execution.started_at).getTime()) / 1000)}s`
      : execution?.started_at
        ? "Running…"
        : "—";
  const confidence = agentFindings.length
    ? `${Math.round((agentFindings.reduce((sum, f) => sum + f.confidence, 0) / agentFindings.length) * 100)}%`
    : metadataNumber(metadata, ["confidence", "confidence_score", "score"]);
  const hasRunData = Boolean(execution || agentFindings.length || metricResults.length || evidence.length || ledgerEntries.length || stateEntries.length);
  return { report, execution, agentFindings, agentMetrics, metricResults, evidence, capabilities, ledgerEntries, stateEntries, metadata, actions, status, duration, confidence, hasRunData };
}

/** Full stacked detail for one agent — the required fields, real data only,
 *  with explicit "not run yet" / "no evidence produced yet" empty states. */
function AgentDetailSections({ agentKey, detail }: { agentKey: string; detail: AgentDetail }) {
  const { execution, agentFindings, agentMetrics, metricResults, evidence, ledgerEntries, stateEntries, metadata, status, duration, confidence, hasRunData } = detail;
  return (
    <div className="space-y-5">
      {!hasRunData && <EmptyNote>Not run yet — no inputs, probes, evidence, or findings recorded for this agent in the current run.</EmptyNote>}

      <p className="text-[12px] leading-5 text-slate-600 dark:text-slate-300">{AGENT_PURPOSE[agentKey] ?? "Specialist governance agent operating on the shared run state."}</p>

      <div className="grid grid-cols-3 gap-3">
        <StatBox label="Status" value={titleCase(status)} />
        <StatBox label="Findings" value={String(execution?.finding_count ?? agentFindings.length)} />
        <StatBox label="Confidence" value={confidence ?? "—"} />
        <StatBox label="Probes" value={String(metricResults.length)} />
        <StatBox label="Evidence" value={String(evidence.length)} />
        <StatBox label="Duration" value={duration} />
      </div>

      <div>
        <SectionTitle>Inputs used</SectionTitle>
        {agentMetrics.length ? <MetricList metrics={agentMetrics} /> : <EmptyNote>Not run yet — no metric inputs recorded.</EmptyNote>}
      </div>

      <div>
        <SectionTitle>What the agent checked</SectionTitle>
        {agentMetrics.length ? (
          <PillList values={Array.from(new Set(agentMetrics.map((m) => titleCase(m.dimension))))} />
        ) : (
          <EmptyNote>Not run yet — nothing checked for this application.</EmptyNote>
        )}
      </div>

      <div>
        <SectionTitle>Probes / tests run</SectionTitle>
        {metricResults.length ? <MetricResultList results={metricResults} /> : <EmptyNote>No probes run yet.</EmptyNote>}
      </div>

      <div>
        <SectionTitle>Evidence created</SectionTitle>
        {evidence.length ? <EvidenceList evidence={evidence} /> : <EmptyNote>No evidence produced yet.</EmptyNote>}
      </div>

      <div>
        <SectionTitle>Findings created</SectionTitle>
        {agentFindings.length ? agentFindings.map((f) => <FindingCard key={f.id} finding={f} />) : <EmptyNote>No findings created yet.</EmptyNote>}
      </div>

      <div>
        <SectionTitle>Confidence / result</SectionTitle>
        {execution ? (
          <>
            <KeyValueGrid rows={[["Status", titleCase(status)], ["Confidence", confidence ?? "—"], ["Findings", String(agentFindings.length)], ["Evidence", String(evidence.length)]]} />
            {Object.keys(metadata).length > 0 && <JsonBlock value={metadata} />}
          </>
        ) : (
          <EmptyNote>Not run yet — no result recorded.</EmptyNote>
        )}
      </div>

      <div>
        <SectionTitle>Trace / state entries</SectionTitle>
        {ledgerEntries.length ? <TraceList entries={ledgerEntries} /> : <EmptyNote>No trace entries recorded for this agent yet.</EmptyNote>}
        {stateEntries.length > 0 && <div className="mt-2"><StateList entries={stateEntries} /></div>}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────── Agents overview ─────── */

function AgentsOverviewDrawer({ backend, onClose }: { backend: BackendLike; onClose: () => void }) {
  const executed = backend.agentExecutions.map((e) => e.agent_name);
  const order = [...AGENT_ORDER, ...executed.filter((k) => !AGENT_ORDER.includes(k))];
  const ranCount = new Set(executed).size;

  return (
    <DetailDrawer
      open
      onClose={onClose}
      eyebrow="Layer 3 · Specialist Agents"
      title="Specialist Agents"
      badge={<Badge tone={ranCount ? "green" : "slate"}>{ranCount}/{order.length} run</Badge>}
    >
      <p className="text-[13px] leading-6 text-slate-600 dark:text-slate-300">
        Each specialist agent runs independently on the shared run state. Expand any agent to see its run-specific inputs, checks, probes, evidence, findings, result, and trace.
      </p>
      <div className="mt-4 space-y-2">
        {order.map((agentKey) => {
          const detail = computeAgentDetail(agentKey, backend);
          const subtitle = detail.hasRunData
            ? `${detail.agentFindings.length} finding${detail.agentFindings.length === 1 ? "" : "s"} · ${detail.metricResults.length} probe${detail.metricResults.length === 1 ? "" : "s"} · ${detail.confidence ?? "—"} confidence`
            : "Not run yet";
          return (
            <Expandable
              key={agentKey}
              title={agentLabel(agentKey)}
              subtitle={subtitle}
              badge={<Badge tone={statusTone(detail.status)}>{titleCase(detail.status)}</Badge>}
            >
              <AgentDetailSections agentKey={agentKey} detail={detail} />
            </Expandable>
          );
        })}
      </div>
    </DetailDrawer>
  );
}

/* ──────────────────────────────────────────── Context assembly ────── */

function ContextDrawer({ backend, onClose }: { backend: BackendLike; onClose: () => void }) {
  const report = backend.report;
  const profile = report?.context_profile ?? null;
  const system = report?.ai_system ?? null;
  const frameworks = report?.run.selected_frameworks ?? [];
  const capabilities = report?.capabilities ?? [];
  const contextState = backend.stateEntries.filter((e) => normalize(e.phase) === normalize("context_assembly"));
  const contextLedger = backend.ledgerEntries.filter(
    (e) => e.event_type.toLowerCase().includes("context") || (typeof e.payload?.phase === "string" && e.payload.phase.toLowerCase().includes("context")),
  );

  return (
    <DetailDrawer
      open
      onClose={onClose}
      eyebrow="Layer 1 · Context Assembly"
      title="Context Assembly"
      badge={<Badge tone={profile ? "green" : "slate"}>{profile ? "Profile loaded" : "No profile"}</Badge>}
    >
      <p className="text-[13px] leading-6 text-slate-600 dark:text-slate-300">
        Before any probing, the backend assembles what it knows about the target so agents test the real production application, not a lab model. These are the inputs it checks — expand each to see the run-specific values.
      </p>

      <div className="mt-4 space-y-2">
        <Expandable title="AI system identity" subtitle="What the run is bound to" defaultOpen>
          {system ? <KeyValueGrid rows={systemRows(system)} /> : <EmptyNote>No AI system loaded for this run.</EmptyNote>}
        </Expandable>

        <Expandable title="Application context profile (A–E)" subtitle="Business rules, guardrails & integration that shape the model">
          {profile ? <ContextProfileView profile={profile} /> : <EmptyNote>No application context profile — sections A–E have not been filled in yet.</EmptyNote>}
        </Expandable>

        <Expandable title="Selected frameworks" subtitle="Drive which clauses, rubrics & metrics apply">
          {frameworks.length ? <PillList values={frameworks} /> : <EmptyNote>No frameworks selected for this run.</EmptyNote>}
        </Expandable>

        <Expandable title="Registered capabilities" subtitle="Callable endpoints agents may probe">
          {capabilities.length ? <div className="space-y-2">{capabilities.map((cap) => <CapabilityCard key={cap.id} capability={cap} />)}</div> : <EmptyNote>No capabilities registered for this system yet.</EmptyNote>}
        </Expandable>

        <Expandable title="Context assembly trace" subtitle="State & ledger entries from Layer 1">
          {contextState.length ? <StateList entries={contextState} /> : <EmptyNote>No context-assembly state entries recorded yet.</EmptyNote>}
          {contextLedger.length > 0 && <div className="mt-2"><TraceList entries={contextLedger} /></div>}
        </Expandable>
      </div>
    </DetailDrawer>
  );
}

/* ──────────────────────────────────────────── Action & Ledger ─────── */

function LedgerDrawer({ backend, onClose }: { backend: BackendLike; onClose: () => void }) {
  const chain = backend.report?.state_chain ?? null;
  const ledger = backend.ledgerEntries;
  const state = backend.stateEntries;

  return (
    <DetailDrawer
      open
      onClose={onClose}
      eyebrow="Layer 5 · Action & Ledger"
      title="Action & Ledger"
      badge={<Badge tone={chain ? (chain.valid ? "green" : "red") : "slate"}>{chain ? (chain.valid ? "Chain verified" : "Chain invalid") : "No chain"}</Badge>}
    >
      <div className="grid grid-cols-3 gap-3">
        <StatBox label="Ledger" value={String(ledger.length)} />
        <StatBox label="State" value={String(state.length)} />
        <StatBox label="Chain" value={chain ? (chain.valid ? "Valid" : "Invalid") : "—"} />
      </div>
      <div>
        <SectionTitle>Hash-chained ledger entries</SectionTitle>
        {ledger.length ? <TraceList entries={ledger} /> : <EmptyNote>No ledger entries yet — run a governance evaluation to populate the audit trail.</EmptyNote>}
      </div>
      <div>
        <SectionTitle>Governance state chain</SectionTitle>
        {state.length ? <StateList entries={state} /> : <EmptyNote>No governance state entries recorded yet.</EmptyNote>}
      </div>
    </DetailDrawer>
  );
}

/* ─────────────────────────────────────────────────── Expandable ────── */

function Expandable({
  title,
  subtitle,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
      >
        <div className="flex min-w-0 items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-slate-900 dark:text-white">{title}</p>
            {subtitle && <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{subtitle}</p>}
          </div>
        </div>
        {badge}
      </button>
      {open && <div className="border-t border-slate-200 px-3 py-3 dark:border-slate-700">{children}</div>}
    </div>
  );
}

function MetricResultList({ results }: { results: MetricResult[] }) {
  return (
    <div className="space-y-2">
      {results.map((r) => (
        <div key={r.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-mono text-[10px] text-slate-500 dark:text-slate-400">{r.metric_id}</p>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">{titleCase(r.dimension)}{r.tool_name ? ` · ${r.tool_name}` : ""}</p>
            </div>
            <Badge tone={r.passed === false ? "red" : r.passed === true ? "green" : "slate"}>{r.passed == null ? titleCase(r.status) : r.passed ? "Passed" : "Failed"}</Badge>
          </div>
          <KeyValueGrid rows={[["Score", r.normalized_score ?? r.raw_score ?? "—"], ["Threshold", r.threshold ?? "—"], ["Evidence", String(r.evidence_ids.length)]]} />
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────────────────────────────────── Metric plan ─────── */

function MetricPlanDrawer({ backend, onClose }: { backend: BackendLike; onClose: () => void }) {
  const plan = backend.report?.metric_plan;
  const metrics = plan?.metrics ?? [];
  const dimensions = Array.from(new Set(metrics.map((m) => m.dimension)));

  return (
    <DetailDrawer
      open
      onClose={onClose}
      eyebrow="Layer 2 · Orchestrator"
      title="Metric Plan"
      badge={<Badge tone="blue">{metrics.length} metrics</Badge>}
    >
      <p className="text-[13px] leading-6 text-slate-600 dark:text-slate-300">
        The orchestrator selected these metrics for the run based on system type, risk tier, and {plan?.selected_frameworks.length ?? 0} frameworks.
        Coverage spans <span className="font-semibold text-slate-900 dark:text-white">{dimensions.length}</span> risk dimensions.
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {dimensions.map((d) => (
          <span key={d} className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-300">
            {titleCase(d)}
          </span>
        ))}
      </div>

      <SectionTitle>Selected metrics</SectionTitle>
      {metrics.length > 0 ? (
        <div className="space-y-1.5">
          {metrics.map((m) => (
            <div key={m.metric_id} className="flex items-center justify-between gap-3 rounded border border-slate-200 dark:border-slate-700 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-[12px] font-semibold text-slate-900 dark:text-white">
                  <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{m.metric_id}</span> · {m.name}
                </p>
                <p className="text-[10px] text-slate-500 dark:text-slate-400">{titleCase(m.dimension)} · {m.primary_agent ? titleCase(m.primary_agent) : "—"}</p>
              </div>
              <Badge tone={m.enabled ? "green" : "slate"}>{m.enabled ? "Planned" : "Skipped"}</Badge>
            </div>
          ))}
        </div>
      ) : (
        <EmptyNote>No metric plan recorded for this run yet.</EmptyNote>
      )}
    </DetailDrawer>
  );
}

/* ───────────────────────────────────────────────────────── Council ─────── */

function CouncilDrawer({ backend, onClose }: { backend: BackendLike; onClose: () => void }) {
  const verdict = backend.report?.verdict ?? null;
  const [running, setRunning] = useState(false);

  const objections = verdict?.objections ?? [];

  async function runCouncil() {
    setRunning(true);
    try {
      await backend.deliberate();
    } finally {
      setRunning(false);
    }
  }

  return (
    <DetailDrawer
      open
      onClose={onClose}
      eyebrow="Layer 4 · Deliberation"
      title="Council Deliberation"
      badge={verdict ? <Badge tone="green">Verdict ready</Badge> : <Badge tone="slate">Pending</Badge>}
    >
      <p className="text-[13px] leading-6 text-slate-600 dark:text-slate-300">
        A three-step reasoning chain that turns specialist findings into a confidence-scored verdict: synthesis → forced dissent → adjudication.
      </p>

      <button
        onClick={runCouncil}
        disabled={running}
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2 text-[12px] font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Scale className="h-3.5 w-3.5" />}
        {running ? "Running council route…" : "Run council route"}
      </button>

      <CouncilStep n={1} title="Synthesis Memo" done={!!verdict?.synthesis}>
        {verdict?.synthesis ?? "Synthesises all specialist findings into a coherent narrative, identifying compounding cross-cutting risks."}
      </CouncilStep>

      <CouncilStep n={2} title="Devil's Advocate" done={objections.length > 0}>
        {objections.length > 0
          ? `${objections.length} evidence-based objection${objections.length === 1 ? "" : "s"} raised against the strongest claims to prevent over-confident verdicts.`
          : "Challenges the weakest point in the evidence — sample size, alternative explanations, or methodological limits."}
      </CouncilStep>

      <CouncilStep n={3} title="Verdict" done={!!verdict}>
        {verdict
          ? `Confidence ${Math.round(verdict.confidence_score * 100)}% → ${titleCase(verdict.action_tier)} (${titleCase(verdict.label)}).${verdict.reasoning ? ` ${verdict.reasoning}` : ""}`
          : "Computes a confidence score from evidence strength, cross-agent agreement, and citation specificity, then routes to an action tier."}
      </CouncilStep>
    </DetailDrawer>
  );
}

function CouncilStep({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-lg border border-slate-200 dark:border-slate-700 p-3.5">
      <div className="flex items-center gap-2">
        <span className={clsx("flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold", done ? "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300" : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400")}>
          {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : n}
        </span>
        <p className="text-[13px] font-semibold text-slate-900 dark:text-white">Step {n} · {title}</p>
      </div>
      <p className="mt-2 text-[12px] leading-5 text-slate-600 dark:text-slate-300">{children}</p>
    </div>
  );
}

/* ───────────────────────────────────────────────────────── Verdict ─────── */

function VerdictDrawer({ backend, onClose }: { backend: BackendLike; onClose: () => void }) {
  const verdict: Verdict | null = backend.report?.verdict ?? null;
  const navigateTo = useAppStore((s) => s.navigateTo);

  if (!verdict) {
    return (
      <DetailDrawer open onClose={onClose} eyebrow="Layer 5 · Action" title="Verdict">
        <EmptyNote>No verdict has been produced for this run yet. Run the council route to generate one.</EmptyNote>
      </DetailDrawer>
    );
  }

  const confidence = Math.round(verdict.confidence_score * 100);
  const label = titleCase(verdict.label);
  const tone: "red" | "amber" | "green" = /block|fail|reject|deny/i.test(verdict.label)
    ? "red"
    : /condition|partial|review|supervis/i.test(verdict.label)
      ? "amber"
      : "green";
  const actions = verdict.required_actions ?? [];

  return (
    <DetailDrawer open onClose={onClose} eyebrow="Layer 5 · Action" title={`${confidence}% Confidence`} badge={<Badge tone={tone}>{label}</Badge>}>
      <div className="grid grid-cols-2 gap-3">
        <StatBox label="Action Tier" value={titleCase(verdict.action_tier)} />
        <StatBox label="Objections" value={String(verdict.objections?.length ?? 0)} />
      </div>

      {verdict.reasoning && (
        <>
          <SectionTitle>Reasoning</SectionTitle>
          <p className="text-[12px] leading-6 text-slate-600 dark:text-slate-300">{verdict.reasoning}</p>
        </>
      )}

      <SectionTitle>Required actions</SectionTitle>
      {actions.length > 0 ? (
        <div className="space-y-2">
          {actions.map((a, i) => (
            <div key={i} className="flex items-start gap-2 rounded border border-slate-200 dark:border-slate-700 px-3 py-2">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600 dark:text-brand-400" />
              <p className="text-[12px] text-slate-700 dark:text-slate-300">
                {typeof a.title === "string" ? a.title : typeof a.action === "string" ? a.action : JSON.stringify(a)}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <EmptyNote>No remediation actions were prescribed.</EmptyNote>
      )}

      <button
        onClick={() => { onClose(); navigateTo("/reports"); }}
        className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-[12px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
      >
        <ExternalLink className="h-3.5 w-3.5" /> Open compliance report
      </button>
    </DetailDrawer>
  );
}

/* ──────────────────────────────────────────────────────── Evidence ─────── */

function EvidenceDrawer({ backend, findingId, onClose }: { backend: BackendLike; findingId?: string; onClose: () => void }) {
  const finding = findingId ? backend.findings.find((f) => f.id === findingId) ?? null : null;

  return (
    <DetailDrawer open onClose={onClose} eyebrow="Evidence" title={finding ? finding.title : "Evidence Records"}>
      {finding ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={severityTone(finding.severity)}>{titleCase(finding.severity)}</Badge>
            <Badge tone="slate">{Math.round(finding.confidence * 100)}% confidence</Badge>
            {finding.agent_name && <Badge tone="blue">{agentLabel(finding.agent_name)}</Badge>}
          </div>
          <SectionTitle>Summary</SectionTitle>
          <p className="text-[12px] leading-6 text-slate-600 dark:text-slate-300">{finding.summary}</p>
          {finding.framework_refs.length > 0 && (
            <>
              <SectionTitle>Framework references</SectionTitle>
              <div className="flex flex-wrap gap-1.5">
                {finding.framework_refs.map((ref) => (
                  <span key={ref} className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-300">{ref}</span>
                ))}
              </div>
            </>
          )}
          {finding.recommended_action && (
            <>
              <SectionTitle>Recommended action</SectionTitle>
              <p className="text-[12px] leading-6 text-slate-600 dark:text-slate-300">{finding.recommended_action}</p>
            </>
          )}
          <p className="mt-4 text-[11px] text-slate-400 dark:text-slate-500">{finding.evidence_ids.length} linked evidence record{finding.evidence_ids.length === 1 ? "" : "s"} in the run ledger.</p>
        </>
      ) : (
        <EmptyNote>Select a finding to inspect its evidence, framework citations, and recommended action.</EmptyNote>
      )}
    </DetailDrawer>
  );
}

/* ─────────────────────────────────────────────────────────── shared ────── */

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[_\s-]+/g, "");
}

function isAgentMatch(value: string | null | undefined, agentKey: string): boolean {
  if (!value) return false;
  return normalize(value) === normalize(agentKey) || normalize(value) === normalize(agentLabel(agentKey));
}

function textMentionsAgent(value: string | null | undefined, agentKey: string): boolean {
  if (!value) return false;
  const text = value.toLowerCase();
  return text.includes(agentKey.toLowerCase()) || text.includes(agentLabel(agentKey).toLowerCase());
}

function jsonMentionsAgent(value: unknown, agentKey: string): boolean {
  try {
    const text = JSON.stringify(value ?? {}).toLowerCase();
    return text.includes(agentKey.toLowerCase()) || text.includes(agentLabel(agentKey).toLowerCase());
  } catch {
    return false;
  }
}

function evidenceMentionsAgent(evidence: EvidenceRecord, agentKey: string): boolean {
  return textMentionsAgent(evidence.source_name, agentKey) || textMentionsAgent(evidence.tool_name, agentKey) || jsonMentionsAgent(evidence.payload, agentKey);
}

function traceMentionsAgent(entry: AuditLedgerEntry, agentKey: string): boolean {
  return textMentionsAgent(entry.actor_id, agentKey) || textMentionsAgent(entry.actor_type, agentKey) || textMentionsAgent(entry.event_type, agentKey) || jsonMentionsAgent(entry.payload, agentKey);
}

function stateMentionsAgent(entry: GovernanceStateEntry, agentKey: string): boolean {
  return textMentionsAgent(entry.source, agentKey) || textMentionsAgent(entry.entry_type, agentKey) || jsonMentionsAgent(entry.payload, agentKey);
}

function metadataNumber(metadata: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "number" && Number.isFinite(value)) return value <= 1 ? `${Math.round(value * 100)}%` : `${Math.round(value)}%`;
  }
  return null;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) return value.length ? value.map(displayValue).join(", ") : "-";
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function systemRows(system: GovernanceReport["ai_system"]): Array<[string, string]> {
  return [
    ["Name", system.name],
    ["Owner", system.owner],
    ["Type", titleCase(system.system_type)],
    ["Risk tier", titleCase(system.risk_tier)],
    ["Environment", titleCase(system.deployment_environment)],
    ["Model", [system.model_provider, system.model_name, system.model_version].filter(Boolean).join(" / ") || "-"],
  ];
}

function KeyValueGrid({ rows }: { rows: Array<[string, unknown]> }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="rounded border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</p>
          <p className="mt-1 break-words text-[12px] font-medium text-slate-800 dark:text-slate-200">{displayValue(value)}</p>
        </div>
      ))}
    </div>
  );
}

function ContextProfileView({ profile }: { profile: NonNullable<GovernanceReport["context_profile"]> }) {
  const sections: Array<[string, Record<string, unknown>]> = [
    ["Identity & purpose", profile.identity_purpose],
    ["Pre-model controls", profile.pre_model_controls],
    ["Model configuration", profile.model_configuration],
    ["Post-model controls", profile.post_model_controls],
    ["Integration context", profile.integration_context],
  ];
  return (
    <div className="space-y-2">
      {sections.map(([title, values]) => (
        <div key={title} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <p className="text-[12px] font-semibold text-slate-900 dark:text-white">{title}</p>
          {Object.keys(values ?? {}).length ? (
            <div className="mt-2">
              <KeyValueGrid rows={Object.entries(values)} />
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">No values recorded.</p>
          )}
        </div>
      ))}
    </div>
  );
}

function CapabilityCard({ capability }: { capability: GovernanceReport["capabilities"][number] }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold text-slate-900 dark:text-white">{capability.name}</p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{capability.endpoint_ref}</p>
        </div>
        <Badge tone={capability.enabled ? "green" : "slate"}>{capability.enabled ? "Enabled" : "Disabled"}</Badge>
      </div>
      <KeyValueGrid rows={[["Type", capability.capability_type], ["Method", capability.http_method], ["Side effect", capability.side_effect_level], ["Human review", capability.requires_human_review]]} />
    </div>
  );
}

function PillList({ values }: { values: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <span key={value} className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {titleCase(value)}
        </span>
      ))}
    </div>
  );
}

function MetricList({ metrics }: { metrics: RunMetricPlanEntry[] }) {
  return (
    <div className="space-y-2">
      {metrics.map((metric) => (
        <div key={metric.metric_id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] text-slate-500 dark:text-slate-400">{metric.metric_id}</p>
              <p className="text-[12px] font-semibold text-slate-900 dark:text-white">{metric.name}</p>
            </div>
            <Badge tone={metric.enabled ? "green" : "slate"}>{metric.enabled ? "Read" : "Skipped"}</Badge>
          </div>
          <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
            {titleCase(metric.dimension)}{metric.threshold != null ? ` / threshold ${metric.threshold}` : ""}{metric.probe_budget != null ? ` / budget ${metric.probe_budget}` : ""}
          </p>
          {metric.framework_ids.length > 0 && <div className="mt-2"><PillList values={metric.framework_ids} /></div>}
        </div>
      ))}
    </div>
  );
}

function EvidenceList({ evidence }: { evidence: EvidenceRecord[] }) {
  return (
    <div className="space-y-2">
      {evidence.map((item) => (
        <div key={item.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[12px] font-semibold text-slate-900 dark:text-white">{item.source_name}</p>
              <p className="mt-1 font-mono text-[10px] text-slate-500 dark:text-slate-400">{item.id}</p>
            </div>
            <Badge tone={item.passed === false ? "red" : item.passed === true ? "green" : "slate"}>{item.passed == null ? "Recorded" : item.passed ? "Passed" : "Failed"}</Badge>
          </div>
          <KeyValueGrid rows={[["Source type", item.source_type], ["Tool", item.tool_name ?? "-"], ["Score", item.normalized_score ?? item.raw_score ?? "-"], ["Trace", item.trace_id ?? "-"]]} />
          {item.payload && <JsonBlock value={item.payload} />}
        </div>
      ))}
    </div>
  );
}

function ActionList({ actions }: { actions: string[] }) {
  return (
    <div className="space-y-2">
      {actions.map((action) => (
        <div key={action} className="flex items-start gap-2 rounded border border-slate-200 px-3 py-2 dark:border-slate-700">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600 dark:text-brand-400" />
          <p className="text-[12px] leading-5 text-slate-700 dark:text-slate-300">{action}</p>
        </div>
      ))}
    </div>
  );
}

function TraceList({ entries }: { entries: AuditLedgerEntry[] }) {
  return (
    <div className="space-y-2">
      {entries.map((entry) => (
        <div key={entry.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <p className="text-[12px] font-semibold text-slate-900 dark:text-white">{titleCase(entry.event_type)}</p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{entry.created_at} / {entry.actor_id ?? entry.actor_type}</p>
          <JsonBlock value={entry.payload} />
        </div>
      ))}
    </div>
  );
}

function StateList({ entries }: { entries: GovernanceStateEntry[] }) {
  return (
    <div className="space-y-2">
      {entries.map((entry) => (
        <div key={entry.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[12px] font-semibold text-slate-900 dark:text-white">{titleCase(entry.entry_type)}</p>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{titleCase(entry.phase)} / {entry.source}</p>
            </div>
            <span className="font-mono text-[11px] text-slate-400">#{entry.sequence_number}</span>
          </div>
          {entry.payload && <JsonBlock value={entry.payload} />}
        </div>
      ))}
    </div>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="mt-2 max-h-56 overflow-auto rounded border border-slate-200 bg-slate-50 p-2 text-[10px] leading-4 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-[14px] font-semibold capitalize text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 mt-6 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{children}</p>;
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-700 px-4 py-6 text-center text-[12px] text-slate-500 dark:text-slate-400">
      {children}
    </div>
  );
}

function FindingCard({ finding }: { finding: BackendFinding }) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] font-semibold text-slate-900 dark:text-white">{finding.title}</p>
        <Badge tone={severityTone(finding.severity)}>{titleCase(finding.severity)}</Badge>
      </div>
      <p className="mt-1 text-[11px] leading-5 text-slate-600 dark:text-slate-400">{finding.summary}</p>
      <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-400 dark:text-slate-500">
        <AlertTriangle className="h-3 w-3" />
        {titleCase(finding.dimension)} · {Math.round(finding.confidence * 100)}% confidence
      </div>
    </div>
  );
}
