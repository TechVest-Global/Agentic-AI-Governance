import { useState } from "react";
import {
  ChevronRight,
  Download,
  FileCode,
  FileJson,
  FileText,
  Package,
  X,
} from "lucide-react";
import clsx from "clsx";
import { executionArtifacts, type ExecutionArtifact } from "@/data/executionLayerData";
import { Card, CardHeader } from "@/components/ui/Card";
import type {
  AgentExecution,
  BackendFinding,
  EvaluationRun,
  GovernanceReport,
} from "@/api/governanceApi";

// ── Live artifact generators ────────────────────────────────────────────────

type LiveData = {
  run: EvaluationRun;
  report: GovernanceReport | null;
  agentExecutions: AgentExecution[];
  findings: BackendFinding[];
};

function buildContextPackage(d: LiveData): string {
  const sys = d.report?.ai_system;
  const ctx = d.report?.context_profile;
  return JSON.stringify(
    {
      runId: d.run.id,
      generatedAt: d.run.started_at ?? d.run.created_at,
      aiSystem: {
        id: d.run.ai_system_id,
        name: sys?.name ?? d.run.ai_system_id,
        description: sys?.description ?? null,
        riskTier: sys?.risk_tier ?? null,
        deploymentEnvironment: sys?.deployment_environment ?? null,
        status: sys?.status ?? null,
      },
      frameworks: d.run.selected_frameworks,
      metrics: d.run.selected_metrics,
      contextProfile: ctx
        ? {
            identityPurpose: ctx.identity_purpose,
            preModelControls: ctx.pre_model_controls,
            modelConfiguration: ctx.model_configuration,
            postModelControls: ctx.post_model_controls,
            integrationContext: ctx.integration_context,
          }
        : null,
      capabilities: (d.report?.capabilities ?? []).map((c) => ({
        name: c.name,
        type: c.capability_type,
        enabled: c.enabled,
      })),
    },
    null,
    2,
  );
}

function buildOrchestratorPlan(d: LiveData): string {
  const plan = d.report?.metric_plan;
  const metrics = plan?.metrics ?? [];
  const enabled = metrics.filter((m) => m.enabled);
  const skipped = metrics.filter((m) => !m.enabled);

  const agentGroups: Record<string, string[]> = {};
  for (const m of enabled) {
    const dim = m.dimension ?? "general";
    if (!agentGroups[dim]) agentGroups[dim] = [];
    agentGroups[dim].push(m.metric_id);
  }

  const lines: string[] = [
    `run_id: ${d.run.id}`,
    `generated_at: ${d.run.started_at ?? d.run.created_at}`,
    `ai_system: ${d.run.ai_system_id}`,
    ``,
    `frameworks:`,
    ...d.run.selected_frameworks.map((f) => `  - ${f}`),
    ``,
    `metric_summary:`,
    `  total: ${metrics.length}`,
    `  enabled: ${enabled.length}`,
    `  skipped: ${skipped.length}`,
    ``,
    `agent_dispatch:`,
  ];
  for (const [dim, mids] of Object.entries(agentGroups)) {
    lines.push(`  ${dim}:`);
    for (const mid of mids) lines.push(`    - ${mid}`);
  }
  if (skipped.length > 0) {
    lines.push(``, `skipped_metrics:`);
    for (const m of skipped) lines.push(`  - ${m.metric_id}  # disabled`);
  }
  return lines.join("\n");
}

function buildAgentBundle(d: LiveData): string {
  return JSON.stringify(
    {
      bundleId: `bundle-${d.run.id.slice(0, 8)}`,
      runId: d.run.id,
      generatedAt: d.run.completed_at ?? d.run.updated_at ?? d.run.created_at,
      agentCount: d.agentExecutions.length,
      agents: d.agentExecutions.map((a) => ({
        name: a.agent_name,
        status: a.status,
        findingCount: a.finding_count,
        startedAt: a.started_at,
        completedAt: a.completed_at,
        errorSummary: a.error_summary ?? null,
      })),
    },
    null,
    2,
  );
}

function buildEvidenceBundle(d: LiveData): string {
  return JSON.stringify(
    {
      bundleId: `evidence-${d.run.id.slice(0, 8)}`,
      runId: d.run.id,
      generatedAt: d.run.completed_at ?? d.run.updated_at ?? d.run.created_at,
      findingCount: d.findings.length,
      findings: d.findings.map((f, i) => ({
        id: f.id.slice(0, 8),
        sequence: `F-${String(i + 1).padStart(3, "0")}`,
        agent: f.agent_name ?? "unknown",
        severity: f.severity,
        title: f.title,
        summary: f.summary,
        confidence: f.confidence,
        dimension: f.dimension,
        frameworkRefs: f.framework_refs,
        recommendedAction: f.recommended_action ?? null,
        status: f.status,
      })),
      agentsCovered: [...new Set(d.findings.map((f) => f.agent_name).filter(Boolean))].length,
    },
    null,
    2,
  );
}

function buildCouncilMemo(d: LiveData): string {
  const verdict = d.report?.verdict;
  const sys = d.report?.ai_system;
  const systemName = sys?.name ?? d.run.ai_system_id;
  const runDate = d.run.completed_at ?? d.run.updated_at ?? d.run.created_at;

  const sevOrder = ["critical", "high", "medium", "low", "info"];
  const sorted = [...d.findings].sort(
    (a, b) => sevOrder.indexOf(a.severity) - sevOrder.indexOf(b.severity),
  );

  const lines: string[] = [
    `# Synthesis Memo — Run ${d.run.id.slice(0, 8).toUpperCase()}`,
    `## System: ${systemName} | Run: ${d.run.id}`,
    `## Generated: ${runDate ? new Date(runDate).toUTCString() : "—"}`,
    ``,
    `### Executive Summary`,
  ];

  if (d.findings.length === 0) {
    lines.push(
      `The governance evaluation of **${systemName}** completed with **no material findings**.`,
    );
  } else {
    lines.push(
      `The governance evaluation of **${systemName}** identified **${d.findings.length} finding${d.findings.length !== 1 ? "s" : ""}** across ${[...new Set(d.findings.map((f) => f.dimension))].join(", ")} dimensions.`,
    );
    if (verdict) {
      lines.push(
        `Overall confidence: **${verdict.confidence_score}%** — Tier: **${verdict.action_tier}** (${verdict.label}).`,
      );
    }
  }

  if (sorted.length > 0) {
    lines.push(``, `### Findings`);
    sorted.forEach((f, i) => {
      lines.push(
        ``,
        `#### F-${String(i + 1).padStart(3, "0")} — ${f.title} (${f.severity.charAt(0).toUpperCase() + f.severity.slice(1)})`,
        `- **Agent**: ${f.agent_name ?? "unknown"}`,
        `- **Summary**: ${f.summary}`,
        `- **Confidence**: ${f.confidence}%`,
        ...(f.framework_refs.length > 0 ? [`- **Framework refs**: ${f.framework_refs.join(", ")}`] : []),
        ...(f.recommended_action ? [`- **Recommended action**: ${f.recommended_action}`] : []),
      );
    });
  }

  if (verdict) {
    lines.push(
      ``,
      `### Verdict`,
      `- **Tier**: ${verdict.action_tier}`,
      `- **Label**: ${verdict.label}`,
      `- **Confidence**: ${verdict.confidence_score}%`,
    );
    if (verdict.synthesis) lines.push(`- **Synthesis**: ${verdict.synthesis}`);
    if (verdict.required_actions?.length > 0) {
      lines.push(``, `### Required Actions`);
      for (const a of verdict.required_actions as Array<Record<string, unknown>>) {
        lines.push(`- ${a.description ?? JSON.stringify(a)}`);
      }
    }
  }

  return lines.join("\n");
}

function buildVerdict(d: LiveData): string {
  const verdict = d.report?.verdict;
  const sys = d.report?.ai_system;
  const counts = d.report?.counts ?? {};

  return JSON.stringify(
    {
      verdictId: verdict?.id ?? `pending-${d.run.id.slice(0, 8)}`,
      runId: d.run.id,
      system: sys?.name ?? d.run.ai_system_id,
      generatedAt: verdict?.created_at ?? d.run.completed_at ?? d.run.created_at,
      tier: verdict?.action_tier ?? "pending",
      label: verdict?.label ?? null,
      confidence: verdict?.confidence_score ?? null,
      findings: {
        critical: counts["critical"] ?? d.findings.filter((f) => f.severity === "critical").length,
        high: counts["high"] ?? d.findings.filter((f) => f.severity === "high").length,
        medium: counts["medium"] ?? d.findings.filter((f) => f.severity === "medium").length,
        low: counts["low"] ?? d.findings.filter((f) => f.severity === "low").length,
      },
      requiredActions: verdict?.required_actions ?? [],
      objections: verdict?.objections ?? [],
      synthesis: verdict?.synthesis ?? null,
      reasoning: verdict?.reasoning ?? null,
      approvalStatus: verdict ? "Generated" : "Pending Council Deliberation",
    },
    null,
    2,
  );
}

function buildLedgerEntry(d: LiveData): string {
  return JSON.stringify(
    {
      runId: d.run.id,
      system: d.report?.ai_system?.name ?? d.run.ai_system_id,
      status: d.run.status,
      startedAt: d.run.started_at,
      completedAt: d.run.completed_at,
      stateChain: d.report?.state_chain ?? null,
      findingCount: d.findings.length,
      agentCount: d.agentExecutions.length,
      verdict: d.report?.verdict
        ? {
            id: d.report.verdict.id,
            tier: d.report.verdict.action_tier,
            confidence: d.report.verdict.confidence_score,
          }
        : null,
    },
    null,
    2,
  );
}

function buildLiveArtifacts(d: LiveData): ExecutionArtifact[] {
  return [
    { id: "art-1", name: "context-package.json", type: "json", layer: "Context Assembly", content: buildContextPackage(d) },
    { id: "art-2", name: "orchestrator-plan.yaml", type: "yaml", layer: "Orchestrator Planning", content: buildOrchestratorPlan(d) },
    { id: "art-3", name: "agent-results.bundle", type: "bundle", layer: "Agent Execution", content: buildAgentBundle(d) },
    { id: "art-4", name: "evidence-bundle.json", type: "json", layer: "Evidence Aggregation", content: buildEvidenceBundle(d) },
    { id: "art-5", name: "council-memo.md", type: "markdown", layer: "Council Deliberation", content: buildCouncilMemo(d) },
    { id: "art-6", name: `verdict-${d.report?.verdict?.id ?? "PENDING"}.json`, type: "json", layer: "Council Deliberation", content: buildVerdict(d) },
    { id: "art-7", name: "ledger-entry.json", type: "json", layer: "Audit Ledger", content: buildLedgerEntry(d) },
  ];
}

// ── Component ──────────────────────────────────────────────────────────────

const typeIcons: Record<ExecutionArtifact["type"], typeof FileJson> = {
  json: FileJson,
  yaml: FileCode,
  markdown: FileText,
  bundle: Package,
};

const typeColors: Record<ExecutionArtifact["type"], string> = {
  json: "text-blue-600 bg-blue-50 border-blue-200",
  yaml: "text-purple-600 bg-purple-50 border-purple-200",
  markdown: "text-emerald-600 bg-emerald-50 border-emerald-200",
  bundle: "text-amber-600 bg-amber-50 border-amber-200",
};

type Props = {
  liveData?: LiveData | null;
};

export function ArtifactDrawer({ liveData }: Props) {
  const [openArtifact, setOpenArtifact] = useState<ExecutionArtifact | null>(null);

  const artifacts = liveData ? buildLiveArtifacts(liveData) : executionArtifacts;

  function handleDownload(artifact: ExecutionArtifact) {
    const blob = new Blob([artifact.content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = artifact.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Card>
        <CardHeader
          title="Execution Artifacts"
          eyebrow={liveData ? `Run ${liveData.run.id.slice(0, 8)} — click to inspect · download available` : "Click to inspect — download available"}
        />
        <div className="divide-y divide-slate-50">
          {artifacts.map((artifact) => {
            const Icon = typeIcons[artifact.type];
            return (
              <button
                key={artifact.id}
                onClick={() => setOpenArtifact(artifact)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 transition-colors"
              >
                <div className={clsx("flex h-7 w-7 items-center justify-center rounded border", typeColors[artifact.type])}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-mono font-medium text-slate-900 truncate">{artifact.name}</p>
                  <p className="text-[10px] text-slate-500">{artifact.layer}</p>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
              </button>
            );
          })}
        </div>
      </Card>

      {/* Modal */}
      {openArtifact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="relative flex h-[80vh] w-full max-w-3xl flex-col rounded-lg border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <div className="flex items-center gap-3">
                <div className={clsx("flex h-8 w-8 items-center justify-center rounded border", typeColors[openArtifact.type])}>
                  {(() => { const Icon = typeIcons[openArtifact.type]; return <Icon className="h-4 w-4" />; })()}
                </div>
                <div>
                  <p className="text-[14px] font-semibold text-slate-950 font-mono">{openArtifact.name}</p>
                  <p className="text-[11px] text-slate-500">{openArtifact.layer}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDownload(openArtifact)}
                  className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Download className="h-3 w-3" /> Download
                </button>
                <button
                  onClick={() => setOpenArtifact(null)}
                  className="flex h-7 w-7 items-center justify-center rounded hover:bg-slate-100"
                >
                  <X className="h-4 w-4 text-slate-500" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-5">
              <pre className="whitespace-pre-wrap font-mono text-[12px] leading-5 text-slate-800">
                {openArtifact.content}
              </pre>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
