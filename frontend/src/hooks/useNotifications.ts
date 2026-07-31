import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { getFindings, getRunVerdict, listEvaluationRuns, listAISystems, type EvaluationRun } from "@/api/governanceApi";

type NotificationBase = {
  id: string;
  kind: "run_completed" | "run_failed" | "verdict_review" | "finding";
  title: string;
  detail: string;
  runId: string;
  createdAt: string;
};

export type Notification = NotificationBase & { read: boolean };

const TERMINAL = new Set(["completed", "report_ready", "failed", "cancelled", "canceled"]);
const REVIEW_TIERS = new Set(["human_review", "supervised"]);
const HIGH_SEVERITY = new Set(["critical", "high"]);
const POLL_MS = 15_000;
const RECENT_RUN_LIMIT = 5;

/** Pulls the real failure reason out of a run's error_summary (set by the
 * backend's _finalize_run / degraded-run path) instead of a generic string —
 * without this, every failed-run notification read the same regardless of
 * what actually broke (metric execution, a specialist agent, an interrupted
 * worker, ...). */
function describeRunFailure(run: EvaluationRun): string {
  const summary = run.error_summary;
  if (summary && typeof summary.message === "string" && summary.message.trim()) {
    return summary.message;
  }
  if (summary && Object.keys(summary).length > 0) {
    return Object.entries(summary)
      .slice(0, 3)
      .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
      .join(" · ");
  }
  return "Governance run did not complete successfully.";
}

// Read-notification IDs persist across reloads so the badge count stays accurate.
type ReadStore = { readIds: string[]; markRead: (ids: string[]) => void; markAllRead: (ids: string[]) => void };
const useReadStore = create<ReadStore>()(
  persist(
    (set, get) => ({
      readIds: [],
      markRead: (ids) => set({ readIds: Array.from(new Set([...get().readIds, ...ids])) }),
      markAllRead: (ids) => set({ readIds: Array.from(new Set([...get().readIds, ...ids])) }),
    }),
    { name: "governai-read-notifications", storage: createJSONStorage(() => localStorage) },
  ),
);

/** Derives real notifications from run completions, review-tier verdicts, and
 * high/critical findings across the most recent runs — polled from the backend
 * every 15s. Read state persists across reloads. */
export function useNotifications() {
  const [runs, setRuns] = useState<EvaluationRun[]>([]);
  const [verdictByRun, setVerdictByRun] = useState<Record<string, Awaited<ReturnType<typeof getRunVerdict>>>>({});
  const [findingsByRun, setFindingsByRun] = useState<Record<string, Awaited<ReturnType<typeof getFindings>>>>({});
  const [systemNameById, setSystemNameById] = useState<Map<string, string>>(new Map());
  const readIds = useReadStore((s) => s.readIds);
  const markRead = useReadStore((s) => s.markRead);
  const markAllRead = useReadStore((s) => s.markAllRead);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const [runList, systems] = await Promise.all([
          listEvaluationRuns(RECENT_RUN_LIMIT),
          listAISystems().catch(() => []),
        ]);
        if (cancelled) return;
        setRuns(runList);
        setSystemNameById(new Map(systems.map((s) => [s.id, s.name])));

        const terminalRuns = runList.filter((r) => TERMINAL.has(r.status));
        const [verdicts, findingsLists] = await Promise.all([
          Promise.all(terminalRuns.map((r) => getRunVerdict(r.id).catch(() => null))),
          Promise.all(terminalRuns.map((r) => getFindings(r.id).catch(() => []))),
        ]);
        if (cancelled) return;

        setVerdictByRun(Object.fromEntries(terminalRuns.map((r, i) => [r.id, verdicts[i]])));
        setFindingsByRun(Object.fromEntries(terminalRuns.map((r, i) => [r.id, findingsLists[i]])));
      } catch {
        // Transient fetch failure — next poll retries.
      }
    }

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const notifications = useMemo<NotificationBase[]>(() => {
    const items: NotificationBase[] = [];

    for (const run of runs) {
      const systemName = systemNameById.get(run.ai_system_id) ?? "AI system";

      if (run.status === "completed" || run.status === "report_ready") {
        items.push({
          id: `run-done-${run.id}`,
          kind: "run_completed",
          title: `Run completed — ${systemName}`,
          detail: `Governance run finished at ${run.completed_at ? new Date(run.completed_at).toLocaleTimeString() : "an unknown time"}.`,
          runId: run.id,
          createdAt: run.completed_at ?? run.updated_at ?? run.created_at,
        });
      } else if (run.status === "failed" || run.status === "cancelled" || run.status === "canceled") {
        items.push({
          id: `run-failed-${run.id}`,
          kind: "run_failed",
          title: `Run ${run.status} — ${systemName}`,
          detail: describeRunFailure(run),
          runId: run.id,
          createdAt: run.updated_at ?? run.created_at,
        });
      }

      const verdict = verdictByRun[run.id];
      if (verdict && (REVIEW_TIERS.has(verdict.action_tier) || verdict.label === "blocked")) {
        items.push({
          id: `verdict-${verdict.id}`,
          kind: "verdict_review",
          title: `Verdict needs review — ${systemName}`,
          detail: `Confidence ${Math.round(verdict.confidence_score * 100)}% · ${verdict.label} · routed to ${verdict.action_tier.replace(/_/g, " ")}.`,
          runId: run.id,
          createdAt: verdict.created_at,
        });
      }

      const findings = findingsByRun[run.id] ?? [];
      for (const finding of findings) {
        if (!HIGH_SEVERITY.has(finding.severity)) continue;
        items.push({
          id: `finding-${finding.id}`,
          kind: "finding",
          title: `${finding.severity.toUpperCase()} finding — ${systemName}`,
          detail: finding.title,
          runId: run.id,
          createdAt: finding.created_at,
        });
      }
    }

    return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [runs, verdictByRun, findingsByRun, systemNameById]);

  const withReadState = useMemo<Notification[]>(
    () => notifications.map((n) => ({ ...n, read: readIds.includes(n.id) })),
    [notifications, readIds],
  );
  const unreadCount = withReadState.filter((n) => !n.read).length;

  return {
    notifications: withReadState,
    unreadCount,
    markRead: (id: string) => markRead([id]),
    markAllRead: () => markAllRead(notifications.map((n) => n.id)),
  };
}
