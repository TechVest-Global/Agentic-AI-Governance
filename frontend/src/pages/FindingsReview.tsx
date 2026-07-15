import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Flag,
  Info,
  Loader2,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import clsx from "clsx";
import { Card, CardHeader } from "@/components/ui/Card";
import { MetricCard } from "@/components/ui/MetricCard";
import { Badge } from "@/components/ui/Badge";
import { useAppStore } from "@/store/useAppStore";
import { useAuthStore } from "@/store/useAuthStore";
import { roleCan } from "@/lib/permissions";
import { personaForRole } from "@/lib/persona";
import { useActiveRun } from "@/hooks/useActiveRun";
import {
  getFindings,
  type BackendFinding,
  type FindingSeverity,
} from "@/api/governanceApi";

type SeverityFilter = "all" | "critical" | "high" | "medium" | "low";
type StatusFilter = "all" | "open" | "mitigated" | "dismissed" | "accepted";

type ReviewAction = "accepted" | "remediation" | "mitigated" | "dismissed";

type LocalReview = {
  action: ReviewAction;
  note?: string;
  at: string;
};

function humanize(text: string): string {
  return text.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const severityBar: Record<FindingSeverity, string> = {
  critical: "bg-red-500",
  high: "bg-orange-400",
  medium: "bg-amber-400",
  low: "bg-blue-400",
  info: "bg-slate-400",
};

function severityTone(severity: FindingSeverity): "red" | "amber" | "blue" | "slate" {
  if (severity === "critical" || severity === "high") return "red";
  if (severity === "medium") return "amber";
  if (severity === "low") return "blue";
  return "slate";
}

function reviewLabel(action: ReviewAction): string {
  if (action === "accepted") return "Accepted";
  if (action === "remediation") return "Remediation requested";
  if (action === "mitigated") return "Mitigated";
  return "Dismissed";
}

function reviewTone(action: ReviewAction): "green" | "amber" | "blue" | "slate" {
  if (action === "accepted") return "green";
  if (action === "mitigated") return "blue";
  if (action === "remediation") return "amber";
  return "slate";
}

function statusTone(status: string): "green" | "amber" | "blue" | "slate" | "red" {
  const s = status.toLowerCase();
  if (["mitigated", "resolved"].includes(s)) return "blue";
  if (["accepted", "closed"].includes(s)) return "green";
  if (["dismissed"].includes(s)) return "slate";
  if (["open"].includes(s)) return "amber";
  return "slate";
}

export function FindingsReview() {
  const navigateTo = useAppStore((s) => s.navigateTo);
  const role = useAuthStore((s) => s.user?.role);
  const canReview = roleCan(role, "canReviewFindings");
  // Route to the persona-correct evidence page (auditors have their own route).
  const evidencePath = personaForRole(role) === "auditor" ? "/evidence-review" : "/evidence";

  const { runId, loading: runsLoading } = useActiveRun();
  const [findings, setFindings] = useState<BackendFinding[]>([]);
  const [findingsLoading, setFindingsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dimensionFilter, setDimensionFilter] = useState<string>("all");

  // Local-only review state, keyed by finding id (no backend mutation endpoint).
  const [reviews, setReviews] = useState<Record<string, LocalReview>>({});

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    setFindingsLoading(true);
    setError(null);
    setSeverityFilter("all");
    setStatusFilter("all");
    setDimensionFilter("all");
    setReviews({});
    getFindings(runId)
      .then((rows) => {
        if (!cancelled) setFindings(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load findings.");
      })
      .finally(() => {
        if (!cancelled) setFindingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const counts = useMemo(() => {
    let criticalHigh = 0;
    let open = 0;
    let mitigated = 0;
    for (const f of findings) {
      if (f.severity === "critical" || f.severity === "high") criticalHigh += 1;
      const s = f.status.toLowerCase();
      if (s === "open") open += 1;
      if (s === "mitigated" || s === "resolved") mitigated += 1;
    }
    return { total: findings.length, criticalHigh, open, mitigated };
  }, [findings]);

  const dimensions = useMemo(
    () => Array.from(new Set(findings.map((f) => f.dimension))).sort(),
    [findings],
  );

  function effectiveStatus(f: BackendFinding): string {
    const review = reviews[f.id];
    if (!review) return f.status;
    if (review.action === "accepted") return "accepted";
    if (review.action === "mitigated") return "mitigated";
    if (review.action === "dismissed") return "dismissed";
    return f.status; // remediation requested keeps original status
  }

  const filtered = useMemo(() => {
    return findings.filter((f) => {
      if (severityFilter !== "all" && f.severity !== severityFilter) return false;
      if (dimensionFilter !== "all" && f.dimension !== dimensionFilter) return false;
      if (statusFilter !== "all" && effectiveStatus(f).toLowerCase() !== statusFilter) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findings, severityFilter, statusFilter, dimensionFilter, reviews]);

  const severityPills: Array<{ key: SeverityFilter; label: string }> = [
    { key: "all", label: "All" },
    { key: "critical", label: "Critical" },
    { key: "high", label: "High" },
    { key: "medium", label: "Medium" },
    { key: "low", label: "Low" },
  ];

  const statusPills: Array<{ key: StatusFilter; label: string }> = [
    { key: "all", label: "All" },
    { key: "open", label: "Open" },
    { key: "mitigated", label: "Mitigated" },
    { key: "dismissed", label: "Dismissed" },
    { key: "accepted", label: "Accepted" },
  ];

  function applyReview(id: string, action: ReviewAction, note?: string) {
    setReviews((prev) => ({
      ...prev,
      [id]: { action, note, at: new Date().toLocaleString() },
    }));
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-700 dark:text-blue-400">
            Findings Review
          </p>
          <h1 className="mt-1 flex items-center gap-2 text-[20px] font-semibold tracking-tight text-slate-950 dark:text-white">
            <ShieldAlert className="h-5 w-5 text-slate-400" />
            Auditor review workspace
          </h1>
          <p className="mt-1 max-w-3xl text-[13px] leading-5 text-slate-600 dark:text-slate-400">
            Triage findings produced by specialist agents. Review decisions are recorded locally in this prototype.
          </p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Total Findings" value={counts.total} icon={Flag} compact />
        <MetricCard label="Critical / High" value={counts.criticalHigh} icon={AlertTriangle} tone="red" compact />
        <MetricCard label="Open" value={counts.open} icon={ShieldAlert} tone="amber" compact />
        <MetricCard label="Mitigated / Resolved" value={counts.mitigated} icon={ShieldCheck} tone="green" compact />
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
            Severity
          </span>
          {severityPills.map((p) => (
            <FilterPill key={p.key} active={severityFilter === p.key} onClick={() => setSeverityFilter(p.key)}>
              {p.label}
            </FilterPill>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
            Status
          </span>
          {statusPills.map((p) => (
            <FilterPill key={p.key} active={statusFilter === p.key} onClick={() => setStatusFilter(p.key)}>
              {p.label}
            </FilterPill>
          ))}
          <select
            value={dimensionFilter}
            onChange={(e) => setDimensionFilter(e.target.value)}
            className="ml-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-[12px] font-medium text-slate-700 dark:text-slate-300"
          >
            <option value="all">All dimensions</option>
            {dimensions.map((d) => (
              <option key={d} value={d}>
                {humanize(d)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!canReview && (
        <div className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-4 py-2.5 text-[12px] text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Your role can view findings but cannot record review decisions.</span>
        </div>
      )}

      {runsLoading || findingsLoading ? (
        <Card className="flex items-center gap-2 px-5 py-12 text-[13px] text-slate-500 dark:text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading findings…
        </Card>
      ) : error ? (
        <Card className="m-0 flex items-start gap-2 px-4 py-3 text-[12px] text-red-700 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Could not load findings.</p>
            <p className="mt-0.5 break-all">{error}</p>
          </div>
        </Card>
      ) : !runId ? (
        <Card className="px-5 py-12 text-center text-[13px] text-slate-500 dark:text-slate-400">
          No evaluation runs available yet.
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="px-5 py-12 text-center text-[13px] text-slate-500 dark:text-slate-400">
          No findings match these filters.
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((finding) => (
            <FindingCard
              key={finding.id}
              finding={finding}
              review={reviews[finding.id]}
              canReview={canReview}
              effectiveStatus={effectiveStatus(finding)}
              onReview={applyReview}
              onViewEvidence={() => navigateTo(evidencePath)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "rounded border px-3 py-1.5 text-[12px] font-medium transition-colors",
        active
          ? "border-slate-900 bg-slate-900 dark:border-brand-600 dark:bg-brand-700 text-white"
          : "border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700",
      )}
    >
      {children}
    </button>
  );
}

function FindingCard({
  finding,
  review,
  canReview,
  effectiveStatus,
  onReview,
  onViewEvidence,
}: {
  finding: BackendFinding;
  review: LocalReview | undefined;
  canReview: boolean;
  effectiveStatus: string;
  onReview: (id: string, action: ReviewAction, note?: string) => void;
  onViewEvidence: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [notePrompt, setNotePrompt] = useState<null | "remediation" | "dismissed">(null);
  const [note, setNote] = useState("");

  const confidencePct = Math.round(Math.max(0, Math.min(1, finding.confidence)) * 100);

  function submitNote() {
    if (notePrompt) {
      onReview(finding.id, notePrompt, note.trim() || undefined);
      setNotePrompt(null);
      setNote("");
    }
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex">
        <div className={clsx("w-1.5 shrink-0", severityBar[finding.severity])} />
        <div className="min-w-0 flex-1">
          {/* Header row */}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60"
          >
            <span className="mt-0.5 text-slate-400">
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-semibold text-slate-950 dark:text-white">{finding.title}</span>
                <Badge tone={severityTone(finding.severity)}>{humanize(finding.severity)}</Badge>
                <Badge tone="violet">{humanize(finding.dimension)}</Badge>
                <Badge tone={statusTone(effectiveStatus)}>{humanize(effectiveStatus)}</Badge>
                {review && <Badge tone={reviewTone(review.action)}>{reviewLabel(review.action)}</Badge>}
              </div>
              <p className="mt-1 line-clamp-1 text-[12px] text-slate-600 dark:text-slate-400">{finding.summary}</p>
            </div>
            <div className="shrink-0 text-right text-[11px] text-slate-500 dark:text-slate-400">
              <p className="font-medium tabular-nums text-slate-700 dark:text-slate-300">{confidencePct}%</p>
              <p>confidence</p>
            </div>
          </button>

          {expanded && (
            <div className="border-t border-slate-100 dark:border-slate-700/50 px-4 py-3.5">
              <p className="text-[12px] leading-5 text-slate-700 dark:text-slate-300">{finding.summary}</p>

              <dl className="mt-3 grid gap-x-6 gap-y-2 text-[12px] sm:grid-cols-2">
                <div className="flex gap-2">
                  <dt className="text-slate-500 dark:text-slate-400">Type</dt>
                  <dd className="text-slate-800 dark:text-slate-200">{humanize(finding.finding_type)}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-slate-500 dark:text-slate-400">Agent</dt>
                  <dd className="text-slate-800 dark:text-slate-200">
                    {finding.agent_name ? humanize(finding.agent_name) : "—"}
                  </dd>
                </div>
              </dl>

              {finding.framework_refs.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Frameworks
                  </span>
                  {finding.framework_refs.map((fw) => (
                    <span
                      key={fw}
                      className="rounded bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-[10px] font-medium text-slate-700 dark:text-slate-300"
                    >
                      {fw}
                    </span>
                  ))}
                </div>
              )}

              {finding.recommended_action && (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                  <span className="font-semibold">Recommended action: </span>
                  {finding.recommended_action}
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
                {finding.evidence_ids.length > 0 ? (
                  <button
                    onClick={onViewEvidence}
                    className="font-medium text-blue-700 hover:underline dark:text-blue-400"
                  >
                    {finding.evidence_ids.length} evidence record{finding.evidence_ids.length === 1 ? "" : "s"} →
                  </button>
                ) : (
                  <span>No evidence records</span>
                )}
                <span>Created {new Date(finding.created_at).toLocaleString()}</span>
              </div>

              {/* Local review confirmation */}
              {review && (
                <div className="mt-3 flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p>
                      <span className="font-semibold">{reviewLabel(review.action)}</span> · recorded {review.at}
                    </p>
                    {review.note && <p className="mt-0.5 italic">“{review.note}”</p>}
                  </div>
                </div>
              )}

              {/* Auditor review actions */}
              {canReview && (
                <div className="mt-3 border-t border-slate-100 dark:border-slate-700/50 pt-3">
                  {notePrompt ? (
                    <div className="space-y-2">
                      <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {notePrompt === "remediation" ? "Remediation note" : "Reason for dismissal"}
                      </label>
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={2}
                        placeholder={
                          notePrompt === "remediation"
                            ? "Describe the remediation requested…"
                            : "Why is this finding being dismissed?"
                        }
                        className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-[12px] text-slate-700 dark:text-slate-200"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={submitNote}
                          className="rounded bg-[#111827] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-slate-800"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => {
                            setNotePrompt(null);
                            setNote("");
                          }}
                          className="rounded border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-[12px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => onReview(finding.id, "accepted")}
                        className="inline-flex items-center gap-1.5 rounded border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[12px] font-medium text-emerald-800 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Accept
                      </button>
                      <button
                        onClick={() => {
                          setNotePrompt("remediation");
                          setNote("");
                        }}
                        className="inline-flex items-center gap-1.5 rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-[12px] font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                      >
                        <Flag className="h-3.5 w-3.5" />
                        Request remediation
                      </button>
                      <button
                        onClick={() => onReview(finding.id, "mitigated")}
                        className="inline-flex items-center gap-1.5 rounded border border-blue-300 bg-blue-50 px-3 py-1.5 text-[12px] font-medium text-blue-800 hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Mark mitigated
                      </button>
                      <button
                        onClick={() => {
                          setNotePrompt("dismissed");
                          setNote("");
                        }}
                        className="inline-flex items-center gap-1.5 rounded border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-[12px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                  <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
                    Review actions are recorded locally in this prototype and are not persisted to the backend.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
