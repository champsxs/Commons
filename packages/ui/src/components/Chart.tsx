import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart, ScatterChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent, DatasetComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { EChartsCoreOption } from "echarts/core";
import { EmptyState, Skeleton, cn } from "./base.tsx";
import { formatValue, get, humanize, type Format } from "../format.ts";

echarts.use([BarChart, LineChart, PieChart, ScatterChart, GridComponent, LegendComponent, TooltipComponent, DatasetComponent, SVGRenderer]);

export interface ChartProps<T = any> {
  kind: "bar" | "line" | "area" | "pie" | "donut" | "scatter";
  data: T[] | undefined;
  /** Path to the category (x axis, or slice label for pie) */
  x: string;
  /** Path(s) to the value(s). Several paths give several series. */
  y: string | string[];
  /** Split one value into series by this path, e.g. x="month", y="revenue", seriesBy="store.name" */
  seriesBy?: string;
  /** Labels for y paths */
  labels?: Record<string, string>;
  /** How to format the x categories and the values */
  xFormat?: Format;
  format?: Format;
  stacked?: boolean;
  horizontal?: boolean;
  height?: number;
  loading?: boolean;
  className?: string;
  /** Escape hatch: merged into the generated ECharts option */
  option?: EChartsCoreOption;
}

const css = (name: string, fallback: string) =>
  typeof window === "undefined" ? fallback : getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

function palette() {
  return Array.from({ length: 8 }, (_, i) => css(`--chart-${i + 1}`, ["#4f6bed", "#22a39f", "#f2a33a", "#e5607a", "#8a63d2", "#5aa9e6", "#9bbf4a", "#b07a52"][i]));
}

/** A chart from rows. Wraps Apache ECharts with the Commons look; pass `option` for anything custom. */
export function Chart<T>({ kind, data, x, y, seriesBy, labels = {}, xFormat, format, stacked, horizontal, height = 300, loading, className, option }: ChartProps<T>) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  const built = useMemo<EChartsCoreOption | null>(() => {
    if (!data?.length) return null;
    const text = css("--muted-foreground", "#6b7280");
    const line = css("--border", "#e5e7eb");
    const fg = css("--foreground", "#111827");
    const ys = Array.isArray(y) ? y : [y];
    const valueFmt = (v: unknown) => formatValue(v, format ?? "compact");
    const tooltip = {
      trigger: kind === "pie" || kind === "donut" || kind === "scatter" ? "item" : "axis",
      backgroundColor: css("--surface", "#fff"),
      borderColor: line,
      textStyle: { color: fg, fontSize: 12 },
      valueFormatter: (v: unknown) => formatValue(v, format ?? "number"),
      axisPointer: { type: kind === "bar" ? "shadow" : "line", shadowStyle: { color: "rgba(127,127,127,0.08)" }, lineStyle: { color: line } },
    };
    // ECharts measures label widths itself, so it needs the real font name, not "inherit"
    const fontFamily = typeof document === "undefined" ? "sans-serif" : getComputedStyle(el.current ?? document.body).fontFamily;
    const base = { color: palette(), textStyle: { fontFamily }, animationDuration: 400, tooltip };

    if (kind === "pie" || kind === "donut") {
      return {
        ...base,
        legend: { bottom: 0, icon: "circle", itemWidth: 8, itemHeight: 8, textStyle: { color: text } },
        series: [{
          type: "pie",
          radius: kind === "donut" ? ["52%", "78%"] : [0, "78%"],
          center: ["50%", "45%"],
          itemStyle: { borderColor: css("--surface", "#fff"), borderWidth: 2, borderRadius: kind === "donut" ? 4 : 0 },
          label: { show: false },
          data: data.map((r) => ({ name: formatValue(get(r, x), xFormat ?? "text"), value: Number(get(r, ys[0])) })),
        }],
      };
    }

    const categories = [...new Set(data.map((r) => get(r, x)))];
    let series: { name: string; values: (number | null)[] }[];
    if (seriesBy) {
      const groups = [...new Set(data.map((r) => get(r, seriesBy)))];
      series = groups.map((g) => ({
        name: String(g ?? "–"),
        values: categories.map((c) => {
          const rows = data.filter((r) => get(r, seriesBy) === g && get(r, x) === c);
          return rows.length ? rows.reduce((s, r) => s + Number(get(r, ys[0]) ?? 0), 0) : null;
        }),
      }));
    } else {
      series = ys.map((path) => ({
        name: labels[path] ?? humanize(path),
        values: categories.map((c) => {
          const rows = data.filter((r) => get(r, x) === c);
          return rows.length ? rows.reduce((s, r) => s + Number(get(r, path) ?? 0), 0) : null;
        }),
      }));
    }

    const catAxis = {
      type: "category",
      data: categories.map((c) => formatValue(c, xFormat ?? "text")),
      axisLine: { lineStyle: { color: line } },
      axisTick: { show: false },
      axisLabel: { color: text, fontSize: 11, hideOverlap: true },
    };
    const valAxis = {
      type: "value",
      axisLabel: { color: text, fontSize: 11, formatter: valueFmt },
      splitLine: { lineStyle: { color: line, type: "dashed" } },
    };
    const many = series.length > 1;
    return {
      ...base,
      grid: { left: 8, right: 16, top: many ? 36 : 16, bottom: 8, containLabel: true },
      legend: many ? { top: 0, left: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10, itemGap: 16, textStyle: { color: text, fontSize: 12 } } : undefined,
      xAxis: horizontal ? valAxis : catAxis,
      yAxis: horizontal ? { ...catAxis, inverse: true } : valAxis,
      series: series.map((s) => ({
        name: s.name,
        type: kind === "area" ? "line" : kind,
        data: s.values,
        stack: stacked ? "total" : undefined,
        smooth: kind === "line" || kind === "area" ? 0.25 : undefined,
        symbol: kind === "scatter" ? "circle" : "none",
        symbolSize: kind === "scatter" ? 8 : undefined,
        lineStyle: kind === "line" || kind === "area" ? { width: 2 } : undefined,
        areaStyle: kind === "area" ? { opacity: stacked ? 0.5 : 0.12 } : undefined,
        barMaxWidth: 36,
        itemStyle: kind === "bar" ? { borderRadius: horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0] } : undefined,
        emphasis: { focus: "series" },
      })),
    };
  }, [data, kind, x, JSON.stringify(y), seriesBy, JSON.stringify(labels), xFormat, format, stacked, horizontal]);

  useEffect(() => {
    if (!el.current || !built) return;
    chart.current ??= echarts.init(el.current, undefined, { renderer: "svg" });
    chart.current.setOption({ ...built, ...option }, true);
  }, [built, option]);

  useEffect(() => {
    if (!el.current) return;
    const ro = new ResizeObserver(() => chart.current?.resize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, [!!built]);

  if (loading && !data) return <Skeleton className={className} />;
  if (!built) return <EmptyState title="No data to chart" className={className} />;
  return <div ref={el} className={cn("w-full", className)} style={{ height }} />;
}
