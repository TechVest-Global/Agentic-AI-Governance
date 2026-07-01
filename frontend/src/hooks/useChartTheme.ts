import { useThemeStore } from "@/store/useThemeStore";

export type ChartTheme = {
  grid: string;
  axisLine: string;
  tick: string;
  tooltip: {
    contentStyle: { borderRadius: number; border: string; background: string; boxShadow: string; fontSize: number };
    labelStyle: { color: string; fontWeight: number };
    itemStyle: { color: string };
  };
  radialTrack: string;
};

const LIGHT: ChartTheme = {
  grid: "#eef0f6",
  axisLine: "#cbd2e0",
  tick: "#64748b",
  tooltip: {
    contentStyle: {
      borderRadius: 10,
      border: "1px solid #e7e9f0",
      background: "#ffffff",
      boxShadow: "0 8px 24px -8px rgba(16,24,40,0.18)",
      fontSize: 12,
    },
    labelStyle: { color: "#0d1224", fontWeight: 600 },
    itemStyle: { color: "#3a4256" },
  },
  radialTrack: "#e9edf2",
};

const DARK: ChartTheme = {
  grid: "#293548",
  axisLine: "#3a4256",
  tick: "#94a3b8",
  tooltip: {
    contentStyle: {
      borderRadius: 10,
      border: "1px solid #334155",
      background: "#111827",
      boxShadow: "0 8px 24px -8px rgba(0,0,0,0.5)",
      fontSize: 12,
    },
    labelStyle: { color: "#f1f5f9", fontWeight: 600 },
    itemStyle: { color: "#cbd5e1" },
  },
  radialTrack: "#1e293b",
};

/** Recharts styling is plain JS props, not CSS — it can't pick up `dark:` classes, so theme has to be read here. */
export function useChartTheme(): ChartTheme {
  const theme = useThemeStore((s) => s.theme);
  return theme === "dark" ? DARK : LIGHT;
}
