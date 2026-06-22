import { create } from "zustand";
import type { PageId } from "@/types";

const routeMatchers: Array<[RegExp, PageId]> = [
  [/^\/(?:dashboard)?$/, "dashboard"],
  [/^\/systems(?:\/.*)?$/, "systems"],
  [/^\/engine(?:\/.*)?$/, "engine"],
  [/^\/runs(?:\/.*)?$/, "engine"],
  [/^\/agents(?:\/.*)?$/, "agents"],
  [/^\/metric-plan(?:\/.*)?$/, "metric-plan"],
  [/^\/council(?:\/.*)?$/, "council"],
  [/^\/verdicts(?:\/.*)?$/, "verdicts"],
  [/^\/reports(?:\/.*)?$/, "reports"],
  [/^\/ledger(?:\/.*)?$/, "ledger"],
];

export function pageFromPath(pathname: string): PageId {
  return routeMatchers.find(([pattern]) => pattern.test(pathname))?.[1] ?? "dashboard";
}

type AppStore = {
  activePage: PageId;
  currentPath: string;
  headerHidden: boolean;
  setHeaderHidden: (hidden: boolean) => void;
  setRouteFromPath: (path: string) => void;
  navigateTo: (path: string) => void;
};

export const useAppStore = create<AppStore>((set) => ({
  activePage: "dashboard",
  currentPath: "/dashboard",
  headerHidden: false,
  setHeaderHidden: (hidden) => set({ headerHidden: hidden }),
  setRouteFromPath: (path) => set({ activePage: pageFromPath(path), currentPath: path }),
  navigateTo: (path) => {
    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
    set({ activePage: pageFromPath(path), currentPath: path });
  },
}));
