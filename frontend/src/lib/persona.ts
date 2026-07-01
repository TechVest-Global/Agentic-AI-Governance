import type { PageId, Persona } from "@/types";
import { navigation } from "@/data/mockData";

/**
 * Roles that map to the Auditor persona (compliance / assurance view).
 * Every other role — Data Scientist, ML Engineer, Administrator, etc. —
 * maps to the Developer persona (full governance-engine view).
 *
 * This is a STRICT role lock: an auditor can see assurance workflows and the
 * live run overview, but cannot reach deep engine-internal pages such as How It
 * Works, Agent Intelligence, Metric Plan, Council, Configure, or Operate.
 */
export const AUDITOR_ROLES = [
  "Auditor",
  "Compliance Lead",
  "Legal Counsel",
  "AI Risk Officer",
] as const;

export function personaForRole(role: string | undefined | null): Persona {
  if (!role) return "developer";
  return (AUDITOR_ROLES as readonly string[]).includes(role) ? "auditor" : "developer";
}

/**
 * Pages each persona may open, derived from the single navigation config so
 * the route guard can never drift from the sidebar. Auditors are excluded from
 * deep engine-internal pages: How It Works, Agent Intelligence, Metric Plan,
 * Council, and all Configure/Operate pages.
 */
export const PERSONA_PAGES: Record<Persona, PageId[]> = {
  auditor: navigation.filter((i) => i.personas.includes("auditor")).map((i) => i.id),
  developer: navigation.filter((i) => i.personas.includes("developer")).map((i) => i.id),
};

export function canAccess(persona: Persona, page: PageId): boolean {
  const item = navigation.find((i) => i.id === page);
  return item ? item.personas.includes(persona) : false;
}

/** Landing page for a persona after login or when redirected from a blocked page. */
export function defaultPageFor(_persona: Persona): PageId {
  return "dashboard";
}

export const PERSONA_LABEL: Record<Persona, string> = {
  auditor: "Auditor workspace",
  developer: "Engineering workspace",
};
