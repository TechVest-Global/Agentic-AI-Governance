import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Database,
  Gauge,
  Layers3,
  RefreshCw,
  ServerCrash,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import clsx from "clsx";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardHeader } from "@/components/ui/Card";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { useAppStore } from "@/store/useAppStore";
import { useAuthStore } from "@/store/useAuthStore";
import { personaForRole } from "@/lib/persona";
import { useDashboardData, type DashboardData } from "@/hooks/useDashboardData";

type DashboardTab = "Overview" | "Compliance" | "Risk Analysis" | "Agent Performance" | "Metrics & Sources";

// Auditors get assurance-focused tabs plus agent activity visibility. The
// deeper metric/source plumbing remains developer-only.
const AUDITOR_TABS: DashboardTab[] = ["Overview", "Compliance", "Risk Analysis", "Agent Performance"];
const DEVELOPER_TABS: DashboardTab[] = ["Overview", "Compliance", "Risk Analysis", "Agent Performance", "Metrics & Sources"];
const DASHBOARD_TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

const tooltipProps = {
  contentStyle: {
    borderRadius: 10,
    border: "1px solid #e7e9f0",
    boxShadow: "0 8px 24px -8px rgba(16,24,40,0.18)",
    fontSize: 12,
  },
  labelStyle: { color: "#0d1224", fontWeight: 600 },
} as const;

export function Dashboard() {
  const [activeTab, setActiveTab] = useState<DashboardTab>("Overview");
  const navigateTo = useAppStore((state) => state.navigateTo);
  const role = useAuthStore((state) => state.user?.role);
  const persona = personaForRole(role);
  const tabs = persona === "auditor" ? AUDITOR_TABS : DEVELOPER_TABS;
  const data = useDashboardData();

  if (data.loading && !data.connected) {
    return <DashboardSkeleton />;
  }

  if (data.error) {
    return <BackendUnavailable message={data.error} onRetry={data.refresh} />;
  }

  if (data.connected && data.empty) {
    return <NoDataYet onRefresh={data.refresh} navigateTo={navigateTo} />;
  }

  const { kpis } = data;

  return (
    <div className="space-y-5">
      <DashboardHeader data={data} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={Layers3}
          value={kpis.totalSystems}
          label="AI Systems Registered"
          detail={`${data.runs.length} evaluation run${data.runs.length === 1 ? "" : "s"} recorded`}
          onClick={() => navigateTo("/systems")}
        />
        <KpiCard
          icon={Activity}
          value={kpis.activeRuns}
          label="Active Governance Runs"
          detail={kpis.activeRuns > 0 ? "In progress now" : "All runs complete"}
          tone={kpis.activeRuns > 0 ? "amber" : "green"}
          onClick={() => navigateTo("/runs")}
        />
        <KpiCard
          icon={ShieldAlert}
          value={kpis.openFindings}
          label="Open Findings"
          detail="From the latest evaluation"
          tone={kpis.openFindings > 0 ? "red" : "green"}
          onClick={() => navigateTo("/findings")}
        />
        <KpiCard
          icon={Gauge}
          value={kpis.avgConfidence === null ? null : Math.round(kpis.avgConfidence * 100)}
          suffix="%"
          label="Avg Council Confidence"
          detail={`Across ${data.confidenceTrend.length} adjudicated run${data.confidenceTrend.length === 1 ? "" : "s"}`}
          tone={kpis.avgConfidence !== null && kpis.avgConfidence < 0.7 ? "amber" : "green"}
          onClick={() => navigateTo(persona === "auditor" ? "/verdicts" : "/council")}
        />
      </div>

      <div className="border-b border-slate-200 dark:border-slate-700">
        <div className="flex flex-wrap gap-1">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={clsx(
                "border-b-2 px-4 py-3 text-[14px] font-medium transition-colors",
                activeTab === tab
                  ? "border-brand-500 text-brand-700 dark:text-brand-400"
                  : "border-transparent text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600 hover:text-slate-950 dark:hover:text-white"
              )}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "Overview" && <OverviewTab data={data} />}
      {activeTab === "Compliance" && <ComplianceTab data={data} />}
      {activeTab === "Risk Analysis" && <RiskAnalysisTab data={data} />}
      {activeTab === "Agent Performance" && <AgentPerformanceTab data={data} />}
      {activeTab === "Metrics & Sources" && <MetricsSourcesTab data={data} />}
    </div>
  );
}

function DashboardHeader({ data }: { data: DashboardData }) {
  const latest = data.latestRun;
  const system = data.latestReport?.ai_system;
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-[22px] text-ink dark:text-white">Governance Overview</h1>
        <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">
          {latest && system ? (
            <>
              Latest run: <span className="font-medium text-slate-700 dark:text-slate-300">{system.name}</span>
              {" · "}
              <span className="capitalize">{latest.status.replace(/_/g, " ")}</span>
            </>
          ) : (
            "Live data from the governance engine"
          )}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Backend connected
        </span>
        <button
          onClick={data.refresh}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-[12px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
        >
          <RefreshCw className={clsx("h-3.5 w-3.5", data.loading && "animate-spin")} />
          Refresh
        </button>
      </div>
    </div>
  );
}

function OverviewTab({ data }: { data: DashboardData }) {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <ChartCard eyebrow="Council Confidence per Run vs. Target (85%)" title="Governance Confidence Trend">
        {data.confidenceTrend.length > 0 ? (
          <ResponsiveContainer width="100%" height={230}>
            <AreaChart data={data.confidenceTrend} margin={{ left: -18, right: 10, top: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="confidenceFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="5%" stopColor="#0d9488" stopOpacity={0.22} />
                  <stop offset="95%" stopColor="#0d9488" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#eef0f6" strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#cbd2e0" }} tick={{ fontSize: 11, fill: "#64748b" }} />
              <YAxis domain={[0, 100]} tickLine={false} axisLine={{ stroke: "#cbd2e0" }} tick={{ fontSize: 11, fill: "#64748b" }} />
              <Tooltip {...tooltipProps} />
              <Area type="monotone" dataKey="score" name="Confidence" stroke="#0d9488" strokeWidth={2} fill="url(#confidenceFill)" />
              <Line type="monotone" dataKey={() => 85} stroke="#ef4444" strokeDasharray="4 4" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <ChartEmpty label="No adjudicated runs yet" />
        )}
      </ChartCard>

      <ChartCard eyebrow="Verdict Labels Across Recent Runs" title="Governance Outcomes">
        {data.outcomeMix.some((o) => o.value > 0) ? (
          <>
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={data.outcomeMix} margin={{ left: -18, right: 10, top: 8, bottom: 0 }}>
                <CartesianGrid stroke="#eef0f6" strokeDasharray="3 3" />
                <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#cbd2e0" }} tick={{ fontSize: 11, fill: "#64748b" }} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={{ stroke: "#cbd2e0" }} tick={{ fontSize: 11, fill: "#64748b" }} />
                <Tooltip {...tooltipProps} />
                <Bar dataKey="value" name="Runs" radius={[4, 4, 0, 0]}>
                  {data.outcomeMix.map((entry) => (
                    <Cell key={entry.label} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <Legend items={data.outcomeMix.map((o) => [o.label, o.color])} />
          </>
        ) : (
          <ChartEmpty label="No verdicts recorded yet" />
        )}
      </ChartCard>

      <ChartCard eyebrow="Current Tier Classification" title="System Risk Distribution">
        {data.riskDistribution.some((r) => r.value > 0) ? (
          <div className="grid min-h-[250px] items-center gap-4 md:grid-cols-[0.9fr_1.1fr]">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={data.riskDistribution.filter((r) => r.value > 0)} dataKey="value" innerRadius={62} outerRadius={92} paddingAngle={2}>
                  {data.riskDistribution
                    .filter((entry) => entry.value > 0)
                    .map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                </Pie>
                <Tooltip {...tooltipProps} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-3">
              {data.riskDistribution.map((entry) => (
                <div key={entry.name} className="flex items-center justify-between rounded border border-slate-200 dark:border-slate-700 px-3 py-2 text-[12px]">
                  <span className="flex items-center gap-2 font-medium text-slate-700 dark:text-slate-300">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                    {entry.name}
                  </span>
                  <span className="font-semibold text-slate-950 dark:text-white">{entry.value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <ChartEmpty label="No systems registered yet" />
        )}
      </ChartCard>

      <ChartCard eyebrow="Latest Run · Findings by Severity" title="Finding Severity Breakdown">
        {data.severityBreakdown.length > 0 ? (
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data.severityBreakdown} margin={{ left: -18, right: 10, top: 8, bottom: 0 }}>
              <CartesianGrid stroke="#eef0f6" strokeDasharray="3 3" />
              <XAxis dataKey="severity" tickLine={false} axisLine={{ stroke: "#cbd2e0" }} tick={{ fontSize: 11, fill: "#64748b" }} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={{ stroke: "#cbd2e0" }} tick={{ fontSize: 11, fill: "#64748b" }} />
              <Tooltip {...tooltipProps} />
              <Bar dataKey="count" name="Findings" radius={[4, 4, 0, 0]}>
                {data.severityBreakdown.map((entry) => (
                  <Cell key={entry.severity} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <ChartEmpty label="No findings in the latest run — clean result" icon={CheckCircle2} />
        )}
      </ChartCard>
    </div>
  );
}

function ComplianceTab({ data }: { data: DashboardData }) {
  if (data.frameworkCoverage.length === 0) {
    return <PanelEmpty label="No framework assessments yet" hint="Run an evaluation to map controls to frameworks." />;
  }
  return (
    <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
      <Card>
        <CardHeader title="Framework Compliance Coverage" eyebrow="Controls · Latest Run" />
        <div className="divide-y divide-slate-100 dark:divide-slate-700">
          {data.frameworkCoverage.map((row) => (
            <div key={row.frameworkId} className="px-4 py-4">
              <div className="flex items-center justify-between gap-3 text-[12px]">
                <span className="font-semibold text-slate-950 dark:text-white">{row.framework}</span>
                <span className="text-slate-500 dark:text-slate-400">
                  {row.coverage}% · {row.passed}/{row.controls} controls · {row.failed} failed
                </span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-[#eef0f6] dark:bg-slate-700">
                <div
                  className={clsx(
                    "h-2 rounded-full",
                    row.status === "At Risk" ? "bg-gradient-to-r from-red-500 to-red-400" : "bg-gradient-to-r from-brand-500 to-brand-400"
                  )}
                  style={{ width: `${row.coverage}%` }}
                />
              </div>
              <span className="mt-1.5 inline-block text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                {row.status}
              </span>
            </div>
          ))}
        </div>
      </Card>
      <ChartCard eyebrow="Pass Rate by Framework" title="Coverage Comparison">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data.frameworkCoverage} layout="vertical" margin={{ left: 18, right: 10, top: 8, bottom: 0 }}>
            <CartesianGrid stroke="#eef0f6" strokeDasharray="3 3" />
            <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: "#64748b" }} />
            <YAxis type="category" dataKey="framework" width={120} tick={{ fontSize: 11, fill: "#64748b" }} />
            <Tooltip {...tooltipProps} />
            <Bar dataKey="coverage" name="Coverage %" fill="#0d9488" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function RiskAnalysisTab({ data }: { data: DashboardData }) {
  const openFindings = data.findings.filter((f) => f.status === "open");
  const atRiskFrameworks = data.frameworkCoverage.filter((row) => row.status === "At Risk" || row.status === "Partial");
  const activeRuns = data.runs.filter((run) => !DASHBOARD_TERMINAL_STATUSES.has(run.status));
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MiniRiskCard label="High Risk Systems" value={data.riskDistribution.find((r) => r.name === "High Risk")?.value ?? 0} tone="red" />
        <MiniRiskCard label="Open Findings" value={openFindings.length} tone={openFindings.length ? "red" : "green"} />
        <MiniRiskCard label="Frameworks Needing Review" value={atRiskFrameworks.length} tone={atRiskFrameworks.length ? "amber" : "green"} />
        <MiniRiskCard label="Runs In Progress" value={activeRuns.length} tone={activeRuns.length ? "amber" : "green"} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <ChartCard eyebrow="Latest Run · Severity Mix" title="Risk Concentration">
          {data.severityBreakdown.length > 0 ? (
            <div className="space-y-4 p-1">
              {data.severityBreakdown.map((s) => {
                const max = Math.max(...data.severityBreakdown.map((x) => x.count), 1);
                return (
                  <div key={s.severity}>
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="font-medium text-slate-700 dark:text-slate-300">{s.severity}</span>
                      <span className="font-semibold text-slate-950 dark:text-white">{s.count}</span>
                    </div>
                    <div className="mt-1.5 h-2 rounded-full bg-slate-100 dark:bg-slate-700">
                      <div className="h-2 rounded-full" style={{ width: `${(s.count / max) * 100}%`, backgroundColor: s.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-3 p-1">
              {data.riskDistribution.map((risk) => {
                const max = Math.max(...data.riskDistribution.map((x) => x.value), 1);
                return (
                  <div key={risk.name}>
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="font-medium text-slate-700 dark:text-slate-300">{risk.name}</span>
                      <span className="font-semibold text-slate-950 dark:text-white">{risk.value}</span>
                    </div>
                    <div className="mt-1.5 h-2 rounded-full bg-slate-100 dark:bg-slate-700">
                      <div className="h-2 rounded-full" style={{ width: `${(risk.value / max) * 100}%`, backgroundColor: risk.color }} />
                    </div>
                  </div>
                );
              })}
              {data.riskDistribution.every((risk) => risk.value === 0) && (
                <PanelEmpty label="No systems registered yet" hint="Register a system to populate risk posture." inset />
              )}
            </div>
          )}
        </ChartCard>
        <Card>
          <CardHeader title="Open Findings" eyebrow={`${openFindings.length} issue${openFindings.length === 1 ? "" : "s"}`} />
          {openFindings.length > 0 ? (
            <div className="max-h-[420px] divide-y divide-slate-100 dark:divide-slate-700 overflow-y-auto">
              {openFindings.map((finding) => (
                <div key={finding.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[12px] font-semibold text-slate-950 dark:text-white">{finding.title}</p>
                    <SeverityTag severity={finding.severity} />
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] text-slate-500 dark:text-slate-400">{finding.summary}</p>
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    {finding.dimension}
                    {finding.agent_name ? ` · ${finding.agent_name.replace(/_/g, " ")}` : ""}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <PanelEmpty label="No open findings" hint="The latest run produced no unresolved issues." inset />
          )}
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <FrameworkRiskSignals rows={data.frameworkCoverage} />
        <AgentRiskSignals agents={data.agentExecutions} />
      </div>
    </div>
  );
}

function AgentPerformanceTab({ data }: { data: DashboardData }) {
  if (data.agentExecutions.length === 0) {
    return <PanelEmpty label="No agent activity yet" hint="Specialist agents report here once a run executes." />;
  }
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      {data.agentExecutions.map((agent) => (
        <Card key={agent.id} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                <Bot className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-[13px] font-semibold capitalize text-slate-950 dark:text-white">
                  {agent.agent_name.replace(/_/g, " ")}
                </h3>
                <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">Specialist governance agent</p>
              </div>
            </div>
            <AgentStatusTag status={agent.status} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-[12px]">
            <MiniStat label="Findings" value={agent.finding_count} />
            <MiniStat label="Status" value={titleCase(agent.status)} />
          </div>
        </Card>
      ))}
    </div>
  );
}

function MiniRiskCard({ label, value, tone }: { label: string; value: number; tone: "green" | "red" | "amber" }) {
  const toneClass =
    tone === "red"
      ? "text-red-700 bg-red-50 dark:text-red-300 dark:bg-red-950/40"
      : tone === "amber"
        ? "text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/40"
        : "text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40";
  return (
    <Card className="p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{label}</p>
      <div className="mt-3 flex items-center justify-between">
        <p className="text-2xl font-semibold text-slate-950 dark:text-white">{value}</p>
        <span className={clsx("rounded px-2 py-1 text-[10px] font-semibold", toneClass)}>
          {tone === "red" ? "Watch" : tone === "amber" ? "Review" : "Stable"}
        </span>
      </div>
    </Card>
  );
}

function FrameworkRiskSignals({ rows }: { rows: DashboardData["frameworkCoverage"] }) {
  return (
    <Card>
      <CardHeader title="Framework Risk Signals" eyebrow="Latest run controls" />
      {rows.length > 0 ? (
        <div className="divide-y divide-slate-100 dark:divide-slate-700">
          {rows.map((row) => (
            <div key={row.frameworkId} className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="text-[12px] font-semibold text-slate-950 dark:text-white">{row.framework}</p>
                <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  {row.passed}/{row.controls} controls passed · {row.pending} pending · {row.failed} failed
                </p>
              </div>
              <span className={clsx(
                "rounded px-2 py-0.5 text-[10px] font-semibold",
                row.status === "At Risk"
                  ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400"
                  : row.status === "Partial"
                    ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                    : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
              )}>
                {row.status}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <PanelEmpty label="No framework map yet" hint="Run an evaluation to generate control-level risk signals." inset />
      )}
    </Card>
  );
}

function AgentRiskSignals({ agents }: { agents: DashboardData["agentExecutions"] }) {
  return (
    <Card>
      <CardHeader title="Agent Risk Signals" eyebrow={`${agents.length} specialist execution${agents.length === 1 ? "" : "s"}`} />
      {agents.length > 0 ? (
        <div className="divide-y divide-slate-100 dark:divide-slate-700">
          {agents.slice(0, 6).map((agent) => (
            <div key={agent.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                  <Bot className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-[12px] font-semibold capitalize text-slate-950 dark:text-white">{agent.agent_name.replace(/_/g, " ")}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{agent.finding_count} findings created</p>
                </div>
              </div>
              <AgentStatusTag status={agent.status} />
            </div>
          ))}
        </div>
      ) : (
        <PanelEmpty label="No agent activity yet" hint="Specialist agent signals appear after a governance run executes." inset />
      )}
    </Card>
  );
}

function MetricsSourcesTab({ data }: { data: DashboardData }) {
  const counts = data.latestReport?.counts ?? {};
  const sources: Array<[string, string, string]> = [
    ["System Registry", `${data.systems.length} system${data.systems.length === 1 ? "" : "s"}`, "Risk tier, ownership, frameworks, and deployment metadata."],
    ["Run History", `${data.runs.length} run${data.runs.length === 1 ? "" : "s"}`, "Pipeline status, phase, and result summaries."],
    ["Metric Results", `${counts.metric_results ?? 0}`, "Scored metric outcomes from the latest evaluation."],
    ["Evidence Ledger", `${counts.evidence ?? 0} item${counts.evidence === 1 ? "" : "s"}`, "Hash-linked audit trail for findings and review actions."],
    ["Framework Map", `${data.frameworkCoverage.length} framework${data.frameworkCoverage.length === 1 ? "" : "s"}`, "Control-level mapping with pass / fail / pending status."],
    ["Agent Telemetry", `${data.agentExecutions.length} agent${data.agentExecutions.length === 1 ? "" : "s"}`, "Execution status and finding counts per specialist."],
  ];
  return (
    <div className="grid gap-5 xl:grid-cols-3">
      {sources.map(([title, value, detail]) => (
        <Card key={title} className="p-4">
          <Database className="h-4 w-4 text-slate-500 dark:text-slate-400" />
          <p className="mt-3 text-[13px] font-semibold text-slate-950 dark:text-white">{title}</p>
          <p className="mt-1 text-[20px] font-semibold text-slate-950 dark:text-white">{value}</p>
          <p className="mt-2 text-[11px] leading-5 text-slate-500 dark:text-slate-400">{detail}</p>
        </Card>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- states --- */

function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      <div className="h-7 w-56 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl bg-slate-200/70 dark:bg-slate-800" />
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="h-72 animate-pulse rounded-xl bg-slate-200/70 dark:bg-slate-800" />
        ))}
      </div>
    </div>
  );
}

function BackendUnavailable({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 text-center shadow-card">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 dark:bg-red-950/40 text-red-500">
          <ServerCrash className="h-6 w-6" />
        </div>
        <h2 className="mt-4 font-display text-[18px] text-ink dark:text-white">Backend unavailable</h2>
        <p className="mt-2 text-[13px] text-slate-500 dark:text-slate-400">
          Could not reach the governance API. Start the backend, then retry.
        </p>
        <code className="mt-3 block truncate rounded bg-slate-50 dark:bg-slate-800 px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400">
          {message}
        </code>
        <button
          onClick={onRetry}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-brand-700"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </button>
      </div>
    </div>
  );
}

function NoDataYet({ onRefresh, navigateTo }: { onRefresh: () => void; navigateTo: (path: string) => void }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 text-center shadow-card">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 dark:bg-brand-950/40 text-brand-600">
          <Sparkles className="h-6 w-6" />
        </div>
        <h2 className="mt-4 font-display text-[18px] text-ink dark:text-white">No governance data yet</h2>
        <p className="mt-2 text-[13px] text-slate-500 dark:text-slate-400">
          Register an AI system and run an evaluation to populate the dashboard with live results.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button
            onClick={() => navigateTo("/systems")}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-brand-700"
          >
            Register a system
          </button>
          <button
            onClick={onRefresh}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-[13px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- presentational --- */

function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function KpiCard({
  icon: Icon,
  value,
  suffix,
  label,
  detail,
  tone = "green",
  onClick,
}: {
  icon: typeof Layers3;
  value: number | null;
  suffix?: string;
  label: string;
  detail: string;
  tone?: "green" | "red" | "amber";
  onClick: () => void;
}) {
  const toneText = tone === "red" ? "text-red-400" : tone === "amber" ? "text-amber-400" : "text-slate-300";
  return (
    <button
      onClick={onClick}
      className="group rounded-xl bg-white dark:bg-slate-900 px-4 py-3.5 text-left shadow-card ring-1 ring-black/[0.03] dark:ring-white/6 transition-shadow hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">{label}</p>
        <Icon className={clsx("h-4 w-4 shrink-0", toneText)} />
      </div>
      <div className="mt-1.5 flex items-end gap-1">
        <p className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white tabular-nums">
          {value === null ? "—" : <AnimatedNumber value={value} />}
        </p>
        {value !== null && suffix && <span className="mb-1 text-lg font-semibold text-slate-400 dark:text-slate-500">{suffix}</span>}
      </div>
      <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">{detail}</p>
    </button>
  );
}

function ChartCard({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-[#eef0f6] dark:border-slate-700 px-5 py-3.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-3 dark:text-slate-400">{eyebrow}</p>
        <h3 className="mt-1 font-display text-[17px] text-ink dark:text-white">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </Card>
  );
}

function ChartEmpty({ label, icon: Icon = AlertTriangle }: { label: string; icon?: typeof AlertTriangle }) {
  return (
    <div className="flex h-[230px] flex-col items-center justify-center gap-2 text-slate-400 dark:text-slate-500">
      <Icon className="h-8 w-8" />
      <p className="text-[12px]">{label}</p>
    </div>
  );
}

function PanelEmpty({ label, hint, inset }: { label: string; hint: string; inset?: boolean }) {
  return (
    <div className={clsx("rounded-xl border border-dashed border-slate-200 dark:border-slate-700 text-center", inset ? "m-4 p-8" : "p-12")}>
      <p className="text-[14px] font-semibold text-slate-700 dark:text-slate-300">{label}</p>
      <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">{hint}</p>
    </div>
  );
}

function Legend({ items }: { items: Array<[string, string]> }) {
  return (
    <div className="mt-2 flex justify-center gap-4 text-[11px] text-slate-600 dark:text-slate-400">
      {items.map(([label, color]) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-[16px] font-semibold text-slate-950 dark:text-white">{value}</p>
    </div>
  );
}

function SeverityTag({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    critical: "bg-red-100 dark:bg-red-950/50 text-red-800 dark:text-red-300",
    high: "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400",
    medium: "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400",
    low: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400",
    info: "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300",
  };
  return (
    <span className={clsx("shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold capitalize", map[severity] ?? map.info)}>
      {severity}
    </span>
  );
}

function AgentStatusTag({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400",
    running: "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400",
    pending: "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300",
    failed: "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400",
  };
  return (
    <span className={clsx("rounded px-2 py-0.5 text-[10px] font-semibold capitalize", map[status] ?? map.pending)}>
      {status}
    </span>
  );
}
