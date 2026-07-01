import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy, Hash, Search, Shield } from "lucide-react";
import clsx from "clsx";
import { auditEvents } from "@/data/mockData";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useGovernanceBackend } from "@/hooks/useGovernanceBackend";

type EventType = string;

const typeColors: Record<string, string> = {
  "agent-finding": "border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950/50 dark:text-red-400",
  "framework-check": "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950/50 dark:text-blue-400",
  "drift-check": "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-400",
  "plan-update": "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-950/50 dark:text-violet-400",
};

const typeDescriptions: Record<string, string> = {
  "agent-finding": "A specialist agent logged a probe result and finding into the ledger.",
  "framework-check": "A framework compliance check was completed and the result recorded.",
  "drift-check": "A semantic or behavioral drift measurement was recorded against baseline.",
  "plan-update": "The orchestrator updated the probe plan or reallocated budget.",
};

export function AuditLedger() {
  const backend = useGovernanceBackend();
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<EventType>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const backendEvents = useMemo(
    () =>
      backend.ledgerEntries.map((entry) => ({
        id: entry.id,
        timestamp: new Date(entry.created_at).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        actor: entry.actor_id ?? entry.actor_type,
        type: entry.event_type,
        description: describeLedgerEntry(entry.event_type, entry.payload),
        hash: entry.entry_hash,
        parentHash: entry.previous_hash ?? "GENESIS",
      })),
    [backend.ledgerEntries],
  );
  const events = backendEvents.length ? backendEvents : auditEvents;
  const typeOptions = ["All", ...Array.from(new Set(events.map((event) => event.type)))];

  const filteredEvents = events.filter((event) => {
    const matchesType = activeType === "All" || event.type === activeType;
    const matchesSearch =
      searchQuery === "" ||
      event.actor.toLowerCase().includes(searchQuery.toLowerCase()) ||
      event.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      event.type.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesType && matchesSearch;
  });

  function copyHash(hash: string) {
    navigator.clipboard.writeText(hash).catch(() => {});
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 1500);
  }

  return (
    <div className="space-y-5">
      {/* Intro */}
      <div className="flex items-start justify-between border-b border-slate-200 dark:border-slate-700 pb-5">
        <div className="max-w-2xl space-y-1">
          <p className="text-[13px] leading-5 text-slate-600 dark:text-slate-300">
          Every governance action is recorded as an append-only, hash-chained entry. When the backend is running, this page reads the latest run's ledger and verification endpoint directly.
          </p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500">Click events to expand · Copy hashes for chain verification · Filter by event type or search by keyword</p>
        </div>
        <Badge tone={backend.ledgerVerification?.valid === false ? "red" : "green"}>
          <Shield className="h-3 w-3" />
          {backend.ledgerVerification
            ? backend.ledgerVerification.valid
              ? `Chain Verified (${backend.ledgerVerification.entry_count})`
              : "Chain Invalid"
            : backend.loading
              ? "Checking Chain"
              : "Prototype Ledger"}
        </Badge>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search actor, description, type…"
            className="h-9 w-64 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 pl-9 pr-3 text-[12px] text-slate-900 dark:text-white outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-blue-500"
          />
        </div>
        <div className="flex gap-1.5">
          {typeOptions.map((type) => (
            <button
              key={type}
              onClick={() => setActiveType(type)}
              title={type !== "All" ? typeDescriptions[type] : "Show all event types"}
              className={clsx(
                "rounded border px-2.5 py-1 text-[11px] font-medium transition-colors",
                activeType === type
                  ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                  : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:border-slate-500 dark:hover:border-slate-500 hover:text-slate-950 dark:hover:text-white"
              )}
            >
              {type === "All" ? "All types" : type}
            </button>
          ))}
        </div>
        {filteredEvents.length !== events.length && (
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            Showing {filteredEvents.length} of {events.length} events
          </span>
        )}
      </div>

      <Card>
        <CardHeader
          title="Hash-Chained Audit Ledger"
          eyebrow={`Append-only reasoning history · ${filteredEvents.length} events`}
          action={<Badge tone={backend.ledgerVerification?.valid === false ? "red" : "green"}>{backend.usingBackend ? "Backend" : "Mock"}</Badge>}
        />

        {filteredEvents.length === 0 && (
          <div className="px-4 py-8 text-center text-[13px] text-slate-400 dark:text-slate-500">
            No events match the current filter. Try changing the type or search query.
          </div>
        )}

        <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
          {filteredEvents.map((event, index) => {
            const isExpanded = expandedEvent === event.id;
            const isLast = index === filteredEvents.length - 1;
            return (
              <div key={event.id}>
                <button
                  onClick={() => setExpandedEvent(isExpanded ? null : event.id)}
                  className="flex w-full items-start gap-4 px-4 py-4 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  {/* Timeline dot */}
                  <div className="relative flex flex-col items-center">
                    <div className="h-2.5 w-2.5 rounded-full bg-blue-700 ring-2 ring-blue-200 dark:ring-blue-900" />
                    {!isLast && <div className="mt-1.5 h-full w-px bg-slate-200 dark:bg-slate-700" />}
                  </div>

                  {/* Content */}
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[12px] font-semibold text-slate-950 dark:text-white">{event.timestamp}</span>
                      <span className={clsx("rounded border px-1.5 py-0.5 text-[10px] font-medium", typeColors[event.type] ?? "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400")}>
                        {event.type}
                      </span>
                      <span className="text-[12px] font-semibold text-slate-700 dark:text-slate-300">{event.actor}</span>
                    </div>
                    <p className="mt-1 text-[12px] leading-5 text-slate-700 dark:text-slate-300">{event.description}</p>
                    <p className="mt-1 font-mono text-[10px] text-slate-400 dark:text-slate-500">{event.hash}</p>
                  </div>

                  {isExpanded
                    ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
                    : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />}
                </button>

                {isExpanded && (
                  <div className="border-t border-slate-100 dark:border-slate-700/50 bg-slate-50 dark:bg-slate-800 px-4 py-3">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Event Description</p>
                        <p className="mt-1 text-[12px] leading-5 text-slate-700 dark:text-slate-300">{event.description}</p>
                        <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Event Type</p>
                        <p className="mt-1 text-[12px] text-slate-700 dark:text-slate-300">{typeDescriptions[event.type] ?? "Governance action recorded."}</p>
                      </div>
                      <div className="space-y-3">
                        <div className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              <Hash className="h-3 w-3" /> Current Hash
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); copyHash(event.hash); }}
                              className="flex items-center gap-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1 text-[10px] text-slate-600 dark:text-slate-400 transition-colors hover:bg-slate-100 dark:hover:bg-slate-700"
                            >
                              {copiedHash === event.hash
                                ? <><Check className="h-3 w-3 text-emerald-600" /> Copied</>
                                : <><Copy className="h-3 w-3" /> Copy</>}
                            </button>
                          </div>
                          <p className="mt-1.5 font-mono text-[12px] text-slate-950 dark:text-white">{event.hash}</p>
                        </div>
                        <div className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Parent Hash</p>
                          <p className="mt-1.5 font-mono text-[11px] text-slate-700 dark:text-slate-300">{event.parentHash}</p>
                          <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">This event is linked to the previous entry in the chain. Any modification to the previous entry would invalidate this hash.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function describeLedgerEntry(eventType: string, payload: Record<string, unknown>) {
  const label = eventType.replace(/_/g, " ").replace(/\./g, " ");
  const phase = typeof payload.phase === "string" ? ` during ${payload.phase}` : "";
  const count =
    typeof payload.metric_results_created === "number"
      ? `${payload.metric_results_created} metric results`
      : typeof payload.findings_created === "number"
        ? `${payload.findings_created} findings`
        : typeof payload.label === "string"
          ? `verdict ${payload.label}`
          : "governance evidence";
  return `${label} recorded ${count}${phase}.`;
}
