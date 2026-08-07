import { Fragment, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Gauge,
  Layers,
  Network,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import clsx from "clsx";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { MetricCard } from "@/components/ui/MetricCard";
import { listFrameworkMappings, type FrameworkMapping as FrameworkMappingType } from "@/api/governanceApi";
import { metricBlurb, metricName } from "@/data/metricCatalog";

function labelize(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const ALL = "__all__";

export function FrameworkMapping() {
  const [mappings, setMappings] = useState<FrameworkMappingType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeFramework, setActiveFramework] = useState<string>(ALL);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);
        setMappings(await listFrameworkMappings({ limit: 200 }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load framework mappings.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const frameworkNames = useMemo(
    () => Array.from(new Set(mappings.map((m) => m.framework_name))).sort(),
    [mappings],
  );

  const filtered = useMemo(
    () => (activeFramework === ALL ? mappings : mappings.filter((m) => m.framework_name === activeFramework)),
    [mappings, activeFramework],
  );

  const coverage = useMemo(() => {
    const distinctMetrics = new Set<string>();
    let covered = 0;
    for (const m of mappings) {
      if (m.metric_ids.length > 0) {
        covered += 1;
        m.metric_ids.forEach((id) => distinctMetrics.add(id));
      }
    }
    return {
      total: mappings.length,
      distinctMetrics: distinctMetrics.size,
      covered,
      uncovered: mappings.length - covered,
    };
  }, [mappings]);

  const grouped = useMemo(() => {
    const map = new Map<string, FrameworkMappingType[]>();
    for (const m of filtered) {
      const arr = map.get(m.framework_name) ?? [];
      arr.push(m);
      map.set(m.framework_name, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Total Controls" value={coverage.total} icon={Layers} compact />
        <MetricCard label="Distinct Metrics" value={coverage.distinctMetrics} icon={Gauge} tone="blue" compact />
        <MetricCard label="Covered (≥1 metric)" value={coverage.covered} icon={ShieldCheck} tone="green" compact detail="controls with metric coverage" />
        <MetricCard label="Uncovered" value={coverage.uncovered} icon={ShieldX} tone={coverage.uncovered > 0 ? "amber" : "slate"} compact detail="controls with no metric" />
      </div>

      <Card>
        <CardHeader eyebrow="Compliance" title="Framework Mapping" />
        <div className="px-5 py-4">
          {error && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <FilterChip label="All" active={activeFramework === ALL} onClick={() => setActiveFramework(ALL)} />
            {frameworkNames.map((name) => (
              <FilterChip key={name} label={name} active={activeFramework === name} onClick={() => setActiveFramework(name)} />
            ))}
          </div>
        </div>
      </Card>

      {loading && (
        <Card><div className="px-6 py-16 text-center text-[12px] text-slate-500 dark:text-slate-400">Loading framework mappings…</div></Card>
      )}

      {!loading && filtered.length === 0 && !error && (
        <Card>
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
            <Network className="h-8 w-8 text-slate-300 dark:text-slate-600" />
            <p className="text-[14px] font-semibold text-slate-900 dark:text-white">No controls to display</p>
            <p className="max-w-md text-[12px] text-slate-500 dark:text-slate-400">{mappings.length === 0 ? "No framework mappings are available from the backend." : "No controls match the selected framework."}</p>
          </div>
        </Card>
      )}

      {!loading && grouped.map(([name, controls]) => (
        <Card key={name} className="overflow-hidden">
          <CardHeader
            eyebrow={controls[0]?.framework_version ? `Version ${controls[0].framework_version}` : "Framework"}
            title={name}
            action={<Badge tone="slate">{controls.length} control{controls.length === 1 ? "" : "s"}</Badge>}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] border-collapse text-left">
              <thead className="bg-slate-50 dark:bg-slate-800/60">
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="w-6 px-3 py-2.5" />
                  {["Control", "Title", "Category", "Jurisdiction", "Metrics", "Agents", "Risk Tiers", "Enabled"].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {controls.map((c) => {
                  const open = expanded === c.id;
                  return (
                    <Fragment key={c.id}>
                      <tr
                        onClick={() => setExpanded(open ? null : c.id)}
                        className={clsx("group cursor-pointer border-b border-slate-100 transition-colors dark:border-slate-700/50", open ? "bg-brand-50/60 dark:bg-brand-900/20" : "hover:bg-slate-50 dark:hover:bg-slate-800/40")}
                      >
                        <td className="px-3 py-3 text-slate-400">
                          {open ? <ChevronDown className="h-4 w-4 text-brand-600" /> : <ChevronRight className="h-4 w-4 group-hover:text-slate-700 dark:group-hover:text-slate-300" />}
                        </td>
                        <td className="px-3 py-3 font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-300">{c.control_ref}</td>
                        <td className="max-w-[260px] px-3 py-3 text-[13px] font-medium text-slate-900 dark:text-white">{c.control_title ?? "—"}</td>
                        <td className="px-3 py-3">{c.control_category ? <Badge tone="violet">{labelize(c.control_category)}</Badge> : <span className="text-[11px] text-slate-400">—</span>}</td>
                        <td className="px-3 py-3 text-[12px] text-slate-700 dark:text-slate-300">{c.jurisdiction ?? "—"}</td>
                        <td className="px-3 py-3"><Badge tone={c.metric_ids.length > 0 ? "blue" : "amber"}>{c.metric_ids.length}</Badge></td>
                        <td className="px-3 py-3">
                          <div className="flex max-w-[160px] flex-wrap gap-1">
                            {c.agent_names && c.agent_names.length > 0 ? c.agent_names.map((a) => (
                              <span key={a} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">{labelize(a)}</span>
                            )) : <span className="text-[11px] text-slate-400">—</span>}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-1">
                            {c.risk_tiers && c.risk_tiers.length > 0 ? c.risk_tiers.map((r) => (
                              <span key={r} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">{labelize(r)}</span>
                            )) : <span className="text-[11px] text-slate-400">—</span>}
                          </div>
                        </td>
                        <td className="px-3 py-3"><Badge tone={c.enabled ? "green" : "slate"}>{c.enabled ? "Enabled" : "Disabled"}</Badge></td>
                      </tr>
                      {open && (
                        <tr className="border-b border-blue-100 bg-blue-50/50 dark:border-blue-900/40 dark:bg-blue-950/10">
                          <td colSpan={9} className="px-5 py-4">
                            <div className="grid gap-4 lg:grid-cols-2">
                              <div>
                                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">Requirement</p>
                                <p className="text-[12px] leading-5 text-slate-700 dark:text-slate-300">{c.requirement_text ?? "No requirement text provided."}</p>
                                {c.metric_ids.length > 0 && (
                                  <div className="mt-3">
                                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">Mapped Metrics</p>
                                    <div className="flex flex-wrap gap-1">
                                      {/* A control's mapped metrics read as names;
                                          the id stays as a tooltip for traceability. */}
                                      {c.metric_ids.map((id) => (
                                        <span
                                          key={id}
                                          title={`${id} — ${metricBlurb(id, metricName(id))}`}
                                          className="cursor-help rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
                                        >
                                          {metricName(id)}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                              <div>
                                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">Evidence Requirements</p>
                                {c.evidence_requirements && c.evidence_requirements.length > 0 ? (
                                  <ul className="list-disc space-y-1 pl-4 text-[12px] leading-5 text-slate-700 dark:text-slate-300">
                                    {c.evidence_requirements.map((e, i) => <li key={i}>{e}</li>)}
                                  </ul>
                                ) : (
                                  <p className="text-[12px] text-slate-400 dark:text-slate-500">None specified.</p>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors",
        active
          ? "border-brand-500 bg-brand-50 text-brand-800 dark:border-brand-600 dark:bg-brand-900/40 dark:text-brand-300"
          : "border-slate-300 bg-white text-slate-700 hover:border-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-500",
      )}
    >
      {label}
    </button>
  );
}
