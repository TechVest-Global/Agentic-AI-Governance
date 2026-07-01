import { ScanSearch } from "lucide-react";
import type { BackendFinding, GovernanceReport } from "@/api/governanceApi";
import type { CouncilMemberId } from "@/components/execution/LiveRunSidebar";
import { BarRow, DrawerHeader, DrawerNote, DrawerSection, ReceivesList, StatGrid } from "@/components/execution/DrawerPrimitives";

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

/** One line per agent — count of findings and its highest severity — instead of one line per finding. */
function summarizeFindingsByAgent(findings: BackendFinding[]): string[] {
  const byAgent = new Map<string, BackendFinding[]>();
  for (const f of findings) {
    const key = f.agent_name ? f.agent_name.replace(/_/g, " ") : f.finding_type;
    byAgent.set(key, [...(byAgent.get(key) ?? []), f]);
  }
  return Array.from(byAgent.entries()).map(([agent, agentFindings]) => {
    const highest = agentFindings.reduce((a, b) =>
      (SEVERITY_RANK[b.severity] ?? 0) > (SEVERITY_RANK[a.severity] ?? 0) ? b : a
    );
    return `${agent} · ${agentFindings.length} finding${agentFindings.length === 1 ? "" : "s"}, highest: ${highest.severity.toUpperCase()}`;
  });
}

const TIER_LABEL: Record<string, string> = {
  autonomous: "Autonomous",
  supervised: "Supervised",
  human_review: "Human Review",
};

const TIER_COLOR: Record<string, string> = {
  autonomous: "#10b981",
  supervised: "#d97706",
  human_review: "#e11d48",
};

/** Real synthesis, forced-dissent objections, and confidence-scored verdict for this run —
 * shows whichever council member is selected in the sidebar (mirrors the specialist agent detail). */
export function DeliberationCouncilPanel({
  report,
  selectedMemberId,
}: {
  report: GovernanceReport | null;
  selectedMemberId: CouncilMemberId | null;
}) {
  const verdict = report?.verdict;

  if (!verdict) {
    return (
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-4 py-8 text-center">
        <ScanSearch className="mx-auto h-6 w-6 text-slate-300 dark:text-slate-600 mb-2" />
        <p className="text-[12.5px] text-slate-500 dark:text-slate-400">No verdict recorded for this run yet — the council has not deliberated.</p>
      </div>
    );
  }

  if (!selectedMemberId) {
    return <p className="text-[12px] text-slate-500 dark:text-slate-400">Select a council member from the sidebar to view its detail.</p>;
  }

  const tierColor = TIER_COLOR[verdict.action_tier] ?? "#64748b";
  const tierLabel = TIER_LABEL[verdict.action_tier] ?? verdict.action_tier;
  const findings = report?.findings ?? [];

  if (selectedMemberId === "synthesis") {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <DrawerHeader
          icon={<span>⌘</span>}
          iconColor="#0ea5a4"
          title="Synthesis Agent"
          meta="Council · step 1 of 3"
          headline="Specialist findings woven into one coherent risk narrative."
          method="Reads the full append-only findings set · single-turn synthesis · no new probing"
        />
        <div className="p-4">
          <DrawerSection label="Receives">
            <ReceivesList items={summarizeFindingsByAgent(findings)} />
          </DrawerSection>
          <DrawerSection label="Synthesis narrative">
            <DrawerNote>{verdict.synthesis ?? "No synthesis text recorded."}</DrawerNote>
          </DrawerSection>
        </div>
      </div>
    );
  }

  if (selectedMemberId === "advocate") {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <DrawerHeader
          icon={<span>⚖</span>}
          iconColor="#d97706"
          title="Devil's Advocate"
          meta="Council · step 2 of 3"
          headline="A mandatory, evidence-based objection — groupthink is forbidden by design."
          method="Adversarial review of the synthesis · must produce at least one objection or the system retries"
        />
        <div className="p-4">
          <DrawerSection label={`Objections on record (${verdict.objections.length})`}>
            {verdict.objections.length === 0 ? (
              <p className="text-[12.5px] text-slate-500 dark:text-slate-400">No objections recorded.</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {verdict.objections.map((obj, i) => (
                  <DrawerNote
                    key={obj.objection_id + i}
                    footer={obj.suggested_fix}
                  >
                    <p className="mb-1 text-[10.5px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">{obj.category.replace(/_/g, " ")}</p>
                    {obj.argument}
                  </DrawerNote>
                ))}
              </div>
            )}
          </DrawerSection>
        </div>
      </div>
    );
  }

  // verdict
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <DrawerHeader
        icon={<span>◎</span>}
        iconColor={tierColor}
        title="Verdict Agent"
        meta="Council · step 3 of 3"
        headline={`Confidence ${Math.round(verdict.confidence_score * 100)}% → routed to the ${tierLabel} tier.`}
        method="Scores confidence · applies the advocate's deduction · a fixed threshold makes the call"
      />
      <div className="p-4">
        <DrawerSection label="At a glance">
          <StatGrid
            stats={[
              ["Confidence", `${Math.round(verdict.confidence_score * 100)}%`],
              ["Tier", tierLabel],
              ["Label", verdict.label],
              ["Objections", `${verdict.objections.length}`],
            ]}
          />
        </DrawerSection>
        <DrawerSection label="Threshold routing">
          <div className="flex flex-col gap-0.5">
            <BarRow label="Autonomous (> 85%)" value={verdict.action_tier === "autonomous" ? "yes" : "no"} max={1} color="#10b981" />
            <BarRow label="Supervised (65–85%)" value={verdict.action_tier === "supervised" ? "yes" : "no"} max={1} color="#d97706" />
            <BarRow label="Human review (< 65%)" value={verdict.action_tier === "human_review" ? "yes" : "no"} max={1} color="#e11d48" />
          </div>
        </DrawerSection>
        {verdict.reasoning && (
          <DrawerSection label="Reasoning">
            <DrawerNote>{verdict.reasoning}</DrawerNote>
          </DrawerSection>
        )}
        {verdict.required_actions.length > 0 && (
          <DrawerSection label="Required actions">
            <div className="flex flex-col gap-2">
              {verdict.required_actions.map((action, i) => (
                <div key={i} className="rounded-[10px] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-3 py-2.5">
                  <p className="text-[12px] text-slate-700 dark:text-slate-300">{action.action}</p>
                  <p className="mt-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    {action.severity} · owner: {action.owner}
                  </p>
                </div>
              ))}
            </div>
          </DrawerSection>
        )}
      </div>
    </div>
  );
}
