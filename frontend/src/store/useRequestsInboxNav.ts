import { create } from "zustand";

/**
 * One-shot navigation intent from the requests inbox to a specific system's
 * Requests tab on the AI Systems page. Deliberately separate from
 * useSelectionStore (selectedSystemId there drives run-scoped tabs — Evidence,
 * Findings, Verdicts, etc. — and reusing it here would make AI Systems
 * auto-expand a row any time the user arrives from an unrelated run drill-down).
 */
type RequestsInboxNavState = {
  targetSystemId: string | null;
  goToSystemRequests: (systemId: string) => void;
  /** Read and clear in one step so the intent only fires once. */
  consume: () => string | null;
};

export const useRequestsInboxNav = create<RequestsInboxNavState>((set, get) => ({
  targetSystemId: null,
  goToSystemRequests: (systemId) => set({ targetSystemId: systemId }),
  consume: () => {
    const id = get().targetSystemId;
    if (id !== null) set({ targetSystemId: null });
    return id;
  },
}));
