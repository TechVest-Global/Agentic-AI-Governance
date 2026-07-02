import { useEffect, useRef, useState } from "react";
import {
  Bell, ChevronDown, LogOut, Moon, PanelLeft, PanelLeftClose,
  Play, Search, Shield, Sun, X,
} from "lucide-react";
import clsx from "clsx";
import { SearchOverlay } from "@/components/SearchOverlay";
import { RunSwitcher } from "@/components/layout/RunSwitcher";
import { navigation } from "@/data/mockData";
import type { PageId as PageIdType } from "@/types";

// Pages that display data scoped to a single evaluation run — they share the
// global run switcher in the header.
const RUN_SCOPED: ReadonlySet<PageIdType> = new Set<PageIdType>([
  "runs", "agents", "metric-plan", "council", "findings", "metric-results",
  "verdicts", "reports", "evidence", "ledger", "governance-state", "llm-boundary",
]);
import { useAppStore } from "@/store/useAppStore";
import { useAuthStore } from "@/store/useAuthStore";
import { useThemeStore } from "@/store/useThemeStore";
import { PERSONA_LABEL, personaForRole } from "@/lib/persona";
import type { PageId } from "@/types";

export function AppShell({ children }: { children: React.ReactNode }) {
  const activePage   = useAppStore((s) => s.activePage);
  const navigateTo   = useAppStore((s) => s.navigateTo);
  const headerHidden = useAppStore((s) => s.headerHidden);

  const { user, signOut }     = useAuthStore();
  const { theme, toggleTheme } = useThemeStore();

  const persona    = personaForRole(user?.role);
  // Sidebar shows persona-visible, non-hidden items. Hidden pages (folded into
  // the Governance Workflow) stay routable via drawers + deep links.
  const navItems   = navigation.filter((item) => item.personas.includes(persona) && !item.hidden && !item.hiddenFor?.includes(persona));
  // Resolve the active item from the full nav (hidden pages still render via deep link).
  const current    = navigation.find((item) => item.id === activePage);
  const isEngine    = activePage === "engine";
  // Both personas can start a run. Developers get the engine walkthrough;
  // auditors land on the registry to pick a target and run an evaluation.
  const startRunPath = persona === "auditor" ? "/systems" : "/engine";

  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen,  setSearchOpen]  = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.innerWidth >= 1024;
  });
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const userMenuRef    = useRef<HTMLDivElement>(null);

  // Keyboard: Ctrl+K opens search, Escape closes overlays
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
        searchInputRef.current?.focus();
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
        setUserMenuOpen(false);
        searchInputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Close user menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSearchSelect = (path: string) => {
    navigateTo(path);
    setSearchQuery("");
    setSearchOpen(false);
    searchInputRef.current?.blur();
  };

  const displayName = user?.name ?? "User";
  const displayRole = user?.role ?? "";
  const initials    = user?.initials ?? displayName.slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen bg-[#f6f7fb] dark:bg-[#0c1120] text-ink dark:text-slate-200 transition-colors duration-200">

      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <aside className={clsx(
        "fixed inset-y-0 left-0 z-50 flex w-60 flex-col bg-[#0f1626] dark:bg-[#080d18] text-slate-100 transition-transform duration-300",
        !sidebarOpen && "-translate-x-full"
      )}>
        {/* logo */}
        <div className="flex h-14 items-center gap-3 border-b border-white/10 px-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand-600 text-white">
            <Shield className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold leading-tight text-white">GovernAI</p>
            <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-slate-400">{PERSONA_LABEL[persona]}</p>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="rounded p-1 text-slate-500 hover:bg-white/5 hover:text-slate-300"
            aria-label="Collapse navigation"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>

        {/* nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-5">
          {(["Govern", "Assurance", "Configure", "Operate"] as const)
            .filter((section) => navItems.some((item) => item.section === section))
            .map((section) => (
            <div key={section} className="mb-6">
              <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">{section}</p>
              <div className="space-y-1">
                {navItems
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
                      {item.badge && (
                        <span className="rounded bg-orange-700/70 px-1.5 py-0.5 text-[10px] text-orange-100">{item.badge}</span>
                      )}
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </nav>

        {/* tenant */}
        <div className="border-t border-white/10 p-3">
          <div className="rounded-md bg-slate-800/80 p-3 ring-1 ring-white/5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Tenant</p>
            <p className="mt-2 text-[12px] font-semibold text-white">Northwind Financial</p>
            <p className="mt-0.5 text-[10px] text-slate-500">org_4f8a · Enterprise</p>
          </div>
        </div>
      </aside>

      {/* ── Main area ────────────────────────────────────────────── */}
      <div className={clsx("flex min-h-screen flex-col transition-[padding] duration-300", sidebarOpen ? "lg:pl-60" : "pl-0")}>

        {/* ── Header ───────────────────────────────────────────── */}
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-[#e7e9f0] dark:border-white/10 bg-white/90 dark:bg-[#0f1626]/90 px-4 backdrop-blur-md transition-colors duration-200">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-700 dark:hover:text-white transition-colors"
              aria-label="Toggle navigation"
            >
              <PanelLeft className="h-4 w-4" />
            </button>

            {/* search */}
            <div className="relative hidden w-full max-w-xl sm:block">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
                onFocus={() => setSearchOpen(true)}
                onBlur={() => window.setTimeout(() => setSearchOpen(false), 120)}
                className="h-9 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 pl-9 pr-12 text-[13px] text-slate-900 dark:text-slate-100 outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-brand-500 focus:bg-white dark:focus:bg-slate-700 focus:ring-2 focus:ring-brand-100 dark:focus:ring-brand-700/40 transition-colors"
                placeholder="Jump to a page…"
              />
              {searchQuery ? (
                <button
                  className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600 hover:text-slate-700 dark:hover:text-white"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setSearchQuery(""); searchInputRef.current?.focus(); }}
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : (
                <kbd className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                  Ctrl K
                </kbd>
              )}
              {searchOpen && <SearchOverlay query={searchQuery} onSelect={handleSearchSelect} persona={persona} />}
            </div>
          </div>

          <div className="ml-4 flex items-center gap-2">
            {RUN_SCOPED.has(activePage) && <RunSwitcher />}

            {/* theme toggle */}
            <button
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-700 dark:hover:text-white transition-colors"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            {/* notifications */}
            <button className="relative hidden h-9 w-9 items-center justify-center rounded text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-700 dark:hover:text-white transition-colors sm:flex">
              <Bell className="h-4 w-4" />
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-orange-500" />
            </button>

            {/* start run button */}
            {!isEngine && (
              <button
                onClick={() => navigateTo(startRunPath)}
                className="hidden items-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2 text-[13px] font-semibold text-white transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 sm:flex"
              >
                <Play className="h-3.5 w-3.5" />
                Start Governance Run
              </button>
            )}

            {/* user menu */}
            <div ref={userMenuRef} className="relative">
              <button
                onClick={() => setUserMenuOpen((v) => !v)}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
                aria-haspopup="true"
                aria-expanded={userMenuOpen}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#111827] dark:bg-brand-700 text-[11px] font-bold text-white shrink-0">
                  {initials}
                </div>
                <div className="hidden leading-tight lg:block text-left">
                  <p className="text-[12px] font-semibold text-slate-900 dark:text-white">{displayName}</p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">{displayRole}</p>
                </div>
                <ChevronDown className={clsx("h-4 w-4 text-slate-500 dark:text-slate-400 transition-transform", userMenuOpen && "rotate-180")} />
              </button>

              {userMenuOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-48 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg dark:shadow-black/40 py-1 z-50 animate-fade-in">
                  <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-700">
                    <p className="text-[12px] font-semibold text-slate-900 dark:text-white truncate">{displayName}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{user?.email}</p>
                  </div>
                  <button
                    onClick={() => { setUserMenuOpen(false); signOut(); }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-[13px] text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                  >
                    <LogOut className="h-4 w-4 text-slate-400 dark:text-slate-500" />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* ── Page content ─────────────────────────────────────── */}
        <main className={clsx("flex-1", isEngine ? "" : "p-6")}>
          {!isEngine && !headerHidden && (
            <div className="mb-6 border-b border-[#e7e9f0] dark:border-white/10 pb-5">
              <div className="flex items-center gap-1.5 text-[11px] text-ink-4 dark:text-slate-500">
                <span>GovernAI</span>
                <span className="opacity-50">/</span>
                <span className="text-ink-3 dark:text-slate-400">{sectionFor(activePage)}</span>
                <span className="opacity-50">/</span>
                <span className="font-medium text-ink-2 dark:text-slate-200">{current?.label}</span>
              </div>
              <div className="mt-3 flex items-start justify-between gap-4">
                <div>
                  <h1 className="font-display text-[30px] leading-tight text-ink dark:text-white">{current?.label}</h1>
                  <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-ink-3 dark:text-slate-400">
                    {activePage === "dashboard" && persona === "auditor"
                      ? "Compliance posture at a glance — KPIs, framework coverage, risk distribution, and governance outcomes across your AI systems."
                      : pageDescriptions[activePage]}
                  </p>
                </div>
              </div>
            </div>
          )}
          <div key={activePage} className={isEngine ? "" : "animate-rise"}>
            {children}
          </div>
        </main>

        {/* ── Footer ───────────────────────────────────────────── */}
        <footer className="border-t border-[#e7e9f0] dark:border-white/10 bg-white dark:bg-[#0a0f1c] transition-colors duration-200 px-6 py-4">
          <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-brand-600 text-white">
                <Shield className="h-3 w-3" />
              </div>
              <span className="text-[12px] font-semibold text-slate-700 dark:text-slate-300">GovernAI</span>
              <span className="text-[11px] text-slate-400 dark:text-slate-600">·</span>
              <span className="text-[11px] text-slate-400 dark:text-slate-600">Output-only AI Governance Engine</span>
            </div>
            <div className="flex items-center gap-4 text-[11px] text-slate-400 dark:text-slate-600">
              <span className="hover:text-slate-600 dark:hover:text-slate-400 cursor-pointer transition-colors">Privacy Policy</span>
              <span className="hover:text-slate-600 dark:hover:text-slate-400 cursor-pointer transition-colors">Terms of Service</span>
              <span className="hover:text-slate-600 dark:hover:text-slate-400 cursor-pointer transition-colors">Documentation</span>
              <span>© {new Date().getFullYear()} GovernAI</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

const pageDescriptions: Record<PageId, string> = {
  dashboard:      "Real-time governance overview — KPIs, risk trends, compliance posture, and agent performance at a glance.",
  systems:        "Registered AI systems with edit, run, and delete — plus end-to-end registration across identity, context, ownership, frameworks, models, endpoints, data, risk, metrics, monitoring, and alerts.",
  engine:         "End-to-end walkthrough of the governance engine — five layers from context assembly through specialist findings, council deliberation, confidence-bounded action, and sealed ledger evidence.",
  runs:           "End-to-end governance flow for the selected run — expand each pipeline layer and open any agent, the council, verdict, evidence, or ledger entry in place.",
  agents:         "Specialist agents currently probing, testing, and mapping evidence. Expand each agent to see checks, methods, findings, and remediation.",
  "metric-plan":  "Orchestrator-selected metric plan for the current run — tools, owner agents, framework clauses, probe budgets, and thresholds.",
  council:        "Multi-step deliberation that synthesises agent findings into a verdict. Each step is expandable with full reasoning and confidence impacts.",
  verdicts:       "Final governance outcome for the current run — tier assignment, confidence score, risk dimensions, and prescribed remediation actions.",
  reports:        "Clause-level compliance reports across EU AI Act, NIST AI RMF, ISO 42001, and OWASP LLM Top 10. Click rows to read clause definitions and evidence.",
  evidence:       "Evidence records behind every finding and metric result — source, tool, score vs. threshold, pass/fail, and sensitivity. The audit-grade proof layer.",
  ledger:         "Hash-chained, append-only audit trail of every governance action. Filter by type or search — click events to view full hash detail.",
  "eval-runs":    "Historical governance evaluations — status, phase, frameworks, timestamps, and result. Drill into any run's findings, verdict, and evidence.",
  findings:       "All findings raised by metrics and specialist agents — severity, confidence, framework refs, and evidence. Review, accept, or request remediation.",
  "metric-results": "Scored metric outcomes — dimension, tool, normalized score vs. threshold, pass/fail, and the evidence each result links to.",
  "system-setup": "Create and configure AI systems — identity, owner, risk tier, frameworks, model configuration, and target endpoint reference.",
  "context-profiles": "Application Context Profiles — identity & purpose, pre-model controls, model configuration, post-model controls, and integration context.",
  capabilities:   "Callable capabilities per AI system — endpoint, method, schemas, permissions, side-effect level, and human-review requirement.",
  "metrics-config": "The 44-metric catalog — dimension, owner agent, tool, framework mappings, threshold rules, scoring config, and enabled state.",
  "framework-mapping": "Framework-to-control mapping — EU AI Act, NIST AI RMF, ISO 42001, OWASP LLM Top 10, SR 11-7, OECD — with metric coverage and evidence requirements.",
  "llm-boundary": "The trust boundary: Governance Model Client vs. Target Model Client. Target output is untrusted and fenced as evidence after sanitization.",
  "security-tools": "Security tool adapters — Custom Boundary Test, garak, PyRIT, Inspect AI, CyberSecEval, prompt-injection scanners, tracing, and policy tests.",
  "governance-state": "Append-only GovernanceState chain — sequence, phase, source, payload, and hash linkage. The reconstruction record for any run.",
  "api-debug":    "Integration status — API health, route-to-endpoint mapping, role permissions, and request/response inspection for the FastAPI backend.",
};

function sectionFor(page: PageId) {
  if (page === "dashboard") return "Overview";
  if (page === "systems")   return "Registry";
  return navigation.find((item) => item.id === page)?.section ?? "Govern";
}
