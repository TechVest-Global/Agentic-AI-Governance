/**
 * Shared loader that turns the live backend metric-plan for a run into the
 * page's MetricPlanShape. Used by both the Metric Plan page and the in-canvas
 * approval modal so they render identical plan data.
 */
import { getRunMetricPlan, listAISystems, type EvaluationRun } from "@/api/governanceApi";
import { metricBlurb } from "@/data/metricCatalog";
import type { MetricDimension, MetricPlan as MetricPlanShape } from "@/data/metricPlan";

const VALID_DIMENSIONS: MetricDimension[] = ["Bias", "Drift", "Misuse", "Compliance", "Explainability"];

export function normalizeDimension(raw: string): MetricDimension {
  const titled = raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return (VALID_DIMENSIONS as string[]).includes(titled) ? (titled as MetricDimension) : "Compliance";
}

/** Build the page/modal plan shape from the live backend metric-plan for a run. */
export async function loadLivePlan(run: EvaluationRun): Promise<MetricPlanShape | null> {
  const [plan, systems] = await Promise.all([
    getRunMetricPlan(run.id),
    listAISystems().catch(() => []),
  ]);
  const system = systems.find((s) => s.id === plan.ai_system_id);

  return {
    runId: run.id,
    systemName: system?.name ?? "Selected system",
    systemVersion: system?.model_version ?? "",
    riskTier: ((system?.risk_tier ?? "medium").replace(/\b\w/, (c) => c.toUpperCase())) as "High" | "Medium" | "Low",
    runMode: "live",
    selectedFrameworks: plan.selected_frameworks,
    createdAt: run.created_at,
    metrics: plan.metrics.map((m) => ({
      id: m.metric_id,
      name: m.name,
      dimension: normalizeDimension(m.dimension),
      description: `${metricBlurb(m.metric_id, m.name)} Owned by ${m.primary_agent ?? "specialist agent"} · framework refs: ${m.framework_ids.join(", ") || "—"}.`,
      tool: m.tool_name ?? "—",
      toolMode: "live",
      ownerAgent: m.primary_agent ?? "—",
      frameworks: m.framework_ids,
      probeBudget: m.enabled ? 3 : 0,
      threshold: m.threshold != null ? String(m.threshold) : "—",
      status: m.enabled ? "Planned" : "Skipped",
    })),
  };
}
