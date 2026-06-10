import { useState } from "react";
import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import {
  Activity,
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Download,
  FileJson,
  FileText,
  Send,
  ShieldAlert,
  Zap,
} from "lucide-react";
import clsx from "clsx";
import { agents, auditEvents, findings, liveRuns } from "@/data/mockData";
import { Badge, toneForStatus } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { MetricCard } from "@/components/ui/MetricCard";
import { useAppStore } from "@/store/useAppStore";
import { ExecutionLayerTrace } from "@/components/execution/ExecutionLayerTrace";
import { RuntimeEventStream } from "@/components/execution/RuntimeEventStream";
import { ArtifactDrawer } from "@/components/execution/ArtifactDrawer";
import { RuntimeArchitecture } from "@/components/execution/RuntimeArchitecture";
import { exportJSON, exportCSV, exportPDF, exportLedger, exportEvidenceBundle } from "@/utils/exports";

const nodeDescriptions: Record<string, { title: string; description: string }> = {
  context: {
    title: "Context Assembly",
    description: "Ingests the system's model card, intended-use declaration, historical run data, and applicable framework clauses into a structured evaluation context.",
  },
  orchestrator: {
    title: "Adaptive Orchestrator",
    description: "Dynamically allocates probe budget and coordinates specialist agents. Reallocates resources based on early signals — e.g., more probes to Bias Auditor after a disparity signal.",
  },
  agents: {
    title: "Specialist Agents",
    description: "Six independent agents run in parallel: Bias Auditor, Drift Analyst, Misuse Detector, Compliance Mapper, Explainability Agent, and Risk Scorer. Each has a dedicated probe strategy.",
  },
  council: {
    title: "Council Deliberation",
    description: "Synthesises agent findings into a coherent memo. Devil's advocate challenges evidence strength. Verdict Agent scores confidence deductions and routes to tier assignment.",
  },
  verdict: {
    title: "Verdict & Actions",
    description: "Emits the final tier (Autonomous / Supervised / Blocked), prescribed remediation actions, confidence score, and a hash-anchored ledger entry.",
  },
};

const nodes: Node[] = [
  { id: "context", position: { x: 0, y: 50 }, data: { label: "Context Assembly" }, type: "input" },
  { id: "orchestrator", position: { x: 220, y: 50 }, data: { label: "Adaptive Orchestrator" } },
  { id: "agents", position: { x: 460, y: 50 }, data: { label: "Specialist Agents" } },
  { id: "council", position: { x: 700, y: 50 }, data: { label: "Council" } },
  { id: "verdict", position: { x: 920, y: 50 }, data: { label: "Verdict" }, type: "output" },
];

const edges: Edge[] = [
  { id: "e1", source: "context", target: "orchestrator", animated: false },
  { id: "e2", source: "orchestrator", target: "agents", animated: true },
  { id: "e3", source: "agents", target: "council", animated: true },
  { id: "e4", source: "council", target: "verdict", animated: false },
];

const severityColors: Record<string, string> = {
  Critical: "border-l-red-500",
  High: "border-l-orange-400",
  Medium: "border-l-amber-400",
  Low: "border-l-blue-400",
};

const severityBg: Record<string, string> = {
  Critical: "bg-red-50",
  High: "bg-orange-50",
  Medium: "bg-amber-50",
  Low: "bg-blue-50",
};

export function LiveRuns() {
  const navigateTo = useAppStore((state) => state.navigateTo);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);
  const [expandedFinding, setExpandedFinding] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<"pipeline" | "execution">("execution");

  const run = liveRuns[0];

  function copyHash(hash: string) {
    navigator.clipboard.writeText(hash).catch(() => {});
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 1500);
  }

  return (
    <div className="space-y-5">
      {/* Metrics */}
      <div className="grid gap-3 md:grid-cols-4">
        <div title="Total probes sent by all specialist agents in this run">
          <MetricCard label="Probes Sent" value={run.probes} icon={Send} tone="blue" />
        </div>
        <div title="Number of specialist agents currently executing (out of 6 total)">
          <MetricCard label="Agents Active" value="5 / 6" icon={Bot} tone="amber" />
        </div>
        <div title="Findings logged so far — click to expand each one below">
          <MetricCard label="Findings So Far" value={run.findings} icon={ShieldAlert} tone="red" />
        </div>
        <div title="Percentage of the full governance pipeline completed">
          <MetricCard label="Pipeline Progress" value={`${run.progress}%`} icon={Activity} tone="green" />
        </div>
      </div>

      {/* Section toggle */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-0">
        <button
          onClick={() => setActiveSection("execution")}
          className={clsx(
            "px-4 py-2.5 text-[12px] font-semibold border-b-2 transition-colors",
            activeSection === "execution"
              ? "border-blue-700 text-blue-700"
              : "border-transparent text-slate-500 hover:text-slate-700"
          )}
        >
          Execution Layer Trace
        </button>
        <button
          onClick={() => setActiveSection("pipeline")}
          className={clsx(
            "px-4 py-2.5 text-[12px] font-semibold border-b-2 transition-colors",
            activeSection === "pipeline"
              ? "border-blue-700 text-blue-700"
              : "border-transparent text-slate-500 hover:text-slate-700"
          )}
        >
          Pipeline Graph
        </button>

        {/* Export buttons */}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={exportPDF}
            className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
            title="Generate PDF report"
          >
            <FileText className="h-3 w-3" /> PDF
          </button>
          <button
            onClick={exportJSON}
            className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
            title="Download run data as JSON"
          >
            <FileJson className="h-3 w-3" /> JSON
          </button>
          <button
            onClick={exportCSV}
            className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
            title="Download findings as CSV"
          >
            <Download className="h-3 w-3" /> CSV
          </button>
          <button
            onClick={exportLedger}
            className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
            title="Download ledger entries"
          >
            <Download className="h-3 w-3" /> Ledger
          </button>
          <button
            onClick={exportEvidenceBundle}
            className="flex items-center gap-1.5 rounded border border-blue-300 bg-blue-50 px-2.5 py-1.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
            title="Download full evidence bundle"
          >
            <Download className="h-3 w-3" /> Evidence Bundle
          </button>
        </div>
      </div>

      {/* Execution Layer Trace (new) */}
      {activeSection === "execution" && (
        <div className="space-y-5">
          <ExecutionLayerTrace />

          {/* Event Stream + Architecture + Artifacts */}
          <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
            <RuntimeEventStream />
            <div className="space-y-5">
              <RuntimeArchitecture />
              <ArtifactDrawer />
            </div>
          </div>
        </div>
      )}

      {/* Pipeline graph (original) */}
      {activeSection === "pipeline" && (
        <Card>
          <CardHeader
            title={`${run.system} — Full Governance Audit`}
            eyebrow={run.id}
            action={<Badge tone="amber">{run.status}</Badge>}
          />
          <div className="relative">
            <p className="px-4 pb-2 text-[11px] text-slate-500">
              Hover pipeline stages to understand what each step does. The active stages (Specialist Agents → Council) are currently executing.
            </p>
            <div className="h-[220px] p-3">
              <ReactFlow nodes={nodes} edges={edges} fitView nodesDraggable={false} nodesConnectable={false}>
                <Background />
                <Controls showInteractive={false} />
              </ReactFlow>
            </div>
            {/* Node description overlay */}
            <div className="flex gap-2 overflow-x-auto px-4 pb-4">
              {Object.entries(nodeDescriptions).map(([id, info]) => (
                <button
                  key={id}
                  onMouseEnter={() => setHoveredNode(id)}
                  onMouseLeave={() => setHoveredNode(null)}
                  className={clsx(
                    "min-w-[140px] flex-1 rounded border p-2.5 text-left transition-all",
                    hoveredNode === id
                      ? "border-blue-300 bg-blue-50"
                      : "border-slate-200 bg-slate-50 hover:border-slate-300"
                  )}
                >
                  <p className="text-[11px] font-semibold text-slate-950">{info.title}</p>
                  {hoveredNode === id && (
                    <p className="mt-1 text-[10px] leading-3.5 text-slate-600">{info.description}</p>
                  )}
                </button>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Agents + Events */}
      <div className="grid gap-5 xl:grid-cols-[1fr_1.1fr]">
        {/* Agent status */}
        <Card>
          <CardHeader
            title="Specialist Agent Status"
            eyebrow="Execution — click agent to expand"
            action={
              <button
                onClick={() => navigateTo("/agents")}
                className="text-[11px] font-medium text-blue-700 underline-offset-2 hover:underline"
              >
                Full intelligence view →
              </button>
            }
          />
          <div className="divide-y divide-slate-100">
            {agents.map((agent) => {
              const isExpanded = expandedAgent === agent.name;
              return (
                <div key={agent.name}>
                  <button
                    onClick={() => setExpandedAgent(isExpanded ? null : agent.name)}
                    className="grid w-full grid-cols-[1fr_80px_90px_20px] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
                  >
                    <div>
                      <p className="text-[13px] font-semibold text-slate-950">{agent.name}</p>
                      <p className="text-[11px] text-slate-500">{agent.role}</p>
                    </div>
                    <Badge tone={toneForStatus(agent.status)}>{agent.status}</Badge>
                    <div>
                      <p className="text-right text-[11px] text-slate-500">{agent.probes} probes</p>
                      <div className="mt-1 h-1.5 rounded bg-slate-200">
                        <div className="h-full rounded bg-blue-700" style={{ width: `${agent.progress}%` }} />
                      </div>
                    </div>
                    {isExpanded
                      ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                      : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
                  </button>
                  {isExpanded && (
                    <div className="grid grid-cols-3 gap-3 border-t border-slate-100 bg-slate-50 px-4 py-3">
                      <Stat label="Progress" value={`${agent.progress}%`} />
                      <Stat label="Findings" value={String(agent.findings)} />
                      <Stat label="Confidence" value={agent.confidence ? `${agent.confidence}%` : "Pending"} />
                      <div className="col-span-3 flex gap-2">
                        <button
                          onClick={() => navigateTo("/agents")}
                          className="flex items-center gap-1.5 rounded border border-blue-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-blue-800 transition-colors hover:bg-blue-50"
                        >
                          <Zap className="h-3 w-3" /> View full agent detail
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        {/* Activity log */}
        <Card>
          <CardHeader
            title="Activity Log"
            eyebrow="Live ledger feed — click event to expand"
            action={
              <button
                onClick={() => navigateTo("/ledger")}
                className="text-[11px] font-medium text-blue-700 underline-offset-2 hover:underline"
              >
                Full ledger →
              </button>
            }
          />
          <div className="divide-y divide-slate-100">
            {auditEvents.map((event) => {
              const isExpanded = expandedEvent === event.id;
              return (
                <div key={event.id}>
                  <button
                    onClick={() => setExpandedEvent(isExpanded ? null : event.id)}
                    className="flex w-full items-start gap-2 px-4 py-3 text-left transition-colors hover:bg-slate-50"
                  >
                    <div className="mt-0.5 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] text-slate-500">{event.timestamp}</span>
                        <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">{event.type}</span>
                        <span className="text-[11px] font-semibold text-slate-950">{event.actor}</span>
                      </div>
                      <p className="mt-1 text-[12px] leading-5 text-slate-700">{event.description}</p>
                    </div>
                    {isExpanded
                      ? <ChevronDown className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-400" />
                      : <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-400" />}
                  </button>
                  {isExpanded && (
                    <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Hash</p>
                          <p className="font-mono text-[11px] text-slate-950">{event.hash}</p>
                        </div>
                        <button
                          onClick={() => copyHash(event.hash)}
                          className="flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-600 hover:bg-slate-100"
                        >
                          <Copy className="h-3 w-3" />
                          {copiedHash === event.hash ? "Copied!" : "Copy"}
                        </button>
                      </div>
                      <p className="mt-2 text-[10px] text-slate-500">Parent: <span className="font-mono text-slate-700">{event.parentHash}</span></p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Findings list */}
      <Card>
        <CardHeader
          title="Findings Logged This Run"
          eyebrow="Click to expand evidence — navigate to Council to see full deliberation"
          action={
            <button
              onClick={() => navigateTo("/council")}
              className="text-[11px] font-medium text-blue-700 underline-offset-2 hover:underline"
            >
              Council deliberation →
            </button>
          }
        />
        <div className="divide-y divide-slate-100">
          {findings.map((finding) => {
            const isExpanded = expandedFinding === finding.id;
            return (
              <div key={finding.id}>
                <button
                  onClick={() => setExpandedFinding(isExpanded ? null : finding.id)}
                  className={clsx(
                    "flex w-full items-start gap-3 border-l-4 px-4 py-3 text-left transition-colors hover:bg-slate-50",
                    severityColors[finding.severity]
                  )}
                >
                  <AlertTriangle className={clsx("mt-0.5 h-4 w-4 shrink-0",
                    finding.severity === "Critical" ? "text-red-600" :
                    finding.severity === "High" ? "text-orange-500" :
                    "text-amber-500"
                  )} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-semibold text-slate-950">{finding.title}</p>
                      <span className={clsx("rounded px-1.5 py-0.5 text-[10px] font-semibold",
                        finding.severity === "Critical" ? "bg-red-100 text-red-700" :
                        finding.severity === "High" ? "bg-orange-100 text-orange-700" :
                        "bg-amber-100 text-amber-700"
                      )}>{finding.severity}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500">{finding.agent} · {finding.framework}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-slate-700">{finding.confidence}% conf.</span>
                    {isExpanded
                      ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                      : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
                  </div>
                </button>
                {isExpanded && (
                  <div className={clsx("border-l-4 px-4 py-3", severityColors[finding.severity], severityBg[finding.severity])}>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Evidence</p>
                    <p className="text-[12px] leading-5 text-slate-700">{finding.evidence}</p>
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => navigateTo("/agents")}
                        className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-800 transition-colors hover:bg-slate-50"
                      >
                        <Clock className="h-3 w-3" /> Agent timeline
                      </button>
                      <button
                        onClick={() => navigateTo("/council")}
                        className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-800 transition-colors hover:bg-slate-50"
                      >
                        Council deliberation →
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 text-[13px] font-semibold text-slate-950">{value}</p>
    </div>
  );
}
