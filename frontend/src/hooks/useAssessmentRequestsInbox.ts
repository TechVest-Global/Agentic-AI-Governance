import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { listAISystems, listAllAssessmentRequests, type AssessmentRequest } from "@/api/governanceApi";

export type InboxRequest = AssessmentRequest & { systemName: string; read: boolean };

const POLL_MS = 15_000;
const OPEN_STATUSES: AssessmentRequest["status"][] = ["pending", "in_progress"];

// Read-request IDs persist across reloads so the badge count stays accurate,
// mirroring the notifications bell's read-tracking (useNotifications.ts).
type ReadStore = { readIds: string[]; markRead: (ids: string[]) => void; markAllRead: (ids: string[]) => void };
const useReadStore = create<ReadStore>()(
  persist(
    (set, get) => ({
      readIds: [],
      markRead: (ids) => set({ readIds: Array.from(new Set([...get().readIds, ...ids])) }),
      markAllRead: (ids) => set({ readIds: Array.from(new Set([...get().readIds, ...ids])) }),
    }),
    { name: "governai-read-assessment-requests", storage: createJSONStorage(() => localStorage) },
  ),
);

/** Cross-system feed of open (pending/in-progress) auditor → developer
 * assessment requests, polled from the backend every 15s. Backs the top-bar
 * requests inbox and its unread badge. */
export function useAssessmentRequestsInbox() {
  const [requests, setRequests] = useState<AssessmentRequest[]>([]);
  const [systemNameById, setSystemNameById] = useState<Map<string, string>>(new Map());
  const readIds = useReadStore((s) => s.readIds);
  const markRead = useReadStore((s) => s.markRead);
  const markAllRead = useReadStore((s) => s.markAllRead);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const [reqs, systems] = await Promise.all([
          listAllAssessmentRequests(OPEN_STATUSES),
          listAISystems().catch(() => []),
        ]);
        if (cancelled) return;
        setRequests(reqs);
        setSystemNameById(new Map(systems.map((s) => [s.id, s.name])));
      } catch {
        // Transient fetch failure — next poll retries.
      }
    }

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const items = useMemo<InboxRequest[]>(
    () =>
      requests.map((r) => ({
        ...r,
        systemName: systemNameById.get(r.ai_system_id) ?? "AI system",
        read: readIds.includes(r.id),
      })),
    [requests, systemNameById, readIds],
  );

  const unreadCount = items.filter((i) => !i.read).length;

  return {
    items,
    unreadCount,
    markRead: (id: string) => markRead([id]),
    markAllRead: () => markAllRead(requests.map((r) => r.id)),
  };
}
