/**
 * Compliance report builder + exporters.
 *
 * Everything here is DYNAMIC: the report is assembled from whatever live
 * backend data is available for the currently-selected run (GovernanceReport +
 * FrameworkComplianceMap). No system name, clause, or finding is hard-coded —
 * a different registered system produces its own report. When the backend is
 * unavailable the caller passes `null` and we fall back to the local prototype
 * data so the buttons still produce a coherent file.
 */

import type {
  AuditLedgerEntry,
  FrameworkComplianceMap,
  FrameworkControlAssessment,
  GovernanceReport,
} from "@/api/governanceApi";
import { complianceRows } from "@/data/mockData";

/* ────────────────────────────────────────── Structured report model ── */

export type ReportControl = {
  framework: string;
  frameworkVersion: string | null;
  ref: string;
  title: string | null;
  category: string | null;
  jurisdiction: string | null;
  status: string;
  passedMetrics: number;
  failedMetrics: number;
  pendingMetrics: number;
  findingCount: number;
  evidenceRequirements: string[];
};

export type ReportFramework = {
  name: string;
  version: string | null;
  passing: number;
  partial: number;
  failing: number;
  notEvaluated: number;
  controls: ReportControl[];
};

export type ReportFinding = {
  id: string;
  title: string;
  summary: string;
  severity: string;
  dimension: string;
  confidence: number;
  status: string;
  agent: string | null;
  frameworkRefs: string[];
  recommendedAction: string | null;
};

export type ReportAgent = {
  name: string;
  status: string;
  findingCount: number;
};

export type ReportMetricRollup = {
  total: number;
  passed: number;
  failed: number;
  pending: number;
};

export type ComplianceReport = {
  meta: {
    title: string;
    generatedAt: string;
    source: "backend" | "prototype";
  };
  system: {
    id: string | null;
    name: string;
    owner: string | null;
    description: string | null;
    systemType: string | null;
    riskTier: string | null;
    deploymentEnvironment: string | null;
    modelProvider: string | null;
    modelName: string | null;
    selectedFrameworks: string[];
  };
  run: {
    id: string | null;
    status: string | null;
    currentPhase: string | null;
    startedAt: string | null;
    completedAt: string | null;
  };
  summary: {
    totalControls: number;
    passing: number;
    partial: number;
    failing: number;
    notEvaluated: number;
    compliancePercent: number | null;
    findingCount: number;
    verdictLabel: string | null;
    verdictTier: string | null;
    verdictConfidence: number | null;
    verdictSynthesis: string | null;
    stateChainValid: boolean | null;
    stateChainEntries: number | null;
  };
  frameworks: ReportFramework[];
  findings: ReportFinding[];
  metrics: ReportMetricRollup;
  agents: ReportAgent[];
};

const STATUS_LABELS: Record<string, string> = {
  passed: "Pass",
  failed: "Fail",
  needs_review: "Partial",
  not_evaluated: "Not evaluated",
};

function labelForControlStatus(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/* ─────────────────────────────────────────────── Report assembly ── */

/**
 * Build the structured report from live backend data. Pass the GovernanceReport
 * and FrameworkComplianceMap for the selected run. When both are null we emit
 * the prototype report so the export buttons always produce something valid.
 */
export function buildComplianceReport(
  report: GovernanceReport | null,
  frameworkMap: FrameworkComplianceMap | null,
): ComplianceReport {
  if (!report) {
    return buildPrototypeReport();
  }

  const system = report.ai_system;
  const run = report.run;
  const verdict = report.verdict ?? null;

  const frameworks = groupControlsByFramework(frameworkMap?.controls ?? []);
  const rollup = frameworks.reduce(
    (acc, fw) => {
      acc.passing += fw.passing;
      acc.partial += fw.partial;
      acc.failing += fw.failing;
      acc.notEvaluated += fw.notEvaluated;
      return acc;
    },
    { passing: 0, partial: 0, failing: 0, notEvaluated: 0 },
  );
  const totalControls =
    frameworkMap?.control_count ??
    rollup.passing + rollup.partial + rollup.failing + rollup.notEvaluated;
  const evaluated = rollup.passing + rollup.partial + rollup.failing;
  const compliancePercent =
    evaluated > 0 ? Math.round((rollup.passing / evaluated) * 100) : null;

  const metrics = rollupMetrics(report);

  return {
    meta: {
      title: `AI Governance Compliance Report — ${system.name}`,
      generatedAt: new Date().toISOString(),
      source: "backend",
    },
    system: {
      id: system.id,
      name: system.name,
      owner: system.owner ?? null,
      description: system.description ?? null,
      systemType: system.system_type ?? null,
      riskTier: system.risk_tier ?? null,
      deploymentEnvironment: system.deployment_environment ?? null,
      modelProvider: system.model_provider ?? null,
      modelName: system.model_name ?? null,
      selectedFrameworks: system.selected_frameworks ?? run.selected_frameworks ?? [],
    },
    run: {
      id: run.id,
      status: run.status ?? null,
      currentPhase: run.current_phase ?? null,
      startedAt: run.started_at ?? null,
      completedAt: run.completed_at ?? null,
    },
    summary: {
      totalControls,
      passing: rollup.passing,
      partial: rollup.partial,
      failing: rollup.failing,
      notEvaluated: rollup.notEvaluated,
      compliancePercent,
      findingCount: report.findings?.length ?? report.counts?.findings ?? 0,
      verdictLabel: verdict?.label ?? null,
      verdictTier: verdict?.action_tier ?? null,
      verdictConfidence:
        verdict?.confidence_score != null
          ? Math.round(verdict.confidence_score * 100)
          : null,
      verdictSynthesis: verdict?.synthesis ?? verdict?.reasoning ?? null,
      stateChainValid: report.state_chain?.valid ?? null,
      stateChainEntries: report.state_chain?.entry_count ?? null,
    },
    frameworks,
    findings: (report.findings ?? []).map((f) => ({
      id: f.id,
      title: f.title,
      summary: f.summary,
      severity: f.severity,
      dimension: f.dimension,
      confidence: Math.round((f.confidence ?? 0) * 100),
      status: f.status,
      agent: f.agent_name ?? null,
      frameworkRefs: f.framework_refs ?? [],
      recommendedAction: f.recommended_action ?? null,
    })),
    metrics,
    agents: (report.agent_executions ?? []).map((a) => ({
      name: a.agent_name,
      status: a.status,
      findingCount: a.finding_count,
    })),
  };
}

function groupControlsByFramework(
  controls: FrameworkControlAssessment[],
): ReportFramework[] {
  const byName = new Map<string, ReportFramework>();

  for (const control of controls) {
    const name = control.framework_name;
    let fw = byName.get(name);
    if (!fw) {
      fw = {
        name,
        version: control.framework_version ?? null,
        passing: 0,
        partial: 0,
        failing: 0,
        notEvaluated: 0,
        controls: [],
      };
      byName.set(name, fw);
    }

    if (control.status === "passed") fw.passing += 1;
    else if (control.status === "needs_review") fw.partial += 1;
    else if (control.status === "failed") fw.failing += 1;
    else fw.notEvaluated += 1;

    fw.controls.push({
      framework: name,
      frameworkVersion: control.framework_version ?? null,
      ref: control.control_ref,
      title: control.control_title ?? null,
      category: control.control_category ?? null,
      jurisdiction: control.jurisdiction ?? null,
      status: labelForControlStatus(control.status),
      passedMetrics: control.passed_metric_count,
      failedMetrics: control.failed_metric_count,
      pendingMetrics: control.pending_metric_count,
      findingCount: control.finding_count,
      evidenceRequirements: control.evidence_requirements ?? [],
    });
  }

  return [...byName.values()];
}

function rollupMetrics(report: GovernanceReport): ReportMetricRollup {
  const results = report.metric_results ?? [];
  let passed = 0;
  let failed = 0;
  let pending = 0;
  for (const r of results) {
    if (r.passed === true) passed += 1;
    else if (r.passed === false) failed += 1;
    else pending += 1;
  }
  return { total: results.length, passed, failed, pending };
}

/* ───────────────────────────────────── Prototype (offline) report ── */

function buildPrototypeReport(): ComplianceReport {
  const controls: ReportControl[] = complianceRows.map((row) => ({
    framework: "EU AI Act",
    frameworkVersion: "2024",
    ref: row.clause,
    title: null,
    category: null,
    jurisdiction: "EU",
    status: row.status,
    passedMetrics: row.status === "Pass" ? 1 : 0,
    failedMetrics: row.status === "Fail" ? 1 : 0,
    pendingMetrics: row.status === "Partial" ? 1 : 0,
    findingCount: row.status === "Fail" ? 1 : 0,
    evidenceRequirements: [row.evidence],
  }));

  const passing = controls.filter((c) => c.status === "Pass").length;
  const partial = controls.filter((c) => c.status === "Partial").length;
  const failing = controls.filter((c) => c.status === "Fail").length;
  const evaluated = passing + partial + failing;

  return {
    meta: {
      title: "AI Governance Compliance Report — TechVest RAG Chatbot",
      generatedAt: new Date().toISOString(),
      source: "prototype",
    },
    system: {
      id: null,
      name: "TechVest RAG Chatbot",
      owner: "Risk & Compliance",
      description: "Prototype data — backend unavailable or no evaluation runs found.",
      systemType: "rag_chatbot",
      riskTier: "high",
      deploymentEnvironment: "production",
      modelProvider: "azure_openai",
      modelName: "gpt-4o",
      selectedFrameworks: ["EU AI Act", "NIST AI RMF", "ISO 42001", "OWASP LLM Top 10"],
    },
    run: {
      id: "run-techvest-chatbot-demo",
      status: "prototype",
      currentPhase: "mock data",
      startedAt: null,
      completedAt: null,
    },
    summary: {
      totalControls: controls.length,
      passing,
      partial,
      failing,
      notEvaluated: 0,
      compliancePercent: evaluated > 0 ? Math.round((passing / evaluated) * 100) : null,
      findingCount: failing,
      verdictLabel: "Supervised Operation",
      verdictTier: "supervised",
      verdictConfidence: 75,
      verdictSynthesis:
        "Prototype verdict. Connect the backend and run a governance evaluation to generate a live verdict.",
      stateChainValid: true,
      stateChainEntries: 0,
    },
    frameworks: [
      {
        name: "EU AI Act",
        version: "2024",
        passing,
        partial,
        failing,
        notEvaluated: 0,
        controls,
      },
    ],
    findings: complianceRows
      .filter((r) => r.status !== "Pass")
      .map((r, i) => ({
        id: `proto-${i + 1}`,
        title: r.clause,
        summary: r.evidence,
        severity: r.status === "Fail" ? "high" : "medium",
        dimension: "compliance",
        confidence: 0,
        status: "open",
        agent: "Compliance Mapper",
        frameworkRefs: ["EU AI Act"],
        recommendedAction:
          r.status === "Fail"
            ? "Add to remediation queue and assign an owner before the next review."
            : "Close the identified gap before upgrading the system's autonomy tier.",
      })),
    metrics: { total: controls.length, passed: passing, failed: failing, pending: partial },
    agents: [],
  };
}

/* ─────────────────────────────────────────────────── Serializers ── */

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60) || "system";
}

/** Base filename (no extension), unique per system + date. */
export function reportFileBase(report: ComplianceReport): string {
  const date = report.meta.generatedAt.split("T")[0];
  return `compliance-report-${slugify(report.system.name)}-${date}`;
}

function downloadBlob(content: BlobPart, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Hash-chained audit ledger for the selected run — real entries, no mock. */
export function exportAuditLedgerJSON(
  entries: AuditLedgerEntry[],
  report: ComplianceReport,
) {
  const data = {
    exportedAt: new Date().toISOString(),
    system: report.system.name,
    runId: report.run.id,
    entryCount: entries.length,
    chainValid: report.summary.stateChainValid,
    entries: entries.map((e) => ({
      id: e.id,
      eventType: e.event_type,
      actorType: e.actor_type,
      actorId: e.actor_id ?? null,
      entryHash: e.entry_hash,
      previousHash: e.previous_hash ?? null,
      createdAt: e.created_at,
      payload: e.payload,
    })),
  };
  downloadBlob(
    JSON.stringify(data, null, 2),
    `audit-ledger-${slugify(report.system.name)}-${report.meta.generatedAt.split("T")[0]}.json`,
    "application/json",
  );
}

/** Evidence bundle for the selected run: findings + evidence + verdict, live. */
export function exportEvidenceBundleJSON(
  raw: GovernanceReport | null,
  report: ComplianceReport,
) {
  const bundle = {
    exportedAt: new Date().toISOString(),
    system: report.system.name,
    runId: report.run.id,
    stateChain: raw?.state_chain ?? null,
    verdict: raw?.verdict ?? null,
    counts: raw?.counts ?? {},
    findings: raw?.findings ?? [],
    metricResults: raw?.metric_results ?? [],
    evidence: raw?.evidence ?? [],
    agentExecutions: raw?.agent_executions ?? [],
  };
  downloadBlob(
    JSON.stringify(bundle, null, 2),
    `evidence-bundle-${slugify(report.system.name)}-${report.meta.generatedAt.split("T")[0]}.json`,
    "application/json",
  );
}

/** Full structured report as JSON. */
export function exportReportJSON(report: ComplianceReport) {
  downloadBlob(
    JSON.stringify(report, null, 2),
    `${reportFileBase(report)}.json`,
    "application/json",
  );
}

function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * CSV export — one row per control across every framework, plus a leading
 * metadata block so the file is self-describing when opened in a spreadsheet.
 */
export function exportReportCSV(report: ComplianceReport) {
  const lines: string[] = [];

  // Self-describing header block.
  lines.push(["# Report", report.meta.title].map(csvCell).join(","));
  lines.push(["# System", report.system.name].map(csvCell).join(","));
  lines.push(["# Run", report.run.id ?? ""].map(csvCell).join(","));
  lines.push(["# Generated", report.meta.generatedAt].map(csvCell).join(","));
  lines.push(
    ["# Verdict", `${report.summary.verdictLabel ?? "—"} (${report.summary.verdictTier ?? "—"})`]
      .map(csvCell)
      .join(","),
  );
  lines.push(
    ["# Compliance", report.summary.compliancePercent != null ? `${report.summary.compliancePercent}%` : "—"]
      .map(csvCell)
      .join(","),
  );
  lines.push("");

  // Control table.
  const headers = [
    "Framework",
    "Version",
    "Control Ref",
    "Control Title",
    "Category",
    "Jurisdiction",
    "Status",
    "Passed Metrics",
    "Failed Metrics",
    "Pending Metrics",
    "Findings",
    "Evidence Requirements",
  ];
  lines.push(headers.map(csvCell).join(","));

  for (const fw of report.frameworks) {
    for (const c of fw.controls) {
      lines.push(
        [
          c.framework,
          c.frameworkVersion ?? "",
          c.ref,
          c.title ?? "",
          c.category ?? "",
          c.jurisdiction ?? "",
          c.status,
          c.passedMetrics,
          c.failedMetrics,
          c.pendingMetrics,
          c.findingCount,
          c.evidenceRequirements.join(" | "),
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }

  // Prepend a BOM so Excel reads UTF-8 correctly.
  downloadBlob("﻿" + lines.join("\r\n"), `${reportFileBase(report)}.csv`, "text/csv;charset=utf-8");
}

/* ──────────────────────────────────────────────────── PDF (print) ── */

function esc(value: unknown): string {
  const s = value == null ? "" : String(value);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (s.startsWith("pass") || s === "aligned") return "#059669";
  if (s.startsWith("partial") || s === "needs_review") return "#d97706";
  if (s.startsWith("fail") || s === "not aligned") return "#dc2626";
  return "#64748b";
}

function severityColor(sev: string): string {
  const s = sev.toLowerCase();
  if (s === "critical") return "#dc2626";
  if (s === "high") return "#ea580c";
  if (s === "medium") return "#d97706";
  if (s === "low") return "#0891b2";
  return "#64748b";
}

/**
 * Renders the structured report to a print-ready HTML document in a new window
 * and invokes the browser print dialog (Save as PDF). This keeps the app free of
 * a heavy PDF dependency while still producing a real, shareable PDF.
 */
export function exportReportPDF(report: ComplianceReport) {
  const s = report.system;
  const sum = report.summary;
  const generatedDate = report.meta.generatedAt.split("T")[0];

  const systemRows = [
    ["System", s.name],
    ["System ID", s.id ?? "—"],
    ["Owner", s.owner ?? "—"],
    ["System Type", s.systemType ?? "—"],
    ["Risk Tier", s.riskTier ?? "—"],
    ["Deployment", s.deploymentEnvironment ?? "—"],
    ["Model", [s.modelProvider, s.modelName].filter(Boolean).join(" / ") || "—"],
    ["Frameworks", s.selectedFrameworks.join(", ") || "—"],
  ]
    .map(
      ([k, v]) =>
        `<tr><th style="width:180px">${esc(k)}</th><td>${esc(v)}</td></tr>`,
    )
    .join("");

  const runRows = [
    ["Run ID", report.run.id ?? "—"],
    ["Status", report.run.status ?? "—"],
    ["Phase", report.run.currentPhase ?? "—"],
    ["Started", report.run.startedAt ?? "—"],
    ["Completed", report.run.completedAt ?? "—"],
    ["State chain", sum.stateChainValid == null ? "—" : sum.stateChainValid ? `Verified (${sum.stateChainEntries} entries)` : "INVALID"],
  ]
    .map(([k, v]) => `<tr><th style="width:180px">${esc(k)}</th><td>${esc(v)}</td></tr>`)
    .join("");

  const frameworkSections = report.frameworks
    .map((fw) => {
      const rows = fw.controls
        .map(
          (c) => `<tr>
            <td>${esc(c.ref)}${c.title ? `<div class="muted">${esc(c.title)}</div>` : ""}</td>
            <td><span class="pill" style="background:${statusColor(c.status)}">${esc(c.status)}</span></td>
            <td class="nums">${c.passedMetrics} / ${c.failedMetrics} / ${c.pendingMetrics}</td>
            <td class="nums">${c.findingCount}</td>
            <td>${esc(c.evidenceRequirements.join("; ") || "—")}</td>
          </tr>`,
        )
        .join("");
      return `<h3>${esc(fw.name)}${fw.version ? ` <span class="muted">v${esc(fw.version)}</span>` : ""}</h3>
        <p class="muted">${fw.passing} passing · ${fw.partial} partial · ${fw.failing} failing${fw.notEvaluated ? ` · ${fw.notEvaluated} not evaluated` : ""}</p>
        <table>
          <thead><tr><th>Control</th><th>Status</th><th>Metrics P/F/Pend</th><th>Findings</th><th>Evidence Requirements</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="5" class="muted">No controls assessed.</td></tr>`}</tbody>
        </table>`;
    })
    .join("");

  const findingsHtml = report.findings.length
    ? report.findings
        .map(
          (f) => `<div class="finding" style="border-color:${severityColor(f.severity)}">
            <strong>${esc(f.title)}</strong>
            <span class="pill" style="background:${severityColor(f.severity)}">${esc(f.severity)}</span>
            <div class="muted">${esc(f.agent ?? "—")} · ${esc(f.dimension)} · ${esc(f.frameworkRefs.join(", "))} · confidence ${f.confidence}%</div>
            <div>${esc(f.summary)}</div>
            ${f.recommendedAction ? `<div class="rec"><strong>Recommended:</strong> ${esc(f.recommendedAction)}</div>` : ""}
          </div>`,
        )
        .join("")
    : `<p class="muted">No findings recorded for this run.</p>`;

  const agentRows = report.agents.length
    ? report.agents
        .map(
          (a) =>
            `<tr><td>${esc(a.name)}</td><td>${esc(a.status)}</td><td class="nums">${a.findingCount}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="3" class="muted">No agent executions recorded.</td></tr>`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(report.meta.title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 860px; margin: 0 auto; padding: 40px; color: #1e293b; font-size: 13px; line-height: 1.5; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 28px 0 10px; padding-bottom: 6px; border-bottom: 2px solid #e2e8f0; color: #0f172a; }
  h3 { font-size: 14px; margin: 18px 0 4px; color: #334155; }
  .muted { color: #64748b; font-size: 12px; }
  .sub { color: #64748b; font-size: 12px; margin: 0 0 20px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; font-size: 12px; }
  th, td { border: 1px solid #e2e8f0; padding: 6px 10px; text-align: left; vertical-align: top; }
  thead th { background: #f8fafc; font-weight: 600; }
  td.nums { text-align: center; white-space: nowrap; }
  .kv th { background: #f8fafc; }
  .cards { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 4px; }
  .card { flex: 1; min-width: 120px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; }
  .card .n { font-size: 24px; font-weight: 700; }
  .card .l { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #64748b; }
  .pill { display: inline-block; color: #fff; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
  .finding { border-left: 4px solid #dc2626; padding: 8px 12px; margin: 8px 0; background: #f8fafc; border-radius: 0 6px 6px 0; }
  .finding .rec { margin-top: 4px; color: #334155; }
  .verdict { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px 16px; margin: 8px 0; }
  .footer { margin-top: 36px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8; }
  @media print { body { padding: 16px; } h2 { page-break-after: avoid; } table, .finding, .verdict { page-break-inside: avoid; } }
</style></head><body>

<h1>${esc(report.meta.title)}</h1>
<p class="sub">Generated ${esc(generatedDate)} · Source: ${esc(report.meta.source)} · Run ${esc(report.run.id ?? "—")}</p>

<h2>Executive Summary</h2>
<div class="verdict">
  <strong>Verdict:</strong> ${esc(sum.verdictLabel ?? "Pending")} ${sum.verdictTier ? `<span class="pill" style="background:#2563eb">${esc(sum.verdictTier)}</span>` : ""}
  ${sum.verdictConfidence != null ? ` · Confidence ${sum.verdictConfidence}%` : ""}
  ${sum.verdictSynthesis ? `<div class="muted" style="margin-top:6px">${esc(sum.verdictSynthesis)}</div>` : ""}
</div>
<div class="cards">
  <div class="card"><div class="n" style="color:#059669">${sum.passing}</div><div class="l">Passing</div></div>
  <div class="card"><div class="n" style="color:#d97706">${sum.partial}</div><div class="l">Partial</div></div>
  <div class="card"><div class="n" style="color:#dc2626">${sum.failing}</div><div class="l">Failing</div></div>
  <div class="card"><div class="n">${sum.totalControls}</div><div class="l">Controls</div></div>
  <div class="card"><div class="n">${sum.compliancePercent != null ? sum.compliancePercent + "%" : "—"}</div><div class="l">Compliance</div></div>
  <div class="card"><div class="n">${sum.findingCount}</div><div class="l">Findings</div></div>
</div>

<h2>System Profile</h2>
<table class="kv">${systemRows}</table>
${s.description ? `<p class="muted">${esc(s.description)}</p>` : ""}

<h2>Run Metadata</h2>
<table class="kv">${runRows}</table>

<h2>Compliance by Framework</h2>
${frameworkSections || `<p class="muted">No framework controls were assessed for this run.</p>`}

<h2>Findings (${report.findings.length})</h2>
${findingsHtml}

<h2>Metric Results</h2>
<div class="cards">
  <div class="card"><div class="n">${report.metrics.total}</div><div class="l">Total</div></div>
  <div class="card"><div class="n" style="color:#059669">${report.metrics.passed}</div><div class="l">Passed</div></div>
  <div class="card"><div class="n" style="color:#dc2626">${report.metrics.failed}</div><div class="l">Failed</div></div>
  <div class="card"><div class="n" style="color:#d97706">${report.metrics.pending}</div><div class="l">Pending</div></div>
</div>

<h2>Agent Executions</h2>
<table><thead><tr><th>Agent</th><th>Status</th><th>Findings</th></tr></thead><tbody>${agentRows}</tbody></table>

<div class="footer">Generated by the AI Governance Engine · ${esc(report.system.name)} · ${esc(report.meta.generatedAt)}</div>

<script>
  window.addEventListener("load", function () {
    setTimeout(function () { window.focus(); window.print(); }, 300);
  });
</script>
</body></html>`;

  const win = window.open("", "_blank");
  if (win) {
    win.document.write(html);
    win.document.close();
  } else {
    // Popup blocked — fall back to a downloadable HTML file the user can print.
    downloadBlob(html, `${reportFileBase(report)}.html`, "text/html");
  }
}
