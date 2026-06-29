import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { useAppStore } from "@/store/useAppStore";
import { useAuthStore } from "@/store/useAuthStore";
import { useThemeStore } from "@/store/useThemeStore";
import { Dashboard } from "@/pages/Dashboard";
import { AISystems } from "@/pages/AISystems";
import { AgentIntelligence } from "@/pages/AgentIntelligence";
import { AuditLedger } from "@/pages/AuditLedger";
import { CouncilDeliberation } from "@/pages/CouncilDeliberation";
import { GovernanceEngine } from "@/pages/GovernanceEngine";
import { LiveRuns } from "@/pages/LiveRuns";
import { Reports } from "@/pages/Reports";
import { Verdicts } from "@/pages/Verdicts";
import { MetricPlan } from "@/pages/MetricPlan";
import { SignIn } from "@/pages/SignIn";
import { SignUp } from "@/pages/SignUp";
import { ApplicationContextProfile } from "@/pages/ApplicationContextProfile";
import { NewRun } from "@/pages/NewRun";

const pages = {
  dashboard: Dashboard,
  systems: AISystems,
  context: ApplicationContextProfile,
  "new-run": NewRun,
  engine: GovernanceEngine,
  runs: LiveRuns,
  agents: AgentIntelligence,
  "metric-plan": MetricPlan,
  council: CouncilDeliberation,
  verdicts: Verdicts,
  reports: Reports,
  ledger: AuditLedger,
};

export default function App() {
  const activePage = useAppStore((state) => state.activePage);
  const setRouteFromPath = useAppStore((state) => state.setRouteFromPath);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  // Boot theme from persisted store on first render
  useThemeStore((state) => state.theme);

  const [authView, setAuthView] = useState<"signin" | "signup">("signin");

  const Page = pages[activePage];

  useEffect(() => {
    setRouteFromPath(window.location.pathname);
    const handlePopState = () => setRouteFromPath(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [setRouteFromPath]);

  if (!isAuthenticated) {
    if (authView === "signup") {
      return <SignUp onSwitchToSignIn={() => setAuthView("signin")} />;
    }
    return <SignIn onSwitchToSignUp={() => setAuthView("signup")} />;
  }

  return (
    <AppShell>
      <Page />
    </AppShell>
  );
}
