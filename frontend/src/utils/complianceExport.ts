// Real compliance-report exports (JSON / CSV / print-to-PDF). Everything here is
// derived from the loaded backend GovernanceReport + framework control map for a
// specific run — no mock/demo data. Mock-evaluator runs are labelled as such.
import type { GovernanceReport } from "@/api/governanceApi";

export type ComplianceRow = { clause: string; status: string; evidence: string; principle?: string };
export type RowsByFramework = Record<string, ComplianceRow[]>;

function downloadBlob(content: string, filename: string, type: string) {
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

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "system";
}

function baseName(report: GovernanceReport): string {
  return `compliance-${slug(report.ai_system.name)}-${report.run.id.slice(0, 8)}`;
}

function flatten(rowsByFramework: RowsByFramework): Array<ComplianceRow & { framework: string }> {
  const out: Array<ComplianceRow & { framework: string }> = [];
  for (const [framework, rows] of Object.entries(rowsByFramework)) {
    for (const r of rows) out.push({ framework, ...r });
  }
  return out;
}

export function exportComplianceJSON(report: GovernanceReport, rowsByFramework: RowsByFramework, isMock: boolean) {
  const data = {
    generated_at: new Date().toISOString(),
    mock_dev_data: isMock,
    run: {
      id: report.run.id,
      status: report.run.status,
      current_phase: report.run.current_phase,
      state_chain_valid: report.state_chain.valid,
    },
    ai_system: { id: report.ai_system.id, name: report.ai_system.name },
    counts: report.counts,
    selected_frameworks: report.run.selected_frameworks,
    controls: flatten(rowsByFramework).map((r) => ({
      framework: r.framework,
      clause: r.clause,
      status: r.status,
      category: r.principle ?? null,
      evidence: r.evidence,
    })),
  };
  downloadBlob(JSON.stringify(data, null, 2), `${baseName(report)}.json`, "application/json");
}

export function exportComplianceCSV(report: GovernanceReport, rowsByFramework: RowsByFramework, isMock: boolean) {
  const esc = (cell: string) => `"${String(cell).replace(/"/g, '""')}"`;
  const meta = [
    ["AI System", report.ai_system.name],
    ["Run ID", report.run.id],
    ["State chain", report.state_chain.valid ? "Verified" : "Invalid"],
    ["Data source", isMock ? "MOCK / DEV" : "Backend run"],
    ["Generated", new Date().toISOString()],
  ];
  const headers = ["Framework", "Clause", "Status", "Category", "Evidence"];
  const rows = flatten(rowsByFramework).map((r) => [r.framework, r.clause, r.status, r.principle ?? "", r.evidence]);
  const csv = [
    ...meta.map((m) => m.map(esc).join(",")),
    "",
    [headers, ...rows].map((row) => row.map(esc).join(",")).join("\r\n"),
  ].join("\r\n");
  downloadBlob(csv, `${baseName(report)}.csv`, "text/csv");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function exportCompliancePDF(report: GovernanceReport, rowsByFramework: RowsByFramework, isMock: boolean) {
  const win = window.open("", "_blank");
  if (!win) return; // popup blocked

  const date = new Date().toISOString().split("T")[0];
  const frameworks = report.run.selected_frameworks.length
    ? report.run.selected_frameworks.join(", ")
    : "—";

  const sections = Object.entries(rowsByFramework)
    .map(([framework, rows]) => `
      <h2>${escapeHtml(framework)}</h2>
      <table>
        <tr><th>Clause</th><th>Status</th><th>Evidence</th></tr>
        ${rows
          .map(
            (r) => `<tr><td>${escapeHtml(r.clause)}${r.principle ? `<br/><span class="muted">${escapeHtml(r.principle)}</span>` : ""}</td><td>${escapeHtml(r.status)}</td><td>${escapeHtml(r.evidence)}</td></tr>`,
          )
          .join("")}
      </table>`)
    .join("");

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Compliance Report — ${escapeHtml(report.ai_system.name)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 860px; margin: 0 auto; padding: 40px; color: #1e293b; }
  h1 { font-size: 22px; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px; margin-bottom: 8px; }
  h2 { font-size: 16px; margin-top: 28px; color: #334155; }
  .meta { color: #64748b; font-size: 12px; margin-bottom: 20px; }
  .mock { background: #fffbeb; border: 1px solid #fcd34d; color: #92400e; padding: 10px 14px; border-radius: 6px; font-size: 13px; margin: 16px 0; }
  .pill { display: inline-block; background: #f1f5f9; border: 1px solid #e2e8f0; padding: 6px 12px; border-radius: 6px; margin: 4px 4px 0 0; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0 4px; font-size: 12px; }
  th, td { border: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; vertical-align: top; }
  th { background: #f8fafc; font-weight: 600; }
  .muted { color: #94a3b8; font-size: 11px; }
  .footer { margin-top: 36px; padding-top: 14px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; }
  @media print { body { padding: 20px; } }
</style></head><body>
<h1>AI Governance — Compliance Report</h1>
<p class="meta">System: <strong>${escapeHtml(report.ai_system.name)}</strong> · Run: ${escapeHtml(report.run.id.slice(0, 8))} · Date: ${date} · Frameworks: ${escapeHtml(frameworks)}</p>
${isMock ? `<div class="mock"><strong>Mock / dev data.</strong> Produced by a run using the mock metric evaluator, not a real tool backend.</div>` : ""}
<div>
  <span class="pill">State chain: ${report.state_chain.valid ? "Verified" : "Invalid"}</span>
  <span class="pill">Metric results: ${report.counts.metric_results ?? 0}</span>
  <span class="pill">Findings: ${report.counts.findings ?? 0}</span>
</div>
${sections || "<p>No framework control assessments in this report.</p>"}
<div class="footer">Generated by the AI Governance Engine · ${new Date().toISOString()}</div>
<script>window.onload = function () { window.print(); };</script>
</body></html>`;

  win.document.write(html);
  win.document.close();
}
