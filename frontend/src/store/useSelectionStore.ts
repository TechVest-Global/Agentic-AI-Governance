import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Shared selection that connects every run-scoped tab. Picking a run (or
 * system) on one page carries across Evidence, Metric Results, Findings,
 * Verdicts, Reports, Compliance, Governance State, the LLM boundary, and the
 * Live Run — so the whole workspace stays focused on the same evaluation.
 *
 * `selectedRunId === null` means "follow the latest run" (the default).
 *
 * "Follow the latest run" and "show no run at all" are DIFFERENT states, and
 * conflating them is what made the Live Run Reset button do nothing: it set
 * `selectedRunId = null`, both run-loading hooks read that as "follow latest",
 * and the latest run is the very run Reset was trying to clear — so the page
 * re-rendered identically. `runSelectionCleared` carries that second intent
 * explicitly, and outranks every fall-back-to-latest path.
 */
type SelectionStore = {
  selectedRunId: string | null;
  selectedSystemId: string | null;
  /** True only after an explicit Reset: show no run, do not fall back to latest. */
  runSelectionCleared: boolean;
  setSelectedRunId: (id: string | null) => void;
  setSelectedSystemId: (id: string | null) => void;
  /** Focus a run (and optionally its system) — used by cross-page drill-downs. */
  focusRun: (runId: string, systemId?: string | null) => void;
  /** Show no run at all, until one is started or picked. Used by Reset. */
  clearRunSelection: () => void;
  /** Clear back to "follow the latest run" — used on sign-out. */
  reset: () => void;
};

export const useSelectionStore = create<SelectionStore>()(
  persist(
    (set) => ({
      selectedRunId: null,
      selectedSystemId: null,
      runSelectionCleared: false,
      // Any explicit selection cancels a prior Reset — including selecting
      // `null`, which means "follow the latest run" and is not the same thing
      // as "show nothing" (see clearRunSelection).
      setSelectedRunId: (id) => set({ selectedRunId: id, runSelectionCleared: false }),
      setSelectedSystemId: (id) => set({ selectedSystemId: id }),
      focusRun: (runId, systemId) =>
        set((s) => ({
          selectedRunId: runId,
          selectedSystemId: systemId ?? s.selectedSystemId,
          runSelectionCleared: false,
        })),
      clearRunSelection: () => set({ selectedRunId: null, runSelectionCleared: true }),
      reset: () =>
        set({ selectedRunId: null, selectedSystemId: null, runSelectionCleared: false }),
    }),
    {
      name: "governai-selection",
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);
