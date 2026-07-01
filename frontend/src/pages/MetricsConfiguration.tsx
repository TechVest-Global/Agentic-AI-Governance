import { Fragment, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Info,
  Layers,
  ListChecks,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import clsx from "clsx";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { MetricCard } from "@/components/ui/MetricCard";
import { listMetricConfigs, type MetricConfigFull } from "@/api/governanceApi";

function labelize(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const DIMENSION_TONES = ["blue", "violet", "green", "amber", "red", "slate"] as const;
type DimensionTone = (typeof DIMENSION_TONES)[number];

export function MetricsConfiguration() {
  const [metrics, setMetrics] = useState<MetricConfigFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dimensionFilter, setDimensionFilter] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);
        setMetrics(await listMetricConfigs({ limit: 200 }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load metric configurations.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const dimensions = useMemo(
    () => Array.from(new Set(metrics.map((m) => m.dimension))).sort(),
    [metrics],
  );

  const dimensionTone = useMemo(() => {
    const map = new Map<string, DimensionTone>();
    dimensions.forEach((d, i) => map.set(d, DIMENSION_TONES[i % DIMENSION_TONES.length]));
    return map;
  }, [dimensions]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return metrics.filter((m) => {
      if (dimensionFilter && m.dimension !== dimensionFilter) return false;
      if (!q) return true;
      return m.metric_id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q);
    });
  }, [metrics, dimensionFilter, search]);

  const enabledCount = useMemo(() => metrics.filter((m) => m.enabled).length, [metrics]);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Total Metrics" value={metrics.length} icon={ListChecks} compact />
        <MetricCard label="Enabled" value={enabledCount} icon={CheckCircle2} tone="green" compact />
        <MetricCard label="Dimensions" value={dimensions.length} icon={Layers} tone="blue" compact />
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-800/50 dark:bg-blue-950/20">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
        <div className="text-[12px] leading-5 text-blue-900 dark:text-blue-300">
          <span className="font-semibold">Pass/fail rule.</span> A metric passes when{" "}
          <span className="font-mono">normalized_score ≥ threshold</span>. A status of{" "}
          <span className="font-mono">failed</span>/<span className="font-mono">error</span> counts as failed; a
          status of <span className="font-mono">pending</span>/<span className="font-mono">skipped</span> needs
          review. A non-zero <span className="font-mono">warning_count</span> or{" "}
          <span className="font-mono">redaction_count</span> can generate security findings.
        </div>
      </div>

      <Card className="overflow-hidden">
        <CardHeader
          eyebrow="Catalog"
          title="Metrics Configuration"
          action={
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search id or name…"
                  className="w-52 rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-[12px] text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:ring-brand-700/40"
                />
              </div>
              <select
                value={dimensionFilter}
                onChange={(e) => setDimensionFilter(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[12px] text-slate-900 outline-none focus:border-brand-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
              >
                <option value="">All dimensions</option>
                {dimensions.map((d) => <option key={d} value={d}>{labelize(d)}</option>)}
              </select>
            </div>
          }
        />

        {error && (
          <div className="mx-5 my-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] border-collapse text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/60">
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="w-6 px-3 py-2.5" />
                {["Metric ID", "Name", "Dimension", "Primary Agent", "Tool", "Frameworks", "Modality", "Version", "Enabled"].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-[12px] text-slate-500 dark:text-slate-400">Loading metric configurations…</td></tr>
              )}
              {!loading && filtered.length === 0 && !error && (
                <tr><td colSpan={10} className="px-4 py-12 text-center">
                  <SlidersHorizontal className="mx-auto h-7 w-7 text-slate-300 dark:text-slate-600" />
                  <p className="mt-2 text-[14px] font-semibold text-slate-900 dark:text-white">No metrics match your filters</p>
                  <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">{metrics.length === 0 ? "No metric configurations are available from the backend." : "Adjust the dimension filter or search term."}</p>
                </td></tr>
              )}
              {!loading && filtered.map((m) => {
                const open = expanded === m.id;
                return (
                  <Fragment key={m.id}>
                    <tr
                      onClick={() => setExpanded(open ? null : m.id)}
                      className={clsx("group cursor-pointer border-b border-slate-100 transition-colors dark:border-slate-700/50", open ? "bg-brand-50/60 dark:bg-brand-900/20" : "hover:bg-slate-50 dark:hover:bg-slate-800/40")}
                    >
                      <td className="px-3 py-3 text-slate-400">
                        {open ? <ChevronDown className="h-4 w-4 text-brand-600" /> : <ChevronRight className="h-4 w-4 group-hover:text-slate-700 dark:group-hover:text-slate-300" />}
                      </td>
                      <td className="px-3 py-3 font-mono text-[11px] text-slate-700 dark:text-slate-300">{m.metric_id}</td>
                      <td className="px-3 py-3 text-[13px] font-medium text-slate-900 dark:text-white">{m.name}</td>
                      <td className="px-3 py-3"><Badge tone={dimensionTone.get(m.dimension) ?? "slate"}>{labelize(m.dimension)}</Badge></td>
                      <td className="px-3 py-3 text-[12px] text-slate-700 dark:text-slate-300">{m.primary_agent ? labelize(m.primary_agent) : "—"}</td>
                      <td className="px-3 py-3 font-mono text-[11px] text-slate-600 dark:text-slate-400">{m.tool_name ?? "—"}</td>
                      <td className="px-3 py-3">
                        <div className="flex max-w-[200px] flex-wrap gap-1">
                          {m.framework_ids.length === 0 ? <span className="text-[11px] text-slate-400">—</span> : m.framework_ids.map((f) => (
                            <span key={f} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">{labelize(f)}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-[12px] text-slate-700 dark:text-slate-300">{m.modality ? labelize(m.modality) : "—"}</td>
                      <td className="px-3 py-3 font-mono text-[11px] text-slate-600 dark:text-slate-400">{m.version ?? "—"}</td>
                      <td className="px-3 py-3"><Badge tone={m.enabled ? "green" : "slate"}>{m.enabled ? "Enabled" : "Disabled"}</Badge></td>
                    </tr>
                    {open && (
                      <tr className="border-b border-blue-100 bg-blue-50/50 dark:border-blue-900/40 dark:bg-blue-950/10">
                        <td colSpan={10} className="px-5 py-4">
                          {m.description && <p className="mb-3 text-[12px] leading-5 text-slate-700 dark:text-slate-300">{m.description}</p>}
                          <div className="grid gap-4 lg:grid-cols-2">
                            <JsonBlock title="Threshold Rules" value={m.threshold_rules} />
                            <JsonBlock title="Scoring Config" value={m.scoring_config} />
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
    </div>
  );
}

function JsonBlock({ title, value }: { title: string; value: Record<string, unknown> | null | undefined }) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">{title}</p>
      <pre className="max-h-60 overflow-auto rounded-lg border border-slate-200 bg-white p-3 font-mono text-[11px] leading-5 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
        {value && Object.keys(value).length > 0 ? JSON.stringify(value, null, 2) : "—"}
      </pre>
    </div>
  );
}
