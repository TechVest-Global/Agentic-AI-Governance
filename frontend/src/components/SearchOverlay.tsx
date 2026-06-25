import { Activity, Bot, BookOpen, GitBranch, Search, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import clsx from "clsx";
import { agents, auditEvents, findings, liveRuns, navigation, systems } from "@/data/mockData";

type SearchResult = {
  id: string;
  title: string;
  description: string;
  path: string;
  group: string;
  icon: LucideIcon;
};

const allResults: SearchResult[] = [
  ...navigation.map((item) => ({
    id: `nav-${item.id}`,
    title: item.label,
    description: `${item.section} workspace`,
    path: item.path,
    group: "Pages",
    icon: item.icon,
  })),
  ...systems.map((system) => ({
    id: `system-${system.id}`,
    title: system.name,
    description: `${system.domain} - ${system.riskTier} risk - ${system.owner}`,
    path: `/systems/${system.id}`,
    group: "AI Systems",
    icon: ShieldCheck,
  })),
  ...liveRuns.map((run) => ({
    id: `run-${run.id}`,
    title: run.system,
    description: `${run.status} run - ${run.framework}`,
    path: `/runs/${run.id}`,
    group: "Runs",
    icon: Activity,
  })),
  ...agents.map((agent) => ({
    id: `agent-${agent.name}`,
    title: agent.name,
    description: `${agent.role} - ${agent.status} - ${agent.findings} findings`,
    path: "/agents",
    group: "Agents",
    icon: Bot,
  })),
  ...findings.map((finding) => ({
    id: `finding-${finding.id}`,
    title: finding.title,
    description: `${finding.severity} - ${finding.agent} - ${finding.framework}`,
    path: "/verdicts",
    group: "Findings",
    icon: GitBranch,
  })),
  ...auditEvents.map((event) => ({
    id: `audit-${event.id}`,
    title: event.description,
    description: `${event.actor} - ${event.type} - ${event.hash}`,
    path: "/ledger",
    group: "Audit Trail",
    icon: BookOpen,
  })),
];

export function SearchOverlay({
  query,
  onSelect,
}: {
  query: string;
  onSelect: (path: string) => void;
}) {
  const normalizedQuery = query.trim().toLowerCase();
  const results = (normalizedQuery
    ? allResults.filter((result) =>
        `${result.title} ${result.description} ${result.group}`.toLowerCase().includes(normalizedQuery)
      )
    : allResults
  ).slice(0, 8);

  return (
    <div
      className="absolute left-0 top-11 z-50 w-full overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg"
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="border-b border-slate-100 px-3 py-2 text-[11px] font-medium text-slate-500">
        {normalizedQuery ? `${results.length} matches` : "Quick search"}
      </div>
      <div className="max-h-[420px] overflow-y-auto p-1.5">
        {results.length > 0 ? (
          results.map((result) => {
            const Icon = result.icon;
            return (
              <button
                key={result.id}
                onClick={() => onSelect(result.path)}
                className={clsx(
                  "flex w-full items-start gap-3 rounded px-2.5 py-2 text-left transition-colors",
                  "hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                )}
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-600">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-slate-950">{result.title}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-slate-500">{result.description}</span>
                </span>
                <span className="mt-1 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500">
                  {result.group}
                </span>
              </button>
            );
          })
        ) : (
          <div className="flex items-center gap-2 px-3 py-8 text-[12px] text-slate-500">
            <Search className="h-4 w-4" />
            No matching systems, runs, evidence, or controls.
          </div>
        )}
      </div>
    </div>
  );
}
