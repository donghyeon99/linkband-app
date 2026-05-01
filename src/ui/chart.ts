/**
 * ECharts thin wrapper + 공통 option builder.
 *
 * sensor-dashboard 의 `src/lib/charts/{BaseChart,echartsRegistry,optionBuilders}.ts`
 * 를 합쳐 vanilla TS 로 정리. `echarts/core` + 필요한 모듈만 등록 (tree-shaking 위해).
 */
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsCoreOption, ECharts } from "echarts/core";

import { areaGradient, axisLabelStyle, legendTextStyle, splitLineStyle } from "./theme";

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

export type EChartsOption = EChartsCoreOption;

export interface ChartHandle {
  readonly chart: ECharts;
  dispose(): void;
}

/**
 * 컨테이너 element 를 받아 ECharts 인스턴스 + 자동 resize 핸들러를 묶어 반환.
 * 호출 측은 `handle.chart.setOption({...})` 로 데이터를 갱신한다.
 */
export function createChart(container: HTMLElement, option: EChartsOption): ChartHandle {
  const chart = echarts.init(container);
  chart.setOption(option);
  const onResize = (): void => chart.resize();
  window.addEventListener("resize", onResize);
  return {
    chart,
    dispose() {
      window.removeEventListener("resize", onResize);
      chart.dispose();
    },
  };
}

// ─── Option builders (sensor-dashboard optionBuilders.ts 미러) ─────────────

export interface RealtimeLineOptions {
  color: string;
  yName: string;
  yMin?: number;
  yMax?: number;
  yInterval?: number;
  yNameGap?: number;
  smooth?: boolean;
  area?: boolean;
  sampling?: "lttb" | "average" | "max" | "min" | "sum";
  tooltipFormatter?: (params: unknown) => string;
}

/** 단일 라인 + 고정 y 범위. EEG ch1/ch2 같은 단일 채널 차트 용도. */
export function buildRealtimeLineOption(opts: RealtimeLineOptions): EChartsOption {
  const {
    color,
    yName,
    yMin,
    yMax,
    yInterval,
    yNameGap = 40,
    smooth = false,
    area = false,
    sampling,
    tooltipFormatter,
  } = opts;
  return {
    tooltip: {
      trigger: "axis",
      ...(tooltipFormatter ? { formatter: tooltipFormatter } : {}),
    },
    grid: { left: "12%", right: "5%", bottom: "8%", top: "8%" },
    xAxis: { type: "value", show: false },
    yAxis: {
      type: "value",
      name: yName,
      nameLocation: "middle",
      nameGap: yNameGap,
      ...(yMin !== undefined ? { min: yMin } : {}),
      ...(yMax !== undefined ? { max: yMax } : {}),
      ...(yInterval !== undefined ? { interval: yInterval } : {}),
      splitLine: splitLineStyle,
      axisLabel: axisLabelStyle,
    },
    series: [
      {
        type: "line",
        data: [],
        lineStyle: { color, width: area ? 2 : 1.5 },
        ...(area ? { areaStyle: { color: areaGradient(color) } } : {}),
        symbol: "none",
        animation: false,
        ...(smooth ? { smooth: true } : {}),
        ...(sampling ? { sampling } : {}),
      },
    ],
  };
}

export interface MultiLineSeries {
  name: string;
  color: string;
  smooth?: boolean;
}

export interface MultiLineOptions {
  series: MultiLineSeries[];
  yName: string;
  yMin?: number;
  yMax?: number;
  yNameGap?: number;
  legend?: boolean;
  tooltipFormatter?: (params: unknown) => string;
}

/** 다중 라인 + legend. PPG (IR/Red), ACC (X/Y/Z) 같은 멀티 채널 용도. */
export function buildMultiLineOption(opts: MultiLineOptions): EChartsOption {
  const { series, yName, yMin, yMax, yNameGap = 35, legend = true, tooltipFormatter } = opts;
  return {
    tooltip: {
      trigger: "axis",
      ...(tooltipFormatter ? { formatter: tooltipFormatter } : {}),
    },
    ...(legend
      ? {
          legend: {
            data: series.map((s) => s.name),
            top: 5,
            textStyle: legendTextStyle,
          },
        }
      : {}),
    grid: { left: "10%", right: "5%", bottom: "8%", top: legend ? "15%" : "8%" },
    xAxis: { type: "value", show: false },
    yAxis: {
      type: "value",
      name: yName,
      nameLocation: "middle",
      nameGap: yNameGap,
      ...(yMin !== undefined ? { min: yMin } : {}),
      ...(yMax !== undefined ? { max: yMax } : {}),
      splitLine: splitLineStyle,
      axisLabel: axisLabelStyle,
    },
    series: series.map((s) => ({
      name: s.name,
      type: "line",
      data: [],
      lineStyle: { color: s.color, width: 1.5 },
      symbol: "none",
      animation: false,
      ...(s.smooth ? { smooth: true } : {}),
    })),
  };
}
