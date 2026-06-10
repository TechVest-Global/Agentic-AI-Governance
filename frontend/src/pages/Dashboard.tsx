import { useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  CircleX,
  Database,
  Layers3,
  ShieldAlert,
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
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardHeader } from "@/components/ui/Card";
import { agents, findings, liveRuns, riskSeries, systems } from "@/data/mockData";
import { useAppStore } from "@/store/useAppStore";

type DashboardTab = "Overview" | "Compliance" | "Risk Analysis" | "Agent Performance" | "Metrics & Sources";

const tabs: DashboardTab[] = ["Overview", "Compliance", "Risk Analysis", "Agent Performance", "Metrics & Sources"];

const confidenceTrend = [
  { month: "Jan", score: 72 },
  { month: "Feb", score: 74 },
  { month: "Mar", score: 71 },
  { month: "Apr", score: 78 },
  { month: "May", score: 75 },
  { month: "Jun", score: 82 },
  { month: "Jul", score: 79 },
  { month: "Aug", score: 84 },
  { month: "Sep", score: 86 },
  { month: "Oct", score: 83 },
  { month: "Nov", score: 87 },
  { month: "Dec", score: 89 },
];

const weeklyRuns = [
  { week: "W18", passed: 4, flagged: 1, blocked: 0 },
  { week: "W19", passed: 3, flagged: 2, blocked: 1 },
  { week: "W20", passed: 5, flagged: 1, blocked: 0 },
  { week: "W21", passed: 4, flagged: 3, blocked: 1 },
  { week: "W22", passed: 6, flagged: 2, blocked: 0 },
  { week: "W23", passed: 5, flagged: 1, blocked: 1 },
];

const severityTrend = [
  { month: "Jan", critical: 1, high: 2, medium: 3 },
  { month: "Feb", critical: 1, high: 3, medium: 2 },
  { month: "Mar", critical: 0, high: 2, medium: 4 },
  { month: "Apr", critical: 2, high: 3, medium: 4 },
  { month: "May", critical: 1, high: 4, medium: 3 },
  { month: "Jun", critical: 1, high: 3, medium: 5 },
];

const riskDistribution = [
  { name: "High Risk", value: systems.filter((system) => system.riskTier === "High").length, color: "#ef4444" },
  { name: "Medium Risk", value: systems.filter((system) => system.riskTier === "Medium").length, color: "#f59e0b" },
  { name: "Low Risk", value: systems.filter((system) => system.riskTier === "Low").length, color: "#10b981" },
];

const complianceRows = [
  { framework: "EU AI Act", coverage: 86, status: "Partial", gaps: 3 },
  { framework: "SR 11-7", coverage: 78, status: "Review", gaps: 5 },
  { framework: "NIST AI RMF", coverage: 91, status: "Aligned", gaps: 1 },
  { framework: "OECD AI Principles", coverage: 84, status: "Partial", gaps: 2 },
];

export function Dashboard() {
  const [activeTab, setActiveTab] = useState<DashboardTab>("Overview");
  const navigateTo = useAppStore((state) => state.navigateTo);
  const activeRuns = liveRuns.filter((run) => run.status === "Running").length;
  const blockedSystems = systems.filter((system) => system.status === "Blocked").length;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={Layers3}
          value={systems.length}
          label="Total AI Systems"
          detail="+2 this month"
          trend="up"
          onClick={() => navigateTo("/systems")}
        />
        <KpiCard
          icon={Activity}
          value={activeRuns}
          label="Active Governance Runs"
          detail="1 in progress"
          onClick={() => navigateTo("/runs")}
        />
        <KpiCard
          icon={ShieldAlert}
          value={findings.length}
          label="Open Findings"
          detail="+1 Critical"
          trend="down"
          tone="red"
          onClick={() => navigateTo("/verdicts")}
        />
        <KpiCard
          icon={CircleX}
          value={blockedSystems}
          label="Blocked Systems"
          detail="1 pending review"
          trend="down"
          tone="red"
          onClick={() => navigateTo("/systems")}
        />
      </div>

      <div className="border-b border-slate-200">
        <div className="flex flex-wrap gap-1">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={clsx(
                "border-b-2 px-4 py-3 text-[14px] font-medium transition-colors",
                activeTab === tab
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-950"
              )}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "Overview" && <OverviewTab />}
      {activeTab === "Compliance" && <ComplianceTab />}
      {activeTab === "Risk Analysis" && <RiskAnalysisTab />}
      {activeTab === "Agent Performance" && <AgentPerformanceTab />}
      {activeTab === "Metrics & Sources" && <MetricsSourcesTab />}
    </div>
  );
}

function OverviewTab() {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <ChartCard eyebrow="12-Month Trend vs. Target (85%)" title="Governance Confidence Score">
        <ResponsiveContainer width="100%" height={230}>
          <AreaChart data={confidenceTrend} margin={{ left: -18, right: 10, top: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="confidenceFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.22} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
            <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: "#94a3b8" }} tick={{ fontSize: 11, fill: "#64748b" }} />
            <YAxis domain={[60, 100]} tickLine={false} axisLine={{ stroke: "#94a3b8" }} tick={{ fontSize: 11, fill: "#64748b" }} />
            <Tooltip />
            <Area type="monotone" dataKey="score" stroke="#2563eb" strokeWidth={2} fill="url(#confidenceFill)" />
            <Line type="monotone" dataKey={() => 85} stroke="#ef4444" strokeDasharray="4 4" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard eyebrow="Last 6 Weeks - Outcomes Breakdown" title="Governance Runs by Week">
        <ResponsiveContainer width="100%" height={230}>
          <BarChart data={weeklyRuns} margin={{ left: -18, right: 10, top: 8, bottom: 0 }}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical />
            <XAxis dataKey="week" tickLine={false} axisLine={{ stroke: "#94a3b8" }} tick={{ fontSize: 11, fill: "#64748b" }} />
            <YAxis tickLine={false} axisLine={{ stroke: "#94a3b8" }} tick={{ fontSize: 11, fill: "#64748b" }} />
            <Tooltip />
            <Bar dataKey="passed" stackId="runs" fill="#10b981" />
            <Bar dataKey="flagged" stackId="runs" fill="#f59e0b" />
            <Bar dataKey="blocked" stackId="runs" fill="#ef4444" />
          </BarChart>
        </ResponsiveContainer>
        <Legend items={[["Blocked", "#ef4444"], ["Flagged", "#f59e0b"], ["Passed", "#10b981"]]} />
      </ChartCard>

      <ChartCard eyebrow="Current Tier Classification" title="System Risk Distribution">
        <div className="grid min-h-[250px] items-center gap-4 md:grid-cols-[0.9fr_1.1fr]">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={riskDistribution} dataKey="value" innerRadius={62} outerRadius={92} paddingAngle={2}>
                {riskDistribution.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-3">
            {riskDistribution.map((entry) => (
              <div key={entry.name} className="flex items-center justify-between rounded border border-slate-200 px-3 py-2 text-[12px]">
                <span className="flex items-center gap-2 font-medium text-slate-700">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                  {entry.name}
                </span>
                <span className="font-semibold text-slate-950">{entry.value}</span>
              </div>
            ))}
          </div>
        </div>
      </ChartCard>

      <ChartCard eyebrow="Monthly Breakdown by Severity" title="Finding Severity Trend">
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={severityTrend} margin={{ left: -18, right: 10, top: 8, bottom: 0 }}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
            <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: "#94a3b8" }} tick={{ fontSize: 11, fill: "#64748b" }} />
            <YAxis tickLine={false} axisLine={{ stroke: "#94a3b8" }} tick={{ fontSize: 11, fill: "#64748b" }} />
            <Tooltip />
            <Line type="monotone" dataKey="critical" stroke="#ef4444" strokeWidth={2} />
            <Line type="monotone" dataKey="high" stroke="#f59e0b" strokeWidth={2} />
            <Line type="monotone" dataKey="medium" stroke="#2563eb" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function ComplianceTab() {
  return (
    <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
      <Card>
        <CardHeader title="Framework Compliance Coverage" eyebrow="Controls" />
        <div className="divide-y divide-slate-100">
          {complianceRows.map((row) => (
            <div key={row.framework} className="px-4 py-4">
              <div className="flex items-center justify-between gap-3 text-[12px]">
                <span className="font-semibold text-slate-950">{row.framework}</span>
                <span className="text-slate-500">{row.coverage}% coverage - {row.gaps} gaps</span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-slate-100">
                <div className="h-2 rounded-full bg-blue-600" style={{ width: `${row.coverage}%` }} />
              </div>
            </div>
          ))}
        </div>
      </Card>
      <ChartCard eyebrow="Evidence Coverage" title="Controls by Framework">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={complianceRows} layout="vertical" margin={{ left: 18, right: 10, top: 8, bottom: 0 }}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
            <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: "#64748b" }} />
            <YAxis type="category" dataKey="framework" width={110} tick={{ fontSize: 11, fill: "#64748b" }} />
            <Tooltip />
            <Bar dataKey="coverage" fill="#2563eb" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function RiskAnalysisTab() {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <ChartCard eyebrow="Composite Risk Scores" title="Risk Dimensions">
        <div className="space-y-4 p-1">
          {riskSeries.map((risk) => (
            <div key={risk.name}>
              <div className="flex items-center justify-between text-[12px]">
                <span className="font-medium text-slate-700">{risk.name}</span>
                <span className="font-semibold text-slate-950">{risk.score}</span>
              </div>
              <div className="mt-1.5 h-2 rounded-full bg-slate-100">
                <div className="h-2 rounded-full bg-slate-900" style={{ width: `${risk.score}%` }} />
              </div>
            </div>
          ))}
        </div>
      </ChartCard>
      <Card>
        <CardHeader title="Current Findings" eyebrow="Open Issues" />
        <div className="divide-y divide-slate-100">
          {findings.map((finding) => (
            <div key={finding.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[12px] font-semibold text-slate-950">{finding.title}</p>
                <span className="rounded bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">{finding.severity}</span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">{finding.framework}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function AgentPerformanceTab() {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      {agents.map((agent) => (
        <Card key={agent.name} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded bg-slate-100 text-slate-600">
                <Bot className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-[13px] font-semibold text-slate-950">{agent.name}</h3>
                <p className="mt-0.5 text-[11px] text-slate-500">{agent.role}</p>
              </div>
            </div>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">{agent.status}</span>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 text-[12px]">
            <MiniStat label="Progress" value={`${agent.progress}%`} />
            <MiniStat label="Probes" value={agent.probes} />
            <MiniStat label="Confidence" value={`${agent.confidence}%`} />
          </div>
        </Card>
      ))}
    </div>
  );
}

function MetricsSourcesTab() {
  return (
    <div className="grid gap-5 xl:grid-cols-3">
      {[
        ["System Registry", "5 systems", "Risk tier, ownership, review cadence, and environment metadata."],
        ["Runtime Events", "2 runs", "Pipeline status, progress, probe counts, and finding counts."],
        ["Evidence Ledger", "4 events", "Hash-linked audit trail for agent findings and review actions."],
        ["Framework Map", "4 frameworks", "EU AI Act, SR 11-7, NIST AI RMF, and OECD principles."],
        ["Agent Telemetry", "6 agents", "Probe coverage, confidence, progress, and status details."],
        ["Export Sources", "CSV / JSON", "Governance artifacts available through report exports."],
      ].map(([title, value, detail]) => (
        <Card key={title} className="p-4">
          <Database className="h-4 w-4 text-slate-500" />
          <p className="mt-3 text-[13px] font-semibold text-slate-950">{title}</p>
          <p className="mt-1 text-[20px] font-semibold text-slate-950">{value}</p>
          <p className="mt-2 text-[11px] leading-5 text-slate-500">{detail}</p>
        </Card>
      ))}
    </div>
  );
}

function KpiCard({
  icon: Icon,
  value,
  label,
  detail,
  trend,
  tone = "green",
  onClick,
}: {
  icon: typeof Layers3;
  value: number;
  label: string;
  detail: string;
  trend?: "up" | "down";
  tone?: "green" | "red";
  onClick: () => void;
}) {
  const TrendIcon = trend === "down" ? ArrowDownRight : ArrowUpRight;

  return (
    <button onClick={onClick} className="rounded-md border border-slate-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-blue-300">
      <div className="flex items-start justify-between">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-100 text-slate-600">
          <Icon className="h-4 w-4" />
        </span>
        {trend && (
          <span className={clsx("rounded px-1.5 py-1", tone === "red" ? "bg-red-100 text-red-600" : "bg-emerald-100 text-emerald-600")}>
            <TrendIcon className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
      <p className="mt-5 text-[25px] font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-1 text-[12px] text-slate-600">{label}</p>
      <p className="mt-1 text-[11px] text-blue-600">{detail}</p>
    </button>
  );
}

function ChartCard({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-200 px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">{eyebrow}</p>
        <h3 className="mt-1 text-[13px] font-semibold text-slate-950">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </Card>
  );
}

function Legend({ items }: { items: Array<[string, string]> }) {
  return (
    <div className="mt-2 flex justify-center gap-4 text-[11px] text-slate-600">
      {items.map(([label, color]) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5" style={{ backgroundColor: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-1 text-[16px] font-semibold text-slate-950">{value}</p>
    </div>
  );
}
