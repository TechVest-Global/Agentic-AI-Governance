import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, FileText, Info } from "lucide-react";
import clsx from "clsx";
import { complianceRows, oecdRows } from "@/data/mockData";
import { Badge, toneForStatus } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { useGovernanceBackend } from "@/hooks/useGovernanceBackend";

type Framework = string;
type ReportRow = {
  clause: string;
  status: string;
  evidence: string;
  principle?: string;
};

const frameworkTabs: Framework[] = ["EU AI Act", "SR 11-7", "NIST AI RMF", "OECD AI Principles"];

const srRows = [
  { clause: "Model Inventory", status: "Pass", evidence: "System registered in governance registry with owner, version, and risk tier." },
  { clause: "Validation Independence", status: "Pass", evidence: "Independent review panel signed off on baseline. v1 review is in progress." },
  { clause: "Ongoing Monitoring", status: "Partial", evidence: "Automated governance runs active. Human review cadence is below quarterly threshold." },
  { clause: "Documentation Completeness", status: "Fail", evidence: "Model development documentation missing key assumption registry entries." },
];

const nistRows = [
  { clause: "Govern 1.1 — Risk Tolerance", status: "Pass", evidence: "Risk tier classification present. Tolerance thresholds defined in governance charter." },
  { clause: "Map 1.5 — Context Documentation", status: "Pass", evidence: "Intended-use and prohibited-use declarations present." },
  { clause: "Measure 2.5 — Drift Detection", status: "Fail", evidence: "Semantic similarity 0.61 vs 0.80 threshold. Drift confirmed across 17 prompts." },
  { clause: "Manage 3.2 — Incident Response", status: "Partial", evidence: "Incident escalation path documented. No test run completed in current period." },
];

const clauseDetail: Record<string, string> = {
  "Art.52 Transparency": "Requires that users are informed they are interacting with an AI system. For TechVest chatbot, all decisioning explanations must be disclosed in the customer-facing communication.",
  "Annex III Risk Classification": "Systems used to assess individuals' chatbot response quality fall under EU AI Act Annex III §5(b) as high-risk AI. This determines the full conformity assessment requirement.",
  "Art.10(2)(f) Data Governance": "Requires that training data is examined for possible biases, including those that could lead to prohibited discrimination on protected attributes including age.",
  "Annex IV 3.2 Technical Docs": "The conformity file must include a detailed description of training data, including its provenance, collection methodology, and preprocessing steps.",
  "Art.26 Deployer Obligations": "Deployers of high-risk AI must implement technical and organizational measures including human oversight, monitoring, and logging of system usage.",
  "P1.1 Stakeholder benefit assessment": "Evidence that the AI system's benefits to stakeholders, including end users, affected communities, and broader society, have been identified and documented.",
  "P1.2 Worker impact consideration": "Impact on workers, including job displacement, skill requirements, and working conditions, has been assessed.",
  "P1.3 Environmental sustainability": "Environmental impact of the AI system, including energy consumption and carbon footprint, has been considered.",
  "P2.2 Non-discrimination and fairness": "The AI system does not discriminate against individuals or groups and produces fair outcomes across demographics.",
  "P2.3 Human oversight mechanisms": "Meaningful human oversight mechanisms are in place to intervene in, override, or stop AI system operations.",
  "P2.4 Redress and recourse": "Affected individuals have access to adequate redress mechanisms when harmed by AI system decisions.",
  "P3.1 AI system disclosure": "Users and affected parties are informed when they are interacting with or affected by an AI system.",
  "P3.2 Explainability of decisions": "AI system decisions can be explained in terms understandable to affected stakeholders.",
  "P3.4 Auditability": "The AI system and its decisions are auditable by authorized parties.",
  "P4.5 Ongoing monitoring and maintenance": "Continuous monitoring and maintenance processes ensure sustained safety and performance.",
  "P4.6 Adversarial robustness": "The AI system is resilient to adversarial attacks including prompt injection, jailbreaking, and data poisoning.",
  "P5.1 Governance mechanisms": "Clear governance mechanisms are in place for the AI system with defined roles, responsibilities, and oversight structures.",
  "P5.2 Decision accountability mapping": "For every consequential decision, a named human role is assigned accountability with clear decision authority.",
  "P5.6 Supply chain accountability": "Accountability extends through the AI supply chain including third-party model providers and data sources.",
};

const rowsByFramework: Record<string, ReportRow[]> = {
  "EU AI Act": complianceRows,
  "SR 11-7": srRows,
  "NIST AI RMF": nistRows,
  "OECD AI Principles": oecdRows,
};

const frameworkContext: Record<Framework, string> = {
  "EU AI Act": "Regulatory clause-level compliance posture for high-risk AI obligations.",
  "SR 11-7": "Banking model risk management posture across inventory, validation, monitoring, and documentation.",
  "NIST AI RMF": "Risk management posture across govern, map, measure, and manage functions.",
  "OECD AI Principles": "Ethical capstone assessment using the 2024 OECD principles and aligned / partially aligned / not aligned ratings.",
};

export function Reports() {
  const backend = useGovernanceBackend();
  const [activeFramework, setActiveFramework] = useState<Framework>("EU AI Act");
  const [expandedClause, setExpandedClause] = useState<string | null>(null);
  const reportSystemName = backend.report?.ai_system.name ?? "TechVest RAG Chatbot";

  const backendRowsByFramework = useMemo(() => {
    if (!backend.frameworkMap?.controls.length) return {};

    return backend.frameworkMap.controls.reduce<Record<string, ReportRow[]>>((acc, control) => {
      const frameworkName = control.framework_name;
      const evidence = [
        `${control.passed_metric_count} passed`,
        `${control.failed_metric_count} failed`,
        `${control.pending_metric_count} pending`,
        `${control.finding_count} findings`,
      ].join(" / ");

      acc[frameworkName] = [
        ...(acc[frameworkName] ?? []),
        {
          clause: control.control_title
            ? `${control.control_ref} - ${control.control_title}`
            : control.control_ref,
          status: formatBackendControlStatus(control.status),
          evidence,
          principle: control.control_category ?? undefined,
        },
      ];
      return acc;
    }, {});
  }, [backend.frameworkMap]);

  const tabOptions = Object.keys(backendRowsByFramework).length
    ? Object.keys(backendRowsByFramework)
    : frameworkTabs;
  const resolvedFramework = tabOptions.includes(activeFramework) ? activeFramework : tabOptions[0];
  const rows = backendRowsByFramework[resolvedFramework] ?? rowsByFramework[resolvedFramework] ?? [];
  const isOecd = resolvedFramework === "OECD AI Principles";
  const passCount = rows.filter((r) => r.status === "Pass" || r.status === "Aligned").length;
  const failCount = rows.filter((r) => r.status === "Fail" || r.status === "Not aligned").length;
  const partialCount = rows.filter((r) => r.status === "Partial" || r.status === "Partially aligned").length;
  const summaryCopy = isOecd
    ? {
        pass: "Aligned",
        passHint: "indicators demonstrably met",
        partial: "Partially aligned",
        partialHint: "indicators with defined gaps",
        fail: "Not aligned",
        failHint: "indicators requiring escalation",
      }
    : {
        pass: "Passing",
        passHint: "clauses fully satisfied",
        partial: "Partial",
        partialHint: "clauses partially satisfied",
        fail: "Failing",
        failHint: "clauses not satisfied",
      };

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-700">
              Backend Report Connection
            </p>
            <p className="mt-1 text-[13px] text-slate-700">
              {backend.usingBackend && backend.report
                ? `Loaded run ${backend.report.run.id.slice(0, 8)} for ${backend.report.ai_system.name}.`
                : backend.loading
                  ? "Loading latest backend evaluation run..."
                  : "Backend unavailable or no evaluation runs found. Showing prototype data."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {backend.report && (
              <>
                <Badge tone={backend.report.state_chain.valid ? "green" : "red"}>
                  State {backend.report.state_chain.valid ? "Verified" : "Invalid"}
                </Badge>
                <Badge tone="blue">{backend.report.counts.metric_results ?? 0} metric results</Badge>
                <Badge tone="amber">{backend.report.counts.findings ?? 0} findings</Badge>
              </>
            )}
            {backend.error && <Badge tone="slate">Mock fallback</Badge>}
          </div>
        </div>
      </Card>

      {/* Intro */}
      <div className="flex items-start justify-between border-b border-slate-200 pb-5">
        <div className="max-w-2xl space-y-1">
          <p className="text-[13px] leading-5 text-slate-600">
            Clause-level compliance reports for <span className="font-semibold text-slate-950">{reportSystemName}</span> generated from the last governance run. Select a framework to view its compliance posture. Click any row to read the full clause context and evidence detail.
          </p>
          <p className="text-[12px] leading-5 text-slate-500">
            {frameworkContext[activeFramework]}
            {isOecd && <span className="font-medium text-slate-700"> Representative rows shown from the 42-indicator assessment.</span>}
          </p>
          <p className="text-[11px] text-slate-400">Click rows to expand evidence and clause definition · Switch frameworks using the tabs above the table</p>
        </div>
        <div className="flex shrink-0 gap-2">
          {["PDF", "JSON", "CSV"].map((format) => (
            <button
              key={format}
              title={`Export this compliance report as ${format}`}
              className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-2 text-[12px] font-medium text-slate-800 transition-colors hover:border-slate-400 hover:bg-slate-50"
            >
              <Download className="h-4 w-4" /> {format}
            </button>
          ))}
        </div>
      </div>

      {/* Summary metrics */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">{summaryCopy.pass}</p>
          <p className="mt-1 text-[28px] font-bold text-emerald-800">{passCount}</p>
          <p className="text-[11px] text-emerald-700">{summaryCopy.passHint}</p>
        </div>
        <div className="rounded border border-amber-200 bg-amber-50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-600">{summaryCopy.partial}</p>
          <p className="mt-1 text-[28px] font-bold text-amber-800">{partialCount}</p>
          <p className="text-[11px] text-amber-700">{summaryCopy.partialHint}</p>
        </div>
        <div className="rounded border border-red-200 bg-red-50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-red-600">{summaryCopy.fail}</p>
          <p className="mt-1 text-[28px] font-bold text-red-800">{failCount}</p>
          <p className="text-[11px] text-red-700">{summaryCopy.failHint}</p>
        </div>
      </div>

      {/* Framework selector + table */}
      <Card>
        {/* Framework tabs */}
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-0">
          <div className="flex gap-1 pt-2">
            {tabOptions.map((fw) => (
              <button
                key={fw}
                onClick={() => { setActiveFramework(fw); setExpandedClause(null); }}
                className={clsx(
                  "rounded-t border border-b-0 px-3 py-2 text-[12px] font-medium transition-colors",
                  resolvedFramework === fw
                    ? "border-slate-300 bg-white text-slate-950"
                    : "border-transparent text-slate-500 hover:text-slate-900"
                )}
              >
                {fw}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 pb-1 text-[11px] text-slate-400">
            <FileText className="h-3.5 w-3.5" />
            {backend.report?.ai_system.name ?? "prototype"} · {backend.latestRun?.current_phase ?? "mock data"}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead className="bg-slate-50">
              <tr className="border-b border-slate-200">
                <th className="w-6 px-4 py-3" />
                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">{activeFramework} {isOecd ? "Indicator" : "Clause"}</th>
                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">Status</th>
                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">Evidence Summary</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isExpanded = expandedClause === row.clause;
                const detail = clauseDetail[row.clause];
                return (
                  <Fragment key={row.clause}>
                    <tr
                      onClick={() => setExpandedClause(isExpanded ? null : row.clause)}
                      className={clsx(
                        "group cursor-pointer border-t border-slate-100 transition-colors",
                        isExpanded ? "bg-blue-50" : "hover:bg-slate-50"
                      )}
                    >
                      <td className="px-4 py-3 text-slate-400">
                        {isExpanded
                          ? <ChevronDown className="h-3.5 w-3.5 text-blue-600" />
                          : <ChevronRight className="h-3.5 w-3.5 group-hover:text-slate-700" />}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-1.5">
                          <div>
                            <p className="text-[13px] font-medium text-slate-950">{row.clause}</p>
                            {row.principle && <p className="mt-0.5 text-[10px] text-slate-500">{row.principle}</p>}
                          </div>
                          {detail && <Info className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={toneForStatus(row.status)}>{row.status}</Badge>
                      </td>
                      <td className="px-4 py-3 text-[12px] text-slate-700">{row.evidence}</td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${row.clause}-expanded`} className="border-t border-blue-100 bg-blue-50/60">
                        <td />
                        <td colSpan={3} className="px-4 py-3">
                          <div className="space-y-3">
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Full Evidence</p>
                              <p className="mt-1 text-[12px] leading-5 text-slate-700">{row.evidence}</p>
                            </div>
                            {row.principle && (
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">OECD Principle</p>
                                <p className="mt-1 text-[12px] leading-5 text-slate-700">{row.principle}</p>
                              </div>
                            )}
                            {detail && (
                              <div className="rounded border border-slate-200 bg-white p-3">
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Clause Definition</p>
                                <p className="mt-1 text-[12px] leading-5 text-slate-700">{detail}</p>
                              </div>
                            )}
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Remediation</p>
                              <p className="mt-1 text-[12px] text-slate-700">
                                {row.status === "Fail" || row.status === "Not aligned"
                                  ? "This item is failing. Add it to the remediation queue and assign an owner with a deadline before the next governance review."
                                  : row.status === "Partial" || row.status === "Partially aligned"
                                  ? "This item is partially satisfied. The gap must be closed before the system can be upgraded to autonomous tier."
                                  : "No remediation required. Continue monitoring in future runs."}
                              </p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function formatBackendControlStatus(status: string) {
  return {
    passed: "Pass",
    failed: "Fail",
    needs_review: "Partial",
    not_evaluated: "Not evaluated",
  }[status] ?? status;
}
