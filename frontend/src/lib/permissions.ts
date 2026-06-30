import type { Permission, Persona } from "@/types";
import { personaForRole } from "@/lib/persona";

/**
 * Capability matrix per persona.
 *
 * Auditor   = governance / compliance / review / reporting.
 * Developer = everything the auditor can do, plus technical setup, execution,
 *             security adapters, and debug.
 */
const PERMISSIONS: Record<Persona, Record<Permission, boolean>> = {
  auditor: {
    canViewTechnicalConfig: false,
    canEditAISystem: false,
    canRunEvaluation: true,
    canRunSecurityTools: false,
    canReviewFindings: true,
    canExportReports: true,
  },
  developer: {
    canViewTechnicalConfig: true,
    canEditAISystem: true,
    canRunEvaluation: true,
    canRunSecurityTools: true,
    canReviewFindings: true,
    canExportReports: true,
  },
};

export function can(persona: Persona, permission: Permission): boolean {
  return PERMISSIONS[persona][permission];
}

/** Convenience: resolve persona from a role string, then check a permission. */
export function roleCan(role: string | undefined | null, permission: Permission): boolean {
  return can(personaForRole(role), permission);
}

export function permissionsFor(persona: Persona): Record<Permission, boolean> {
  return PERMISSIONS[persona];
}
