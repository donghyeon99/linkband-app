/**
 * EEG view — sensor-dashboard `EEGVisualizer.tsx` 의 메인 패널 (filtered signal +
 * LeadOffBanner) 을 vanilla TS 로 미러링.
 *
 * 단순화 (이번 범위 = 시각화만):
 * - sensor-dashboard 처럼 ch1/ch2 별도 차트로 가지 않고 두 라인을 한 차트에 (사용자 spec).
 * - DSP 패널 (SignalQualityChart, PowerSpectrumChart, BandPowerCards, IndexCards)
 *   는 본 단계 범위 밖 — 추가하지 않음. 차후 DSP 단계에서 별도 view 또는
 *   본 view 확장으로 결정.
 * - LeadOff 채널 분리 (sensor-dashboard 의 ch1/ch2 별 분기) 도 단순화 — firmware
 *   가 채널별인지 단일인지 미확정 (spec §17 Q2). 일단 batch 의 leadOff 샘플 중
 *   하나라도 true 면 banner 표시.
 *
 * 외부 인터페이스:
 *     const view = createEegView(container)
 *     view.onBatch(eegBatch)
 *     view.dispose()
 */
import type { EegBatch } from "../linkband/models";
import { type ChartHandle, buildMultiLineOption, createChart } from "./chart";
import { chartColors, uiColors } from "./theme";

const EEG_BUFFER_SIZE = 2000; // ~4s @ 500Hz (sensor-dashboard 의 EEG_BUFFER_SIZE 1000 @ 250Hz 의 fs 보정)

export interface EegViewHandle {
  onBatch(batch: EegBatch): void;
  dispose(): void;
}

export function createEegView(container: HTMLElement): EegViewHandle {
  // Section panel — sensor-dashboard 의 `bg-section-bg border rounded-lg shadow p-6` 토큰 매핑.
  const section = document.createElement("section");
  section.className = "eeg-view";
  section.style.cssText = `
    background: ${uiColors.bgSection};
    border: 1px solid ${uiColors.border};
    border-radius: 8px;
    padding: 1.25rem;
    margin-bottom: 1.5rem;
  `;

  const title = document.createElement("h2");
  title.textContent = "🧠 EEG Brain Wave Analysis";
  title.style.cssText = `
    margin: 0 0 0.25rem 0;
    font-size: 1.15rem;
    font-weight: 700;
    color: ${uiColors.textPrimary};
  `;
  section.appendChild(title);

  const subtitle = document.createElement("p");
  subtitle.textContent = "Real-time EEG signal — Ch1 (FP1) + Ch2 (FP2). Last ~4s @ 500Hz.";
  subtitle.style.cssText = `
    margin: 0 0 1rem 0;
    font-size: 0.85rem;
    color: ${uiColors.textSecondary};
  `;
  section.appendChild(subtitle);

  // LeadOff banner — sensor-dashboard `LeadOffBanner.tsx` 의 시각 구조 미러링.
  const banner = document.createElement("div");
  banner.style.cssText = `
    display: none;
    background: ${chartColors.warnBg};
    border: 1px solid ${chartColors.warnBorder};
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
    margin-bottom: 0.75rem;
    color: #fca5a5;
    font-size: 0.85rem;
  `;
  banner.textContent = "⚠ Electrode contact issue (lead-off detected) — signal quality may be degraded";
  section.appendChild(banner);

  // Chart host
  const chartHost = document.createElement("div");
  chartHost.style.cssText = "width: 100%; height: 280px;";
  section.appendChild(chartHost);

  container.appendChild(section);

  // ECharts: 멀티라인 — ch1 (FP1) + ch2 (FP2). y 범위는 sensor-dashboard 의
  // RawDataChart 를 따라 ±150 μV (filtered signal 기준). saturated raw 샘플은
  // 차트 경계에서 clip 되어 평평한 라인으로 표시된다.
  const chart: ChartHandle = createChart(
    chartHost,
    buildMultiLineOption({
      series: [
        { name: "Ch1 (FP1)", color: chartColors.ch1Filtered },
        { name: "Ch2 (FP2)", color: chartColors.ch2Filtered },
      ],
      yName: "μV",
      yMin: -150,
      yMax: 150,
      yNameGap: 50,
      tooltipFormatter: (params: unknown) => {
        const arr = params as Array<{ seriesName: string; value: [number, number] }>;
        if (!Array.isArray(arr) || arr.length === 0) return "";
        const idx = arr[0]?.value?.[0] ?? 0;
        const lines = [`Sample #${idx}`];
        for (const p of arr) lines.push(`${p.seriesName}: ${p.value[1].toFixed(2)} μV`);
        return lines.join("<br/>");
      },
    }),
  );

  // Sliding window buffers.
  const ch1Buf: number[] = [];
  const ch2Buf: number[] = [];

  function pushAndTrim(buf: number[], values: Float64Array): void {
    for (const v of values) buf.push(v);
    if (buf.length > EEG_BUFFER_SIZE) buf.splice(0, buf.length - EEG_BUFFER_SIZE);
  }

  return {
    onBatch(batch: EegBatch): void {
      pushAndTrim(ch1Buf, batch.ch1Uv);
      pushAndTrim(ch2Buf, batch.ch2Uv);

      // LeadOff: 본 batch 안에 lead-off 샘플이 하나라도 있으면 banner 표시.
      const anyLeadOff = batch.leadOff.some((v) => v);
      banner.style.display = anyLeadOff ? "block" : "none";

      const ch1Data: Array<[number, number]> = ch1Buf.map((v, i) => [i, v]);
      const ch2Data: Array<[number, number]> = ch2Buf.map((v, i) => [i, v]);
      const maxLen = Math.max(ch1Buf.length, ch2Buf.length, 1);

      chart.chart.setOption({
        xAxis: { min: 0, max: maxLen - 1 },
        series: [{ data: ch1Data }, { data: ch2Data }],
      });
    },
    dispose(): void {
      chart.dispose();
      section.remove();
    },
  };
}
