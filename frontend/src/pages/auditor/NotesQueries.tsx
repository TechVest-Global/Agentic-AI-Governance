import { MessagesSquare } from "lucide-react";
import { AuditorPageHeader, AuditorEmptyState } from "./components";

/**
 * Notes & Queries — where an auditor would raise clarification queries to
 * system owners and keep review notes. There is no notes/queries entity in the
 * backend (and no auditor identity to attribute them to), so we show an honest
 * empty state rather than a local-only scratchpad that silently loses data.
 */
export function NotesQueries() {
  return (
    <div className="space-y-5">
      <AuditorPageHeader
        eyebrow="Collaboration"
        title="Notes & Queries"
        description="Raise clarification queries to system owners and keep a thread of review notes against each system and run."
      />
      <AuditorEmptyState
        icon={MessagesSquare}
        title="No notes or queries yet"
        description="This is where review notes and clarification queries to system owners will live — threaded per system and run, with status tracking."
        note="Notes & queries need a backend table to persist and route them (and an authenticated identity to attribute them to). That isn't provisioned yet, so nothing is stored here — no data is being captured or silently discarded."
      />
    </div>
  );
}
