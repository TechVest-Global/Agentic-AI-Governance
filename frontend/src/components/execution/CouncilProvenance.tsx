import { AlertTriangle, CheckCircle2, CircleSlash, Link2 } from "lucide-react";
import clsx from "clsx";
import type {
  BackendFinding,
  CitationRole,
  CouncilIteration,
  SynthesisClaim,
  UnusedFinding,
} from "@/api/governanceApi";
import { DrawerSection, SeverityPill } from "@/components/execution/DrawerPrimitives";

/** How a claim used a finding. Wording is the reader-facing gloss of the role
 *  vocabulary the synthesis template enforces — see _ALLOWED_ROLES. */
const ROLE_META: Record<CitationRole, { label: string; hint: string; className: string }> = {
  primary_evidence: {
    label: "Primary evidence",
    hint: "The claim mainly rests on this finding.",
    className:
      "bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-900/30 dark:text-brand-300 dark:ring-brand-800",
  },
  corroboration: {
    label: "Corroboration",
    hint: "Independently supports a claim that already has primary evidence.",
    className:
      "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-900",
  },
  compounding_factor: {
    label: "Compounding factor",
    hint: "Makes the claim more serious in combination, but would not establish it alone.",
    className:
      "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
  },
};

const ROLE_ORDER: CitationRole[] = ["primary_evidence", "corroboration", "compounding_factor"];

function shortId(id: string): string {
  return id.slice(0, 8);
}

/** One finding as cited by a claim: what it says, who found it, how it was used. */
function CitedFinding({
  finding,
  findingId,
  role,
  onSelect,
}: {
  finding: BackendFinding | undefined;
  findingId: string;
  role: CitationRole;
  onSelect?: (findingId: string) => void;
}) {
  const meta = ROLE_META[role];
  return (
    <button
      type="button"
      onClick={() => onSelect?.(findingId)}
      title={meta.hint}
      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-left transition hover:border-brand-300 dark:hover:border-brand-700"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={clsx("rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ring-1", meta.className)}>
          {meta.label}
        </span>
        {finding ? <SeverityPill severity={finding.severity} /> : null}
        <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500">{shortId(findingId)}</span>
        {finding?.agent_name ? (
          <span className="ml-auto text-[10px] text-slate-500 dark:text-slate-400">
            {finding.agent_name.replace(/_/g, " ")}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-[12px] leading-5 text-slate-800 dark:text-slate-200">
        {finding ? finding.title : "Finding not present in this run's record."}
      </p>
    </button>
  );
}

function ClaimCard({
  claim,
  findingsById,
  onSelect,
}: {
  claim: SynthesisClaim;
  findingsById: Map<string, BackendFinding>;
  onSelect?: (findingId: string) => void;
}) {
  const ordered = [...claim.citations].sort(
    (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role),
  );
  const hasPrimary = ordered.some((c) => c.role === "primary_evidence");

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="border-b border-slate-100 dark:border-slate-700/50 bg-slate-50 dark:bg-slate-800/40 px-3 py-2.5">
        <p className="text-[12.5px] font-medium leading-5 text-slate-900 dark:text-white">{claim.statement}</p>
        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400">
          <Link2 className="h-3 w-3" />
          {ordered.length === 0
            ? "No verifiable evidence behind this claim"
            : `Rests on ${ordered.length} finding${ordered.length === 1 ? "" : "s"}`}
        </div>
      </div>
      <div className="space-y-1.5 p-2.5">
        {ordered.length === 0 ? (
          // A claim whose every citation failed verification. Saying so is the
          // point: the assertion is still on the record, but nothing backs it.
          <p className="px-1 py-1 text-[11.5px] text-red-600 dark:text-red-400">
            Every citation on this claim named a finding that does not exist in this run, and was discarded.
          </p>
        ) : (
          ordered.map((c) => (
            <CitedFinding
              key={`${claim.claim_id}-${c.finding_id}-${c.role}`}
              finding={findingsById.get(c.finding_id)}
              findingId={c.finding_id}
              role={c.role}
              onSelect={onSelect}
            />
          ))
        )}
        {ordered.length > 0 && !hasPrimary ? (
          <p className="px-1 pt-1 text-[11px] text-amber-600 dark:text-amber-400">
            No primary evidence — this claim is supported only indirectly.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** The honest headline: how much of the run's evidence this synthesis actually
 *  accounted for. Shown whether or not it is complete — a clean list of claims
 *  over silently unaccounted findings would read as rigour it hasn't earned. */
function CoverageBanner({ iteration, findingsById }: { iteration: CouncilIteration; findingsById: Map<string, BackendFinding> }) {
  const coverage = iteration.coverage;
  if (!coverage) {
    return (
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 px-3 py-2 text-[11.5px] text-slate-500 dark:text-slate-400">
        This iteration predates provenance tracking, so its narrative cannot be traced to specific findings.
      </div>
    );
  }

  const complete = coverage.is_complete;
  const Icon = complete ? CheckCircle2 : AlertTriangle;

  return (
    <div
      className={clsx(
        "rounded-lg border px-3 py-2.5",
        complete
          ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30"
          : "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30",
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className={clsx("h-4 w-4", complete ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")} />
        <p className={clsx("text-[12px] font-semibold", complete ? "text-emerald-800 dark:text-emerald-300" : "text-amber-800 dark:text-amber-300")}>
          {coverage.cited + coverage.declared_unused} of {coverage.total_findings} findings accounted for
        </p>
      </div>
      <p className="mt-1 text-[11px] leading-5 text-slate-600 dark:text-slate-400">
        {coverage.cited} cited as evidence · {coverage.declared_unused} explicitly set aside
        {coverage.unaccounted.length > 0 ? ` · ${coverage.unaccounted.length} never mentioned` : ""}
      </p>

      {coverage.unaccounted.length > 0 ? (
        <div className="mt-2 space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            Neither used nor dismissed
          </p>
          {coverage.unaccounted.map((id) => {
            const f = findingsById.get(id);
            return (
              <p key={id} className="text-[11px] text-slate-600 dark:text-slate-400">
                <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500">{shortId(id)}</span>{" "}
                {f ? f.title : "(finding no longer in the record)"}
              </p>
            );
          })}
        </div>
      ) : null}

      {coverage.invalid_citations.length > 0 ? (
        <div className="mt-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-red-700 dark:text-red-400">
            Discarded as unverifiable ({coverage.invalid_citations.length})
          </p>
          {coverage.invalid_citations.map((entry) => (
            <p key={entry} className="font-mono text-[10px] leading-5 text-red-600 dark:text-red-400">
              {entry}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function UnusedList({ items, findingsById }: { items: UnusedFinding[]; findingsById: Map<string, BackendFinding> }) {
  return (
    <div className="space-y-1.5">
      {items.map((u) => {
        const f = findingsById.get(u.finding_id);
        return (
          <div
            key={u.finding_id}
            className="flex items-start gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/30 px-3 py-2"
          >
            <CircleSlash className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
            <div className="min-w-0">
              <p className="text-[12px] leading-5 text-slate-700 dark:text-slate-300">
                {f ? f.title : u.finding_id}
              </p>
              <p className="text-[10.5px] text-slate-500 dark:text-slate-400">
                Set aside — {u.reason.replace(/_/g, " ")}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Synthesis provenance for one council iteration: what it claimed, which
 *  findings each claim rests on and how, and what it left on the table. */
export function CouncilProvenance({
  iteration,
  findings,
  onSelectFinding,
}: {
  iteration: CouncilIteration | null;
  findings: BackendFinding[];
  onSelectFinding?: (findingId: string) => void;
}) {
  if (!iteration) {
    return (
      <p className="text-[12px] text-slate-500 dark:text-slate-400">
        No council iteration recorded in the state log for this run yet.
      </p>
    );
  }

  const findingsById = new Map(findings.map((f) => [f.id, f]));

  return (
    <>
      <DrawerSection label={`Evidence coverage · iteration ${iteration.iteration}`}>
        <CoverageBanner iteration={iteration} findingsById={findingsById} />
      </DrawerSection>

      <DrawerSection label={`Claims and the findings behind them (${iteration.claims.length})`}>
        {iteration.claims.length === 0 ? (
          <p className="text-[12px] text-slate-500 dark:text-slate-400">
            This synthesis produced no traceable claims — its narrative below cannot be tied to specific findings.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {iteration.claims.map((claim) => (
              <ClaimCard key={claim.claim_id} claim={claim} findingsById={findingsById} onSelect={onSelectFinding} />
            ))}
          </div>
        )}
      </DrawerSection>

      {iteration.unused_findings.length > 0 ? (
        <DrawerSection label={`Deliberately not used (${iteration.unused_findings.length})`}>
          <UnusedList items={iteration.unused_findings} findingsById={findingsById} />
        </DrawerSection>
      ) : null}
    </>
  );
}
