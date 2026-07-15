import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Shared selection that connects every run-scoped tab. Picking a run (or
 * system) on one page carries across Evidence, Metric Results, Findings,
 * Verdicts, Reports, Compliance, Governance State, the LLM boundary, and the
 * Live Run — so the whole workspace stays focused on the same evaluation.
 *
 * `selectedRunId === null` means "follow the latest run" (the default).
 */
type SelectionStore = {
  selectedRunId: string | null;
  selectedSystemId: string | null;
  setSelectedRunId: (id: string | null) => void;
  setSelectedSystemId: (id: string | null) => void;
  /** Focus a run (and optionally its system) — used by cross-page drill-downs. */
  focusRun: (runId: string, systemId?: string | null) => void;
  /** Clear back to "follow the latest run" — used on sign-out. */
  reset: () => void;
};

export const useSelectionStore = create<SelectionStore>()(
  persist(
    (set) => ({
      selectedRunId: null,
      selectedSystemId: null,
      setSelectedRunId: (id) => set({ selectedRunId: id }),
      setSelectedSystemId: (id) => set({ selectedSystemId: id }),
      focusRun: (runId, systemId) =>
        set((s) => ({
          selectedRunId: runId,
          selectedSystemId: systemId ?? s.selectedSystemId,
        })),
      reset: () => set({ selectedRunId: null, selectedSystemId: null }),
    }),
    {
      name: "governai-selection",
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);
