import { Inbox, ListChecks } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { AuditorPageHeader, AuditorEmptyState } from "./components";

/**
 * My Assignments — the auditor's personal work list of AI systems assigned to
 * them. There is no assignment model or authenticated auditor identity in the
 * backend yet, so we cannot scope anything to "me". Rather than fabricate a
 * list, we show an honest empty state and point the auditor at the Review
 * Queue (which surfaces every run in scope) in the meantime.
 */
export function MyAssignments() {
  const navigateTo = useAppStore((s) => s.navigateTo);

  return (
    <div className="space-y-5">
      <AuditorPageHeader
        eyebrow="My workspace"
        title="My Assignments"
        description="AI systems and reviews assigned specifically to you."
      />
      <AuditorEmptyState
        icon={Inbox}
        title="No assignments yet"
        description="When systems and reviews are assigned to you, they'll appear here as your personal work list."
        note="Assignment routing requires a backend assignments table and an authenticated auditor identity, which aren't provisioned yet. Until then, nothing is scoped to an individual auditor — use the Review Queue to see every run in scope."
        action={
          <button
            onClick={() => navigateTo("/review-queue")}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-brand-700"
          >
            <ListChecks className="h-4 w-4" />
            Go to Review Queue
          </button>
        }
      />
    </div>
  );
}
