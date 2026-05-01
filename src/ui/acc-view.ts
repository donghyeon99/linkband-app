/**
 * ACC view — 3-axis raw acceleration line chart.
 *
 * sensor-dashboard `ACCVisualizer.tsx` 가 가진 3 panel (raw / magnitude /
 * motion cards) 중 raw 만 포팅. magnitude (sqrt(x²+y²+z²)) 와 motion
 * classification 은 DSP/metrics 단계 — 본 범위 밖.
 */
import type { AccBatch } from "../linkband/models";
import { type ChartHandle, buildMultiLineOption, createChart } from "./chart";
import { chartColors, uiColors } from "./theme";

const ACC_BUFFER_SIZE = 200; // ~8s @ 25Hz (sensor-dashboard ACC_BUFFER_SIZE 동일)

export interface AccViewHandle {
  onBatch(batch: AccBatch): void;
  dispose(): void;
}

export function createAccView(container: HTMLElement): AccViewHandle {
  const section = document.createElement("section");
  section.style.cssText = `
    background: ${uiColors.bgSection};
    border: 1px solid ${uiColors.border};
    border-radius: 8px;
    padding: 1.25rem;
    margin-bottom: 1.5rem;
  `;

  const title = document.createElement("h2");
  title.textContent = "📐 ACC Acceleration Analysis";
  title.style.cssText = `margin: 0 0 0.25rem 0; font-size: 1.15rem; font-weight: 700; color: ${uiColors.textPrimary};`;
  section.appendChild(title);

  // sensor-dashboard 의 헤더 카피라이트 짧게 유지: 축별 색 의미 + sample rate.
  const subtitle = document.createElement("p");
  subtitle.innerHTML = `
    3-axis raw 16-bit LE (X <span style="color:${chartColors.accX}">●</span> /
    Y <span style="color:${chartColors.accY}">●</span> /
    Z <span style="color:${chartColors.accZ}">●</span>). Last ~8s @ 25Hz.
  `;
  subtitle.style.cssText = `margin: 0 0 1rem 0; font-size: 0.85rem; color: ${uiColors.textSecondary};`;
  section.appendChild(subtitle);

  const chartHost = document.createElement("div");
  chartHost.style.cssText = "width: 100%; height: 240px;";
  section.appendChild(chartHost);

  container.appendChild(section);

  // ECharts: 3-line. y 범위 auto-scale (firmware IMU 스케일 미확정 — ±2g 면
  // 1g ≈ 16384 LSB 이지만 g 단위 변환은 DSP 단계).
  const chart: ChartHandle = createChart(
    chartHost,
    buildMultiLineOption({
      series: [
        { name: "X", color: chartColors.accX },
        { name: "Y", color: chartColors.accY },
        { name: "Z", color: chartColors.accZ },
      ],
      yName: "ADC counts",
      yNameGap: 50,
      tooltipFormatter: (params: unknown) => {
        const arr = params as Array<{ seriesName: string; value: [number, number] }>;
        if (!Array.isArray(arr) || arr.length === 0) return "";
        const idx = arr[0]?.value?.[0] ?? 0;
        const lines = [`Sample #${idx}`];
        for (const p of arr) lines.push(`${p.seriesName}: ${p.value[1]}`);
        return lines.join("<br/>");
      },
    }),
  );

  const xBuf: number[] = [];
  const yBuf: number[] = [];
  const zBuf: number[] = [];

  function pushAndTrim(buf: number[], values: Int16Array): void {
    for (const v of values) buf.push(v);
    if (buf.length > ACC_BUFFER_SIZE) buf.splice(0, buf.length - ACC_BUFFER_SIZE);
  }

  return {
    onBatch(batch: AccBatch): void {
      pushAndTrim(xBuf, batch.x);
      pushAndTrim(yBuf, batch.y);
      pushAndTrim(zBuf, batch.z);

      const maxLen = Math.max(xBuf.length, yBuf.length, zBuf.length, 1);
      const xData: Array<[number, number]> = xBuf.map((v, i) => [i, v]);
      const yData: Array<[number, number]> = yBuf.map((v, i) => [i, v]);
      const zData: Array<[number, number]> = zBuf.map((v, i) => [i, v]);
      chart.chart.setOption({
        xAxis: { min: 0, max: maxLen - 1 },
        series: [{ data: xData }, { data: yData }, { data: zData }],
      });
    },
    dispose(): void {
      chart.dispose();
      section.remove();
    },
  };
}
