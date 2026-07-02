import { Fragment, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Download, FileText, FlaskConical, Info, Loader2 } from "lucide-react";
import clsx from "clsx";
import { Badge, toneForStatus } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { useAppStore } from "@/store/useAppStore";
import { useActiveRun } from "@/hooks/useActiveRun";
import { useGovernanceBackend } from "@/hooks/useGovernanceBackend";
import { exportComplianceCSV, exportComplianceJSON, exportCompliancePDF } from "@/utils/complianceExport";

type Framework = string;
type ReportRow = {
  clause: string;
  status: string;
  evidence: string;
  principle?: string;
};

const clauseDetail: Record<string, string> = {
  "Art.52 Transparency": "Requires that users are informed they are interacting with an AI system. All decisioning explanations must be disclosed in customer-facing communication.",
  "Annex III Risk Classification": "Systems used to assess individuals fall under EU AI Act Annex III as high-risk AI. This determines the full conformity assessment requirement.",
  "Art.10(2)(f) Data Governance": "Requires that training data is examined for possible biases, including those that could lead to prohibited discrimination on protected attributes.",
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

const frameworkContext: Record<Framework, string> = {
  "EU AI Act": "Regulatory clause-level compliance posture for high-risk AI obligations.",
  "NIST AI RMF": "Risk management posture across govern, map, measure, and manage functions.",
  "ISO 42001": "AI management system posture across policy, risk assessment, data governance, monitoring, and continual improvement.",
  "OWASP LLM Top 10": "LLM application security posture across prompt injection, disclosure, poisoned context, and misinformation risks.",
};

function EmptyState({ title, body, cta, navigateTo }: { title: string; body: string; cta?: { label: string; path: string }; navigateTo: (p: string) => void }) {
  return (
    <Card className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
        <FileText className="h-6 w-6 text-slate-400 dark:text-slate-500" />
      </div>
      <p className="text-[15px] font-semibold text-slate-900 dark:text-white">{title}</p>
      <p className="max-w-md text-[13px] leading-5 text-slate-500 dark:text-slate-400">{body}</p>
      {cta && (
        <button
          onClick={() => navigateTo(cta.path)}
          className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-brand-700"
        >
          {cta.label}
        </button>
      )}
    </Card>
  );
}

export function Reports() {
  const navigateTo = useAppStore((s) => s.navigateTo);
  const backend = useGovernanceBackend();
  const { runs, systemNameById, loading: activeLoading, error: activeError } = useActiveRun();
  const [activeFramework, setActiveFramework] = useState<Framework>("EU AI Act");
  const [expandedClause, setExpandedClause] = useState<string | null>(null);

  const backendRowsByFramework = useMemo(() => {
    if (!backend.frameworkMap?.controls.length) return {} as Record<string, ReportRow[]>;

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

  const hasSystems = systemNameById.size > 0;
  const hasRuns = runs.length > 0;
  const hasBackendRows = Object.keys(backendRowsByFramework).length > 0;
  // A compliance report exists only when a real run's framework map produced
  // control assessments — no report object without run_id + ai_system_id.
  const report = backend.report;
  const hasReport = Boolean(report) && hasBackendRows;
  const loading = backend.loading || activeLoading;

  // Mock/dev detection: the report's run was executed with the mock evaluator.
  const summary = (report?.run.result_summary ?? {}) as Record<string, unknown>;
  const isMockRun = summary.mock_execution === true || summary.evaluator_name === "mock";

  const tabOptions = Object.keys(backendRowsByFramework);
  const resolvedFramework = tabOptions.includes(activeFramework) ? activeFramework : tabOptions[0];
  const rows = (resolvedFramework ? backendRowsByFramework[resolvedFramework] : undefined) ?? [];
  const isOecd = resolvedFramework === "OECD AI Principles";
  const passCount = rows.filter((r) => r.status === "Pass" || r.status === "Aligned").length;
  const failCount = rows.filter((r) => r.status === "Fail" || r.status === "Not aligned").length;
  const partialCount = rows.filter((r) => r.status === "Partial" || r.status === "Partially aligned").length;
  const summaryCopy = isOecd
    ? { pass: "Aligned", passHint: "indicators demonstrably met", partial: "Partially aligned", partialHint: "indicators with defined gaps", fail: "Not aligned", failHint: "indicators requiring escalation" }
    : { pass: "Passing", passHint: "clauses fully satisfied", partial: "Partial", partialHint: "clauses partially satisfied", fail: "Failing", failHint: "clauses not satisfied" };

  function handleExport(format: "PDF" | "JSON" | "CSV") {
    if (!report || !hasReport) return;
    if (format === "JSON") exportComplianceJSON(report, backendRowsByFramework, isMockRun);
    else if (format === "CSV") exportComplianceCSV(report, backendRowsByFramework, isMockRun);
    else exportCompliancePDF(report, backendRowsByFramework, isMockRun);
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-700 dark:text-blue-400">Compliance Reports</p>
          <h1 className="mt-1 flex items-center gap-2 text-[20px] font-semibold tracking-tight text-slate-950 dark:text-white">
            <FileText className="h-5 w-5 text-slate-400" />
            Framework compliance
          </h1>
          <p className="mt-1 max-w-3xl text-[13px] leading-5 text-slate-600 dark:text-slate-400">
            Clause-level compliance posture mapped from a real governance run. Select a framework and expand any row for its evidence and clause definition.
          </p>
        </div>
        {/* Exports are disabled until a real compliance report exists. */}
        <div className="flex shrink-0 gap-2">
          {(["PDF", "JSON", "CSV"] as const).map((format) => (
            <button
              key={format}
              disabled={!hasReport}
              onClick={() => handleExport(format)}
              title={hasReport ? `Export this compliance report as ${format}` : "Available once a compliance report is generated"}
              className={clsx(
                "flex items-center gap-1.5 rounded border px-3 py-2 text-[12px] font-medium transition-colors",
                hasReport
                  ? "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:border-slate-400 dark:hover:border-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700"
                  : "cursor-not-allowed border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-slate-400 dark:text-slate-600",
              )}
            >
              <Download className="h-4 w-4" /> {format}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <Card className="flex items-center gap-2 px-5 py-12 text-[13px] text-slate-500 dark:text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading compliance report…
        </Card>
      ) : activeError ? (
        <Card className="m-0 flex items-start gap-2 px-4 py-3 text-[12px] text-red-700 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Could not load compliance data.</p>
            <p className="mt-0.5 break-all">{activeError}</p>
          </div>
        </Card>
      ) : !hasSystems ? (
        <EmptyState
          navigateTo={navigateTo}
          title="No AI system registered"
          body="No AI system registered. Register an AI system before generating compliance reports."
          cta={{ label: "Register an AI system", path: "/systems" }}
        />
      ) : !hasRuns ? (
        <EmptyState
          navigateTo={navigateTo}
          title="No governance runs yet"
          body="No governance runs yet. Start a governance run to generate compliance reports."
          cta={{ label: "Go to AI Systems", path: "/systems" }}
        />
      ) : !hasReport ? (
        <EmptyState
          navigateTo={navigateTo}
          title="No compliance report generated yet"
          body="The selected run has not produced a compliance report. Framework control assessments appear here once the run maps findings and metrics to framework clauses."
          cta={{ label: "Open Live Run", path: "/runs" }}
        />
      ) : (
        <>
          {/* Connection + counts — real report only */}
          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-700 dark:text-blue-400">Backend Report Connection</p>
                <p className="mt-1 text-[13px] text-slate-700 dark:text-slate-300">
                  Loaded run {report!.run.id.slice(0, 8)} for <span className="font-semibold text-slate-950 dark:text-white">{report!.ai_system.name}</span>.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge tone={report!.state_chain.valid ? "green" : "red"}>State {report!.state_chain.valid ? "Verified" : "Invalid"}</Badge>
                <Badge tone="blue">{report!.counts.metric_results ?? 0} metric results</Badge>
                <Badge tone="amber">{report!.counts.findings ?? 0} findings</Badge>
              </div>
            </div>
          </Card>

          {isMockRun && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-[12px] text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <span className="font-semibold">Mock/dev data.</span> This report was produced by a run using the mock metric evaluator, not a real tool backend. Run the pipeline with the real evaluator for a production compliance report.
              </span>
            </div>
          )}

          <p className="text-[12px] leading-5 text-slate-500 dark:text-slate-400">
            {frameworkContext[resolvedFramework] ?? "Framework-level control posture generated from this governance run."}
          </p>

          {/* Summary metrics */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">{summaryCopy.pass}</p>
              <p className="mt-1 text-[28px] font-bold text-emerald-800 dark:text-emerald-300">{passCount}</p>
              <p className="text-[11px] text-emerald-700 dark:text-emerald-400">{summaryCopy.passHint}</p>
            </div>
            <div className="rounded border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">{summaryCopy.partial}</p>
              <p className="mt-1 text-[28px] font-bold text-amber-800 dark:text-amber-300">{partialCount}</p>
              <p className="text-[11px] text-amber-700 dark:text-amber-400">{summaryCopy.partialHint}</p>
            </div>
            <div className="rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">{summaryCopy.fail}</p>
              <p className="mt-1 text-[28px] font-bold text-red-800 dark:text-red-300">{failCount}</p>
              <p className="text-[11px] text-red-700 dark:text-red-400">{summaryCopy.failHint}</p>
            </div>
          </div>

          {/* Framework selector + table */}
          <Card>
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-4 py-0">
              <div className="flex gap-1 pt-2">
                {tabOptions.map((fw) => (
                  <button
                    key={fw}
                    onClick={() => { setActiveFramework(fw); setExpandedClause(null); }}
                    className={clsx(
                      "rounded-t border border-b-0 px-3 py-2 text-[12px] font-medium transition-colors",
                      resolvedFramework === fw
                        ? "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-950 dark:text-white"
                        : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                    )}
                  >
                    {fw}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5 pb-1 text-[11px] text-slate-400 dark:text-slate-500">
                <FileText className="h-3.5 w-3.5" />
                {report!.ai_system.name} · {report!.run.current_phase}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead className="bg-slate-50 dark:bg-slate-800">
                  <tr className="border-b border-slate-200 dark:border-slate-700">
                    <th className="w-6 px-4 py-3" />
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600 dark:text-slate-300">{resolvedFramework} {isOecd ? "Indicator" : "Clause"}</th>
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600 dark:text-slate-300">Status</th>
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600 dark:text-slate-300">Evidence Summary</th>
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
                            "group cursor-pointer border-t border-slate-100 dark:border-slate-700/50 transition-colors",
                            isExpanded ? "bg-blue-50 dark:bg-blue-950/30" : "hover:bg-slate-50 dark:hover:bg-slate-800"
                          )}
                        >
                          <td className="px-4 py-3 text-slate-400 dark:text-slate-500">
                            {isExpanded
                              ? <ChevronDown className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                              : <ChevronRight className="h-3.5 w-3.5 group-hover:text-slate-700 dark:group-hover:text-slate-300" />}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-start gap-1.5">
                              <div>
                                <p className="text-[13px] font-medium text-slate-950 dark:text-white">{row.clause}</p>
                                {row.principle && <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">{row.principle}</p>}
                              </div>
                              {detail && <Info className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" />}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <Badge tone={toneForStatus(row.status)}>{row.status}</Badge>
                          </td>
                          <td className="px-4 py-3 text-[12px] text-slate-700 dark:text-slate-300">{row.evidence}</td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${row.clause}-expanded`} className="border-t border-blue-100 dark:border-blue-900/50 bg-blue-50/60 dark:bg-blue-950/20">
                            <td />
                            <td colSpan={3} className="px-4 py-3">
                              <div className="space-y-3">
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Full Evidence</p>
                                  <p className="mt-1 text-[12px] leading-5 text-slate-700 dark:text-slate-300">{row.evidence}</p>
                                </div>
                                {row.principle && (
                                  <div>
                                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Category</p>
                                    <p className="mt-1 text-[12px] leading-5 text-slate-700 dark:text-slate-300">{row.principle}</p>
                                  </div>
                                )}
                                {detail && (
                                  <div className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
                                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Clause Definition</p>
                                    <p className="mt-1 text-[12px] leading-5 text-slate-700 dark:text-slate-300">{detail}</p>
                                  </div>
                                )}
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Remediation</p>
                                  <p className="mt-1 text-[12px] text-slate-700 dark:text-slate-300">
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
        </>
      )}
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
