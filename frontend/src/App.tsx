import { useEffect } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { useAppStore } from "@/store/useAppStore";
import { Dashboard } from "@/pages/Dashboard";
import { AISystems } from "@/pages/AISystems";
import { AgentIntelligence } from "@/pages/AgentIntelligence";
import { AuditLedger } from "@/pages/AuditLedger";
import { CouncilDeliberation } from "@/pages/CouncilDeliberation";
import { GovernanceEngine } from "@/pages/GovernanceEngine";
import { Reports } from "@/pages/Reports";
import { Verdicts } from "@/pages/Verdicts";

const pages = {
  dashboard: Dashboard,
  systems: AISystems,
  engine: GovernanceEngine,
  runs: GovernanceEngine,
  agents: AgentIntelligence,
  council: CouncilDeliberation,
  verdicts: Verdicts,
  reports: Reports,
  ledger: AuditLedger,
};

export default function App() {
  const activePage = useAppStore((state) => state.activePage);
  const setRouteFromPath = useAppStore((state) => state.setRouteFromPath);
  const Page = pages[activePage];

  useEffect(() => {
    setRouteFromPath(window.location.pathname);

    const handlePopState = () => setRouteFromPath(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [setRouteFromPath]);

  return (
    <AppShell>
      <Page />
    </AppShell>
  );
}
