/**
 * PPG view — sensor-dashboard `PPGVisualizer.tsx` 의 3-row 레이아웃 미러링.
 *
 * 구조 (sensor-dashboard 동일):
 *   1. Hero card        — "💓 PPG Pulse Analysis" + 설명
 *   2. 2-col Row        — Filtered PPG Signal | PPG SQI
 *                          좌: raw IR/RED 차트 + "Pre-filter pulse waveform —
 *                              DSP filter pending" 캡션
 *                          우: SQI 순수 placeholder
 *   3. Full-width       — 💓 Heart Rate Variability Metrics (14 cards, "—")
 *
 * 외부 인터페이스:
 *     const view = createPpgView(container)
 *     view.onBatch(ppgBatch)
 *     view.dispose()
 */
import { PPG_FS, type PpgBatch } from "../linkband/models";
import { type ChartHandle, buildMultiLineOption, createChart } from "./chart";
import { createMetricCard, type MetricCardHandle } from "./metric-card";
import { chartColors, uiColors } from "./theme";

const PPG_BUFFER_SIZE = 400; // ~8s @ 50Hz
const PPG_WINDOW_SEC = PPG_BUFFER_SIZE / PPG_FS; // = 8 — xAxis 고정 윈도우
const STYLE_ID = "ppg-view-style";

export interface PpgViewHandle {
  onBatch(batch: PpgBatch): void;
  /** 컨테이너 가시화 직후 호출 — hidden tab init 케이스에서 ECharts 가 0×0 으로
   *  measure 된 걸 정상 사이즈로 다시 잡아준다. placeholder div 들은 chart 가
   *  아니라 resize 불필요. */
  resize(): void;
  dispose(): void;
}

// ─── Style injection ──────────────────────────────────────────────────────
function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ppg-grid-2col {
      display: grid;
      grid-template-columns: 1fr;
      gap: 1.25rem;
      margin-bottom: 1.5rem;
    }
    @media (min-width: 1024px) {
      .ppg-grid-2col { grid-template-columns: 1fr 1fr; }
    }
    .ppg-metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 0.6rem;
    }
  `;
  document.head.appendChild(s);
}

// ─── DOM helpers (eeg-view.ts 와 동일 패턴) ──────────────────────────────
function makeCard(): HTMLElement {
  const card = document.createElement("div");
  card.style.cssText = `
    background: ${uiColors.bgSection};
    border: 1px solid ${uiColors.border};
    border-radius: 8px;
    padding: 1.25rem;
  `;
  return card;
}

function makeCardTitle(text: string, level: 2 | 3 = 3): HTMLElement {
  const h = document.createElement(level === 2 ? "h2" : "h3");
  h.textContent = text;
  h.style.cssText = `
    margin: 0 0 0.4rem 0;
    font-size: ${level === 2 ? "1.15rem" : "1rem"};
    font-weight: ${level === 2 ? "700" : "600"};
    color: ${uiColors.textPrimary};
  `;
  return h;
}

function makeCardDesc(text: string): HTMLElement {
  const p = document.createElement("p");
  p.textContent = text;
  p.style.cssText = `margin: 0 0 0.85rem 0; font-size: 0.85rem; color: ${uiColors.textSecondary};`;
  return p;
}

function makeBanner(text: string): HTMLElement {
  const b = document.createElement("div");
  b.style.cssText = `
    display: none;
    background: ${chartColors.warnBg};
    border: 1px solid ${chartColors.warnBorder};
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
    margin-bottom: 0.75rem;
    color: #fca5a5;
    font-size: 0.85rem;
  `;
  b.textContent = text;
  return b;
}

function makePlaceholder(label: string, height: string): HTMLElement {
  const ph = document.createElement("div");
  ph.style.cssText = `
    width: 100%;
    height: ${height};
    display: flex;
    align-items: center;
    justify-content: center;
    background: ${uiColors.bgBase};
    border: 1px dashed ${uiColors.border};
    border-radius: 6px;
    color: ${uiColors.textMuted};
    font-size: 0.85rem;
    text-align: center;
    padding: 0 1rem;
  `;
  ph.textContent = `${label} — DSP not yet implemented`;
  return ph;
}

// ─── createPpgView ────────────────────────────────────────────────────────

export function createPpgView(container: HTMLElement): PpgViewHandle {
  ensureStyles();

  const root = document.createElement("section");
  root.className = "ppg-view-root";

  // (1) Hero card.
  const hero = makeCard();
  hero.appendChild(makeCardTitle("💓 PPG Pulse Analysis", 2));
  const heroSub = document.createElement("p");
  heroSub.textContent =
    "Real-time photoplethysmography signal processing and heart-rate variability visualization.";
  heroSub.style.cssText = `margin: 0; font-size: 0.9rem; color: ${uiColors.textSecondary};`;
  hero.appendChild(heroSub);
  hero.style.marginBottom = "1.5rem";
  root.appendChild(hero);

  // (2) 2-col row: Filtered | SQI.
  const row = document.createElement("div");
  row.className = "ppg-grid-2col";

  // ── Filtered card (raw chart + caption) ─────────────────────────────────
  const filteredCard = makeCard();
  filteredCard.appendChild(makeCardTitle("🔧 Filtered PPG Signal"));
  filteredCard.appendChild(
    makeCardDesc(
      "Red/IR LED signals passed through a 0.5-5.0Hz bandpass filter to isolate the heart-beat pattern (DC removed).",
    ),
  );

  // PPG LeadOff banner — sensor-dashboard `PPGLeadOffBanner.tsx` (`ppg-filter` context)
  // 위치 미러. parser 가 PPG 별도 lead-off 정보를 추출하지 않으므로 (firmware 패킷에
  // PPG 전용 lead-off 바이트 없음) DOM 만 두고 toggle 없음 — 시각 구조만 미러.
  const leadOffBanner = makeBanner(
    "⚠ PPG sensor contact issue — signal quality may be degraded",
  );
  filteredCard.appendChild(leadOffBanner);

  const filteredHost = document.createElement("div");
  filteredHost.style.cssText = "width: 100%; height: 220px;";
  filteredCard.appendChild(filteredHost);

  const filteredCaption = document.createElement("p");
  filteredCaption.textContent = "Pre-filter pulse waveform — DSP filter pending";
  filteredCaption.style.cssText = `
    margin: 0.5rem 0 0 0;
    font-size: 0.7rem;
    color: ${uiColors.textMuted};
    text-align: center;
    font-style: italic;
  `;
  filteredCard.appendChild(filteredCaption);

  row.appendChild(filteredCard);

  // ── SQI card (pure placeholder) ─────────────────────────────────────────
  const sqiCard = makeCard();
  sqiCard.appendChild(makeCardTitle("📈 PPG Signal Quality Index (SQI)"));
  sqiCard.appendChild(
    makeCardDesc("Signal quality and electrode contact monitoring."),
  );
  sqiCard.appendChild(makePlaceholder("PPG SQI chart", "240px"));
  row.appendChild(sqiCard);

  root.appendChild(row);

  // (3) HRV Metrics card (full-width).
  const metricsCard = makeCard();
  metricsCard.appendChild(makeCardTitle("💓 Heart Rate Variability Metrics"));
  metricsCard.appendChild(
    makeCardDesc(
      "Real-time PPG analysis — heart rate, HRV, stress, and 11 more indices. All placeholder until DSP/metrics land.",
    ),
  );
  const metricsGrid = document.createElement("div");
  metricsGrid.className = "ppg-metrics-grid";
  metricsCard.appendChild(metricsGrid);
  root.appendChild(metricsCard);

  container.appendChild(root);

  // 14 metric cards — 라벨/단위/색은 sensor-dashboard `PPGMetricsCards.tsx` 그대로.
  const metricSpec: Array<{
    label: string;
    unit?: string;
    dotColor?: string;
    decimals?: number;
  }> = [
    { label: "BPM", unit: "bpm", dotColor: chartColors.bpm, decimals: 0 },
    { label: "SpO₂", unit: "%", dotColor: "#4ecdc4", decimals: 1 },
    { label: "HR Max", unit: "bpm", dotColor: chartColors.bpm, decimals: 0 },
    { label: "HR Min", unit: "bpm", dotColor: chartColors.bpm, decimals: 0 },
    { label: "Stress", dotColor: "#f59e0b", decimals: 2 },
    { label: "RMSSD", unit: "ms", dotColor: "#a855f7", decimals: 1 },
    { label: "SDNN", unit: "ms", dotColor: "#a855f7", decimals: 1 },
    { label: "SDSD", unit: "ms", dotColor: "#a855f7", decimals: 1 },
    { label: "LF Power", dotColor: "#3b82f6", decimals: 1 },
    { label: "HF Power", dotColor: "#10b981", decimals: 1 },
    { label: "LF/HF", dotColor: "#f59e0b", decimals: 2 },
    { label: "AVNN", unit: "ms", dotColor: "#a855f7", decimals: 1 },
    { label: "pNN50", unit: "%", dotColor: "#a855f7", decimals: 1 },
    { label: "pNN20", unit: "%", dotColor: "#a855f7", decimals: 1 },
  ];
  const metricCards: MetricCardHandle[] = metricSpec.map((spec) =>
    createMetricCard(metricsGrid, spec),
  );
  for (const c of metricCards) c.update(null);

  // ─── Chart (raw IR/RED multi-line) ──────────────────────────────────────
  const filteredChart: ChartHandle = createChart(
    filteredHost,
    buildMultiLineOption({
      series: [
        { name: "IR", color: chartColors.ir },
        { name: "Red", color: chartColors.red },
      ],
      yName: "ADC counts",
      yNameGap: 60,
      tooltipFormatter: (params: unknown) => {
        const arr = params as Array<{ seriesName: string; value: [number, number] }>;
        if (!Array.isArray(arr) || arr.length === 0) return "";
        const t = arr[0]?.value?.[0] ?? 0;
        const lines = [`t = ${t.toFixed(2)}s`];
        for (const p of arr) lines.push(`${p.seriesName}: ${p.value[1]}`);
        return lines.join("<br/>");
      },
    }),
  );

  // ─── Buffers + onBatch ──────────────────────────────────────────────────
  const irBuf: number[] = [];
  const redBuf: number[] = [];

  function pushAndTrim(buf: number[], values: Int32Array): void {
    for (const v of values) buf.push(v);
    if (buf.length > PPG_BUFFER_SIZE) buf.splice(0, buf.length - PPG_BUFFER_SIZE);
  }

  return {
    onBatch(batch: PpgBatch): void {
      pushAndTrim(irBuf, batch.ir);
      pushAndTrim(redBuf, batch.red);

      const fs = batch.fs;
      const irLast = Math.max(irBuf.length - 1, 0);
      const redLast = Math.max(redBuf.length - 1, 0);
      // xAxis 는 PPG_WINDOW_SEC 고정 → 라인은 우측에서 좌측으로 자라남.
      const irData: Array<[number, number]> = irBuf.map((v, i) => [(i - irLast) / fs, v]);
      const redData: Array<[number, number]> = redBuf.map((v, i) => [(i - redLast) / fs, v]);
      filteredChart.chart.setOption({
        xAxis: { min: -PPG_WINDOW_SEC, max: 0 },
        series: [{ data: irData }, { data: redData }],
      });
    },
    resize(): void {
      filteredChart.chart.resize();
    },
    dispose(): void {
      filteredChart.dispose();
      root.remove();
    },
  };
}
