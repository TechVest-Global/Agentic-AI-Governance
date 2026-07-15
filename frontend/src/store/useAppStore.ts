import { create } from "zustand";
import type { PageId } from "@/types";

export type GlobalRunnerStatus = "idle" | "running" | "awaiting" | "done" | "error";

const routeMatchers: Array<[RegExp, PageId]> = [
  // ── Auditor / client assurance window (matched before shared/developer) ──
  [/^\/applications(?:\/.*)?$/, "applications"],
  [/^\/application(?:\/.*)?$/, "application-detail"],
  [/^\/compliance(?:\/.*)?$/, "compliance"],
  [/^\/client-reports(?:\/.*)?$/, "client-reports"],
  // ── Auditor workspace — retired routes (kept resolvable, not in nav) ──
  [/^\/overview(?:\/.*)?$/, "overview"],
  [/^\/my-assignments(?:\/.*)?$/, "my-assignments"],
  [/^\/review-queue(?:\/.*)?$/, "review-queue"],
  [/^\/audit-systems(?:\/.*)?$/, "audit-systems"],
  [/^\/evidence-review(?:\/.*)?$/, "evidence-review"],
  [/^\/findings-review(?:\/.*)?$/, "findings-review"],
  [/^\/verdict-review(?:\/.*)?$/, "verdict-review"],
  [/^\/compliance-reports(?:\/.*)?$/, "compliance-reports"],
  [/^\/audit-ledger(?:\/.*)?$/, "audit-ledger"],
  [/^\/remediation(?:\/.*)?$/, "remediation"],
  [/^\/notes-queries(?:\/.*)?$/, "notes-queries"],
  // ── Shared / developer routes ──
  [/^\/(?:dashboard)?$/, "dashboard"],
  [/^\/systems(?:\/.*)?$/, "systems"],
  [/^\/eval-runs(?:\/.*)?$/, "eval-runs"],
  [/^\/engine(?:\/.*)?$/, "engine"],
  [/^\/runs(?:\/.*)?$/, "runs"],
  [/^\/agents(?:\/.*)?$/, "runs"],
  [/^\/metric-plan(?:\/.*)?$/, "metric-plan"],
  [/^\/council(?:\/.*)?$/, "council"],
  [/^\/findings(?:\/.*)?$/, "findings"],
  [/^\/metric-results(?:\/.*)?$/, "metric-results"],
  [/^\/verdicts(?:\/.*)?$/, "verdicts"],
  [/^\/reports(?:\/.*)?$/, "reports"],
  [/^\/evidence(?:\/.*)?$/, "evidence"],
  [/^\/ledger(?:\/.*)?$/, "ledger"],
  [/^\/context-profiles(?:\/.*)?$/, "context-profiles"],
  [/^\/capabilities(?:\/.*)?$/, "capabilities"],
  [/^\/metrics-config(?:\/.*)?$/, "metrics-config"],
  [/^\/framework-mapping(?:\/.*)?$/, "framework-mapping"],
  [/^\/llm-boundary(?:\/.*)?$/, "llm-boundary"],
  [/^\/security-tools(?:\/.*)?$/, "security-tools"],
  [/^\/governance-state(?:\/.*)?$/, "governance-state"],
  [/^\/api-debug(?:\/.*)?$/, "api-debug"],
];

export function pageFromPath(pathname: string): PageId {
  return routeMatchers.find(([pattern]) => pattern.test(pathname))?.[1] ?? "dashboard";
}

type AppStore = {
  activePage: PageId;
  currentPath: string;
  headerHidden: boolean;
  setHeaderHidden: (hidden: boolean) => void;
  /** Mirrors useEvaluationRunner's status so any page (e.g. the header's run indicator) can react without prop-drilling. */
  globalRunnerStatus: GlobalRunnerStatus;
  setGlobalRunnerStatus: (status: GlobalRunnerStatus) => void;
  setRouteFromPath: (path: string) => void;
  navigateTo: (path: string) => void;
};

const initialPath = typeof window !== "undefined" ? window.location.pathname : "/dashboard";

export const useAppStore = create<AppStore>((set) => ({
  // Initialise from the real URL so a refresh / deep link lands on the right
  // page. Hardcoding "dashboard" made the route guard bounce any first-load
  // deep link not accessible to the current persona (e.g. an auditor
  // refreshing on /review-queue, since auditors can't see "dashboard").
  activePage: pageFromPath(initialPath),
  currentPath: initialPath,
  headerHidden: false,
  setHeaderHidden: (hidden) => set({ headerHidden: hidden }),
  globalRunnerStatus: "idle",
  setGlobalRunnerStatus: (status) => set({ globalRunnerStatus: status }),
  setRouteFromPath: (path) => set({ activePage: pageFromPath(path), currentPath: path }),
  navigateTo: (path) => {
    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
    set({ activePage: pageFromPath(path), currentPath: path });
  },
}));
