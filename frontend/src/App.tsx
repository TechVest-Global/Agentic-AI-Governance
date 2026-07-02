import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { useAppStore } from "@/store/useAppStore";
import { useAuthStore } from "@/store/useAuthStore";
import { useThemeStore } from "@/store/useThemeStore";
import { canAccess, defaultPageFor, personaForRole } from "@/lib/persona";
import { Dashboard } from "@/pages/Dashboard";
import { AISystems } from "@/pages/AISystems";
import { AuditLedger } from "@/pages/AuditLedger";
import { CouncilDeliberation } from "@/pages/CouncilDeliberation";
import { Evidence } from "@/pages/Evidence";
import { EvaluationRuns } from "@/pages/EvaluationRuns";
import { GovernanceEngine } from "@/pages/GovernanceEngine";
import { LiveRuns } from "@/pages/LiveRuns";
import { Reports } from "@/pages/Reports";
import { Verdicts } from "@/pages/Verdicts";
import { MetricPlan } from "@/pages/MetricPlan";
import { MetricResults } from "@/pages/MetricResults";
import { FindingsReview } from "@/pages/FindingsReview";
import { LLMClientBoundary } from "@/pages/LLMClientBoundary";
import { SecurityToolAdapters } from "@/pages/SecurityToolAdapters";
import { AISystemSetup } from "@/pages/AISystemSetup";
import { ApplicationContextProfiles } from "@/pages/ApplicationContextProfiles";
import { Capabilities } from "@/pages/Capabilities";
import { MetricsConfiguration } from "@/pages/MetricsConfiguration";
import { FrameworkMapping } from "@/pages/FrameworkMapping";
import { GovernanceStatePage } from "@/pages/GovernanceStatePage";
import { APIDebug } from "@/pages/APIDebug";
import { SignIn } from "@/pages/SignIn";
import { SignUp } from "@/pages/SignUp";
import type { PageId } from "@/types";

const pages = {
  dashboard: Dashboard,
  systems: AISystems,
  "eval-runs": EvaluationRuns,
  engine: GovernanceEngine,
  runs: LiveRuns,
  "metric-plan": MetricPlan,
  council: CouncilDeliberation,
  findings: FindingsReview,
  "metric-results": MetricResults,
  verdicts: Verdicts,
  reports: Reports,
  evidence: Evidence,
  ledger: AuditLedger,
  "system-setup": AISystemSetup,
  "context-profiles": ApplicationContextProfiles,
  capabilities: Capabilities,
  "metrics-config": MetricsConfiguration,
  "framework-mapping": FrameworkMapping,
  "llm-boundary": LLMClientBoundary,
  "security-tools": SecurityToolAdapters,
  "governance-state": GovernanceStatePage,
  "api-debug": APIDebug,
} satisfies Record<PageId, React.ComponentType>;

export default function App() {
  const activePage = useAppStore((state) => state.activePage);
  const setRouteFromPath = useAppStore((state) => state.setRouteFromPath);
  const navigateTo = useAppStore((state) => state.navigateTo);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const role = useAuthStore((state) => state.user?.role);

  // Boot theme from persisted store on first render
  useThemeStore((state) => state.theme);

  const [authView, setAuthView] = useState<"signin" | "signup">("signin");

  const persona = personaForRole(role);

  useEffect(() => {
    setRouteFromPath(window.location.pathname);
    const handlePopState = () => setRouteFromPath(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [setRouteFromPath]);

  // Strict role lock: if the persona may not see the active page, bounce them
  // to their default workspace page. Covers deep links and back/forward nav.
  useEffect(() => {
    if (isAuthenticated && !canAccess(persona, activePage)) {
      navigateTo(`/${defaultPageFor(persona)}`);
    }
  }, [isAuthenticated, persona, activePage, navigateTo]);

  if (!isAuthenticated) {
    if (authView === "signup") {
      return <SignUp onSwitchToSignIn={() => setAuthView("signin")} />;
    }
    return <SignIn onSwitchToSignUp={() => setAuthView("signup")} />;
  }

  const Page = canAccess(persona, activePage) ? pages[activePage] : pages[defaultPageFor(persona)];

  return (
    <AppShell>
      <Page />
    </AppShell>
  );
}
