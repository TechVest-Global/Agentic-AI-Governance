import { useEffect, useRef, useState } from "react";
import { Bell, ChevronDown, FileText, PanelLeft, PanelLeftClose, Play, Search, Shield, X } from "lucide-react";
import clsx from "clsx";
import { SearchOverlay } from "@/components/SearchOverlay";
import { navigation } from "@/data/mockData";
import { useAppStore } from "@/store/useAppStore";
import type { PageId } from "@/types";

export function AppShell({ children }: { children: React.ReactNode }) {
  const activePage = useAppStore((state) => state.activePage);
  const navigateTo = useAppStore((state) => state.navigateTo);
  const current = navigation.find((item) => item.id === activePage);
  const headerHidden = useAppStore((state) => state.headerHidden);
  const isEngine = activePage === "engine";
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
        searchInputRef.current?.focus();
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        searchInputRef.current?.blur();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleSearchSelect = (path: string) => {
    navigateTo(path);
    setSearchQuery("");
    setSearchOpen(false);
    searchInputRef.current?.blur();
  };

  return (
    <div className="min-h-screen bg-[#f6f7fb]">
      <aside className={clsx("fixed inset-y-0 left-0 z-50 flex w-60 flex-col bg-[#0f1626] text-slate-100 transition-transform duration-300", !sidebarOpen && "-translate-x-full")}>
        <div className="flex h-14 items-center gap-3 border-b border-white/10 px-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand-600 text-white">
            <Shield className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold leading-tight text-white">GovernAI</p>
            <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-slate-400">Output-only AI Governance Engine</p>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="rounded p-1 text-slate-500 hover:bg-white/5 hover:text-slate-300" aria-label="Collapse navigation">
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-5">
          {(["Govern", "Assurance"] as const).map((section) => (
            <div key={section} className="mb-6">
              <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">{section}</p>
              <div className="space-y-1">
                {navigation
                  .filter((item) => item.section === section)
                  .map((item) => (
                    <button
                      key={item.id}
                      onClick={() => navigateTo(item.path)}
                      className={clsx(
                        "relative flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-all",
                        activePage === item.id
                          ? "bg-white/[0.08] text-white before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r before:bg-brand-400"
                          : "text-slate-400 hover:bg-white/5 hover:text-white"
                      )}
                    >
                      <item.icon className={clsx("h-4 w-4", activePage === item.id ? "text-brand-300" : "text-slate-500")} />
                      <span className="flex-1">{item.label}</span>
                      {item.badge && <span className="rounded bg-orange-700/70 px-1.5 py-0.5 text-[10px] text-orange-100">{item.badge}</span>}
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 p-3">
          <div className="rounded-md bg-slate-800/80 p-3 ring-1 ring-white/5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Tenant</p>
            <p className="mt-2 text-[12px] font-semibold text-white">Northwind Financial</p>
            <p className="mt-0.5 text-[10px] text-slate-500">org_4f8a - Enterprise</p>
          </div>
        </div>
      </aside>

      <div className={clsx("transition-[padding] duration-300", sidebarOpen ? "pl-60" : "pl-0")}>
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-[#e7e9f0] bg-white/85 px-4 backdrop-blur-md">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
              aria-label="Toggle navigation"
            >
              <PanelLeft className="h-4 w-4" />
            </button>
            <button className="flex items-center gap-2 rounded border border-slate-300 bg-white px-3 py-2 text-[12px] font-medium text-slate-900">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Production
              <span className="text-slate-500">US-East</span>
              <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
            </button>
            <div className="relative w-full max-w-xl">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                onBlur={() => window.setTimeout(() => setSearchOpen(false), 120)}
                className="h-9 w-full rounded-lg border border-slate-300 bg-slate-50 pl-9 pr-12 text-[13px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-100"
                placeholder="Search runs, models, evidence, controls..."
              />
              {searchQuery ? (
                <button
                  className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setSearchQuery("");
                    searchInputRef.current?.focus();
                  }}
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : (
                <kbd className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-500">Ctrl K</kbd>
              )}
              {searchOpen && <SearchOverlay query={searchQuery} onSelect={handleSearchSelect} />}
            </div>
          </div>
          <div className="ml-4 flex items-center gap-3">
            <button className="text-[12px] font-medium text-slate-700 hover:text-slate-950">Docs</button>
            <button className="relative flex h-9 w-9 items-center justify-center rounded text-slate-500 hover:bg-slate-100">
              <Bell className="h-4 w-4" />
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-orange-500" />
            </button>
            {activePage !== "engine" && (
              <button
                onClick={() => navigateTo("/engine")}
                className="flex items-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-brand-700"
              >
                <Play className="h-3.5 w-3.5" />
                Start Governance Run
              </button>
            )}
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#111827] text-[11px] font-bold text-white">MO</div>
            <div className="hidden leading-tight lg:block">
              <p className="text-[12px] font-semibold text-slate-950">M. Okafor</p>
              <p className="text-[10px] text-slate-500">Compliance Lead</p>
            </div>
            <ChevronDown className="h-4 w-4 text-slate-500" />
            <FileText className="hidden h-4 w-4 text-slate-400 xl:block" />
          </div>
        </header>

        <main className={isEngine ? "" : "p-6"}>
          {!isEngine && !headerHidden && (
            <div className="mb-6 border-b border-[#e7e9f0] pb-5 dark:border-white/10">
              <div className="flex items-center gap-1.5 text-[11px] text-ink-4">
                <span>GovernAI</span>
                <span className="opacity-50">/</span>
                <span className="text-ink-3 dark:text-slate-400">{sectionFor(activePage)}</span>
                <span className="opacity-50">/</span>
                <span className="font-medium text-ink-2 dark:text-slate-200">{current?.label}</span>
              </div>
              <div className="mt-3 flex items-start justify-between gap-4">
                <div>
                  <h1 className="font-display text-[30px] leading-tight text-ink dark:text-slate-50">{current?.label}</h1>
                  <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-ink-3 dark:text-slate-400">{pageDescriptions[activePage]}</p>
                </div>
              </div>
            </div>
          )}
          <div key={activePage} className={isEngine ? "" : "animate-rise"}>{children}</div>
        </main>
      </div>
    </div>
  );
}

const pageDescriptions: Record<PageId, string> = {
  dashboard: "Real-time governance overview - KPIs, risk trends, compliance posture, and agent performance at a glance.",
  systems: "All registered AI systems bound to owners, risk tiers, and frameworks. Click any row to inspect the current governance posture.",
  engine: "The end-to-end governance engine — five layers from context assembly and adaptive probe planning through specialist findings, council deliberation, confidence-bounded action, and sealed ledger evidence. Switch targets and run a live audit.",
  runs: "Live pipeline execution for active governance runs. Shows agent status, findings, and the full 5-stage evaluation flow.",
  agents: "Specialist agents currently probing, testing, and mapping evidence. Expand each agent to see checks, methods, findings, and remediation.",
  "metric-plan": "The orchestrator-selected metric plan for the current run — tools, owner agents, framework clauses, probe budgets, and thresholds. Review before execution.",
  council: "Multi-step deliberation that synthesises agent findings into a verdict. Each step is expandable with full reasoning and confidence impacts.",
  verdicts: "Final governance outcome for the current run - tier assignment, confidence score, risk dimensions, and prescribed remediation actions.",
  reports: "Clause-level compliance reports across EU AI Act, SR 11-7, and NIST AI RMF. Click rows to read clause definitions and evidence.",
  ledger: "Hash-chained, append-only audit trail of every governance action. Filter by type or search - click events to view full hash detail.",
};

function sectionFor(page: PageId) {
  if (page === "dashboard") return "Overview";
  if (page === "systems") return "Registry";
  return navigation.find((item) => item.id === page)?.section ?? "Govern";
}
