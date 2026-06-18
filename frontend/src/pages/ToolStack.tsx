import { useState } from "react";
import { ExternalLink, Package, Shield, Wrench, Zap } from "lucide-react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { coreTools, conditionalTools, toolAgentMappings } from "@/data/toolStack";
import type { GovernAITool } from "@/data/toolStack";

export function ToolStack() {
  const [selectedTool, setSelectedTool] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-[#111827] text-white">
            <Wrench className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-700">Open-Source Stack</p>
            <h2 className="mt-1 text-[20px] font-semibold tracking-tight text-slate-950">7 Core Tools + 4 Conditional Add-ons</h2>
            <p className="mt-2 max-w-3xl text-[13px] leading-5 text-slate-600">
              GovernAI&apos;s evaluation engine is built on open-source tools mapped to specialist agents and regulatory frameworks.
              Each tool produces structured evidence that flows into the append-only GovernanceState.
            </p>
          </div>
        </div>
      </Card>

      <div>
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Core Tools (7)</p>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {coreTools.map((tool) => (
            <ToolCard key={tool.id} tool={tool} selected={selectedTool === tool.id} onSelect={() => setSelectedTool(selectedTool === tool.id ? null : tool.id)} />
          ))}
        </div>
      </div>

      <div>
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Conditional Add-ons (4)</p>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {conditionalTools.map((tool) => (
            <ToolCard key={tool.id} tool={tool} selected={selectedTool === tool.id} onSelect={() => setSelectedTool(selectedTool === tool.id ? null : tool.id)} />
          ))}
        </div>
      </div>

      <Card className="p-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Tool → Agent → Framework Mapping</p>
        <p className="mt-1 text-[13px] font-semibold text-slate-950">Which tool powers which agent for which regulatory requirement</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-slate-200 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                <th className="pb-2 pr-4">Tool</th>
                <th className="pb-2 pr-4">Agent</th>
                <th className="pb-2">Framework Article</th>
              </tr>
            </thead>
            <tbody>
              {toolAgentMappings.map((mapping, idx) => (
                <tr key={idx} className="border-b border-slate-100 last:border-0">
                  <td className="py-2.5 pr-4">
                    <span className="font-mono text-[11px] font-medium text-slate-950">{mapping.tool}</span>
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className="rounded bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-800">{mapping.agent}</span>
                  </td>
                  <td className="py-2.5 text-[11px] text-slate-600">{mapping.frameworkArticle}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function ToolCard({ tool, selected, onSelect }: { tool: GovernAITool; selected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={clsx(
        "rounded-lg border p-4 text-left transition-all hover:border-blue-300 hover:shadow-sm",
        selected ? "border-blue-400 bg-blue-50/50 ring-1 ring-blue-200" : "border-slate-200 bg-white",
        tool.conditional && "border-dashed"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-slate-600">
          {tool.conditional ? <Zap className="h-4 w-4" /> : <Package className="h-4 w-4" />}
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">{tool.version}</span>
          <a
            href={tool.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-slate-400 hover:text-blue-600"
            title={`Open ${tool.name} docs`}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      <p className="mt-3 text-[13px] font-semibold text-slate-950">{tool.name}</p>
      <p className="mt-1 text-[11px] leading-4 text-slate-600">{tool.role}</p>

      <div className="mt-3 flex items-center gap-3 text-[10px] text-slate-500">
        <span className="flex items-center gap-1">
          <Shield className="h-3 w-3" />
          {tool.license}
        </span>
        <span>★ {tool.githubStars}</span>
      </div>

      {tool.conditional && tool.activationTrigger && (
        <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-800">
          Trigger: {tool.activationTrigger}
        </p>
      )}

      {selected && (
        <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Used by</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {tool.agents.map((agent) => (
                <span key={agent} className="rounded bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-800">{agent}</span>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Framework evidence</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {tool.frameworkEvidence.map((fw) => (
                <span key={fw} className="rounded bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700">{fw}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </button>
  );
}
