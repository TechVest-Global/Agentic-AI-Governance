import { executionArtifacts } from "@/data/executionLayerData";
import { findings, auditEvents, agents } from "@/data/mockData";

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

export function exportJSON() {
  const data = {
    runId: "run_09f4a2c1",
    system: "credit-scoring-v4.2",
    exportedAt: new Date().toISOString(),
    agents: agents,
    findings: findings,
    auditEvents: auditEvents,
  };
  downloadBlob(JSON.stringify(data, null, 2), "governance-run-data.json", "application/json");
}

export function exportCSV() {
  const headers = ["ID", "Agent", "Title", "Severity", "Framework", "Confidence"];
  const rows = findings.map(f => [f.id, f.agent, f.title, f.severity, f.framework, String(f.confidence)]);
  const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(",")).join("\n");
  downloadBlob(csv, "findings-export.csv", "text/csv");
}

export function exportLedger() {
  const data = {
    exportedAt: new Date().toISOString(),
    entries: auditEvents.map(e => ({
      ...e,
      verificationStatus: "Verified",
    })),
  };
  downloadBlob(JSON.stringify(data, null, 2), "audit-ledger-export.json", "application/json");
}

export function exportEvidenceBundle() {
  const bundle = {
    bundleId: "evidence-09f4a2c1",
    exportedAt: new Date().toISOString(),
    findings: findings,
    probes: {
      total: 101,
      biasAuditor: 50,
      driftAnalyst: 17,
      misuseDetector: 15,
      complianceMapper: 12,
      explainabilityAgent: 7,
    },
    councilMemo: executionArtifacts.find(a => a.name === "council-memo.md")?.content,
    verdict: JSON.parse(executionArtifacts.find(a => a.name === "verdict-VER-004.json")?.content || "{}"),
    hashes: {
      contextHash: "a1b2c3d4e5f6",
      planHash: "b2c3d4e5f6a1",
      evidenceHash: "c3d4e5f6a1b2",
      verdictHash: "d4e5f6a1b2c3",
    },
  };
  downloadBlob(JSON.stringify(bundle, null, 2), "evidence-bundle-export.json", "application/json");
}

export function exportPDF() {
  // Trigger a report-style view in a new window
  const reportHtml = `<!DOCTYPE html>
<html><head><title>Governance Report — credit-scoring-v4.2</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; color: #1e293b; }
h1 { font-size: 24px; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px; }
h2 { font-size: 18px; margin-top: 32px; color: #334155; }
h3 { font-size: 14px; color: #64748b; margin-top: 20px; }
.meta { color: #64748b; font-size: 13px; margin-bottom: 24px; }
.finding { border-left: 4px solid #ef4444; padding: 12px 16px; margin: 12px 0; background: #fef2f2; border-radius: 4px; }
.finding.high { border-color: #f97316; background: #fff7ed; }
.finding.medium { border-color: #f59e0b; background: #fffbeb; }
.metric { display: inline-block; background: #f1f5f9; border: 1px solid #e2e8f0; padding: 8px 14px; border-radius: 6px; margin: 4px; font-size: 13px; }
table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
th, td { border: 1px solid #e2e8f0; padding: 8px 12px; text-align: left; }
th { background: #f8fafc; font-weight: 600; }
.footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; }
@media print { body { padding: 20px; } }
</style></head><body>
<h1>AI Governance Report</h1>
<p class="meta">System: credit-scoring-v4.2 | Run: run_09f4a2c1 | Date: ${new Date().toISOString().split("T")[0]} | Frameworks: EU AI Act, SR 11-7, OECD AI Principles</p>

<h2>Executive Summary</h2>
<p>Governance evaluation identified 3 material findings (1 Critical, 1 High, 1 Medium). System assigned <strong>Supervised Operation</strong> tier with mandatory human review for 65+ applicant decisions.</p>
<div class="metric">Confidence: 75%</div>
<div class="metric">Tier: Supervised</div>
<div class="metric">Findings: 3</div>
<div class="metric">Probes: 101</div>

<h2>Findings</h2>
<div class="finding"><strong>F-001 — Age-based approval language disparity</strong> (Critical)<br/>Bias Auditor · EU AI Act Art.10(2)(f), SR 11-7 §4.1<br/>34% more negative language for applicants aged 65+ with identical profiles. Reproducibility: 92%.</div>
<div class="finding high"><strong>F-002 — Semantic drift from validated baseline</strong> (High)<br/>Drift Analyst · NIST AI RMF Measure 2.5<br/>Mean semantic similarity 0.61 against threshold 0.80 across 17 benchmark replays.</div>
<div class="finding medium"><strong>F-003 — EU AI Act Annex IV documentation incomplete</strong> (Medium)<br/>Compliance Mapper · EU AI Act Annex IV 3.2, 4.1<br/>Training data description and performance metrics absent from conformity file.</div>

<h2>Agent Summary</h2>
<table><tr><th>Agent</th><th>Status</th><th>Probes</th><th>Findings</th><th>Confidence Impact</th></tr>
<tr><td>Bias Auditor</td><td>Running</td><td>50</td><td>1</td><td>-12%</td></tr>
<tr><td>Drift Analyst</td><td>Running</td><td>17</td><td>1</td><td>-8%</td></tr>
<tr><td>Misuse Detector</td><td>Complete</td><td>15</td><td>0</td><td>0%</td></tr>
<tr><td>Compliance Mapper</td><td>Running</td><td>12</td><td>1</td><td>-6%</td></tr>
<tr><td>Explainability Agent</td><td>Running</td><td>7</td><td>0</td><td>-5%</td></tr>
<tr><td>Risk Scorer</td><td>Waiting</td><td>—</td><td>0</td><td>Pending</td></tr>
</table>

<h2>Remediation Actions</h2>
<ol>
<li>Mandate human review for all 65+ applicant decisions</li>
<li>Complete EU AI Act Annex IV technical documentation</li>
<li>Revalidate model baseline after prompt template review</li>
<li>Expand explanation probe coverage</li>
<li>Schedule re-evaluation for 2026-06-09</li>
</ol>

<h2>Audit Trail</h2>
<table><tr><th>Hash</th><th>Parent</th><th>Status</th></tr>
<tr><td>c1d8e3f6a9b2</td><td>b7e4f9a2c5d1</td><td>Verified</td></tr>
</table>

<div class="footer">Generated by AI Governance Engine · TechVest · ${new Date().toISOString()}</div>
</body></html>`;

  const win = window.open("", "_blank");
  if (win) {
    win.document.write(reportHtml);
    win.document.close();
  }
}
