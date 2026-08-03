/**
 * Single source of truth for evaluation-run status classification.
 *
 * Mirrors `RunStatus` in backend/app/models/enums.py. Before this module,
 * seven components each kept their own inline status list and they disagreed
 * with each other — `degraded` was missing from four of them, `report_ready`
 * from two. Two concrete bugs came out of that drift:
 *
 *   - The notification poller treated `failed`/`cancelled` as verdict-bearing
 *     and requested a verdict for runs that can never have one, producing a
 *     guaranteed 404 per run every poll.
 *   - The same poller (and the dashboard's active-run count) left `degraded`
 *     out of "terminal", so degraded runs — which DO carry a verdict and a
 *     report — were invisible in notifications and counted as forever-running.
 *
 * The distinction that actually matters is not one set but three: is the run
 * over, did it produce a verdict, and did it end badly. Ask via the helpers
 * below rather than re-deriving a list at the call site.
 */

/** Terminal states that produce a verdict and a governance report. */
const VERDICT_BEARING: ReadonlySet<string> = new Set([
  "completed",
  "report_ready",
  // A degraded run is one where the council or report step failed but the
  // evidence and verdict survived — it is finished AND adjudicated, so it
  // belongs here, not with the failures.
  "degraded",
]);

/** Terminal states that ended without ever producing a verdict. */
const UNSUCCESSFUL: ReadonlySet<string> = new Set([
  "failed",
  "cancelled",
  // The backend enum spells this "cancelled"; the US spelling is kept as a
  // defensive alias so a serialization change can't silently make a finished
  // run look active. Costs nothing, and now lives in exactly one place.
  "canceled",
]);

/** Every state a run can be in and never leave. */
const TERMINAL: ReadonlySet<string> = new Set([...VERDICT_BEARING, ...UNSUCCESSFUL]);

const normalize = (status: string | null | undefined): string => (status ?? "").toLowerCase();

/** The run will not change again — safe to stop polling it. */
export function isTerminalRunStatus(status: string | null | undefined): boolean {
  return TERMINAL.has(normalize(status));
}

/** The run is still in flight (including paused awaiting plan approval). */
export function isRunActive(status: string | null | undefined): boolean {
  return !isTerminalRunStatus(status);
}

/**
 * A verdict may exist for this run. Guard verdict/report fetches with this —
 * asking for the verdict of a `failed` run is a guaranteed 404.
 */
export function runHasVerdict(status: string | null | undefined): boolean {
  return VERDICT_BEARING.has(normalize(status));
}

/** The run finished without a verdict (failed or cancelled). */
export function isUnsuccessfulRunStatus(status: string | null | undefined): boolean {
  return UNSUCCESSFUL.has(normalize(status));
}
