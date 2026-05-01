/**
 * PPG view — sensor-dashboard `PPGVisualizer.tsx` 의 4-row 레이아웃 + DSP wired.
 *
 * 구조 (DSP active):
 *   1. Hero card        — "💓 PPG Pulse Analysis" + 설명
 *   2. 2-col Row        — Filtered PPG Signal | PPG SQI (실 차트)
 *   3. Full-width       — 💓 BPM Trend (실 차트, ~60s 윈도우)
 *   4. Full-width       — 💓 HRV Metrics (17 cards: 9 active, 8 placeholder)
 *
 * Filter chain: HP 0.5Hz → LP 5Hz @ 50Hz (sensor-dashboard `ppgPipeline.ts` 그대로).
 * Peak detection: own derivation (adaptive threshold + min interval). RR-base HRV.
 *
 * 외부 인터페이스:
 *     const view = createPpgView(container)
 *     view.onBatch(ppgBatch)
 *     view.resize()
 *     view.dispose()
 */
import {
  type PpgChannelFilter,
  calculatePpgSqi,
  computeHeartRate,
  computeHrvMetrics,
  createPpgChannelFilter,
  detectPpgPeaks,
  peaksToRrSeconds,
  processPpgSample,
} from "../linkband/dsp";
import { PPG_FS, type PpgBatch } from "../linkband/models";
import {
  type ChartHandle,
  buildMultiLineOption,
  buildRealtimeLineOption,
  createChart,
} from "./chart";
import { createMetricCard, type MetricCardHandle } from "./metric-card";
import { chartColors, uiColors } from "./theme";

const PPG_BUFFER_SIZE = 400; // ~8s @ 50Hz
const PPG_WINDOW_SEC = PPG_BUFFER_SIZE / PPG_FS; // = 8
const BPM_HISTORY_SIZE = 100; // ~56s @ 1 batch/0.56s
const BPM_WINDOW_SEC = 60;
const STYLE_ID = "ppg-view-style";

export interface PpgViewHandle {
  onBatch(batch: PpgBatch): void;
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

// ─── DOM helpers ──────────────────────────────────────────────────────────
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

// ─── createPpgView ────────────────────────────────────────────────────────

export function createPpgView(container: HTMLElement): PpgViewHandle {
  ensureStyles();

  const root = document.createElement("section");
  root.className = "ppg-view-root";

  // (1) Hero.
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

  // ── Filtered card ───────────────────────────────────────────────────────
  const filteredCard = makeCard();
  filteredCard.appendChild(makeCardTitle("🔧 Filtered PPG Signal"));
  filteredCard.appendChild(
    makeCardDesc(
      "Red/IR LED signals through 0.5-5.0Hz bandpass (DC removed, heartbeat band).",
    ),
  );
  // PPG LeadOff banner — DOM only (parser 가 PPG 별도 lead-off 정보 없음).
  const leadOffBanner = makeBanner(
    "⚠ PPG sensor contact issue — signal quality may be degraded",
  );
  filteredCard.appendChild(leadOffBanner);
  const filteredHost = document.createElement("div");
  filteredHost.style.cssText = "width: 100%; height: 220px;";
  filteredCard.appendChild(filteredHost);
  row.appendChild(filteredCard);

  // ── SQI card (real chart) ───────────────────────────────────────────────
  const sqiCard = makeCard();
  sqiCard.appendChild(makeCardTitle("📈 PPG Signal Quality Index (SQI)"));
  sqiCard.appendChild(
    makeCardDesc(
      "Filtered PPG amplitude-based SQI (25-sample window, threshold 250).",
    ),
  );
  const sqiHost = document.createElement("div");
  sqiHost.style.cssText = "width: 100%; height: 220px;";
  sqiCard.appendChild(sqiHost);
  row.appendChild(sqiCard);

  root.appendChild(row);

  // (3) BPM Trend (full-width).
  const bpmTrendCard = makeCard();
  bpmTrendCard.appendChild(makeCardTitle("💓 BPM Trend"));
  bpmTrendCard.appendChild(
    makeCardDesc("Heart rate over time — derived from peak detection on filtered IR signal."),
  );
  const bpmTrendHost = document.createElement("div");
  bpmTrendHost.style.cssText = "width: 100%; height: 200px;";
  bpmTrendCard.appendChild(bpmTrendHost);
  bpmTrendCard.style.marginBottom = "1.5rem";
  root.appendChild(bpmTrendCard);

  // (4) HRV Metrics (full-width).
  const metricsCard = makeCard();
  metricsCard.appendChild(makeCardTitle("💓 Heart Rate Variability Metrics"));
  metricsCard.appendChild(
    makeCardDesc(
      "9 RR-based metrics (active) + 8 advanced metrics (placeholder until LF/HF FFT, SpO₂, stress/stability/intensity arrive).",
    ),
  );
  const metricsGrid = document.createElement("div");
  metricsGrid.className = "ppg-metrics-grid";
  metricsCard.appendChild(metricsGrid);
  root.appendChild(metricsCard);

  container.appendChild(root);

  // 17 metric cards. 9 active (HR/SDNN/RMSSD/SDSD/AVNN/PNN50/PNN20/HR Max/HR Min)
  // + 8 placeholder (SpO₂/LF/HF/LF-HF/Stress/Stability/Intensity/Total Power).
  const m = {
    bpm: createMetricCard(metricsGrid, { label: "Heart Rate", unit: "bpm", dotColor: chartColors.bpm, decimals: 0 }),
    spo2: createMetricCard(metricsGrid, { label: "SpO₂", unit: "%", dotColor: "#4ecdc4", decimals: 1 }),
    hrMax: createMetricCard(metricsGrid, { label: "HR Max", unit: "bpm", dotColor: chartColors.bpm, decimals: 0 }),
    hrMin: createMetricCard(metricsGrid, { label: "HR Min", unit: "bpm", dotColor: chartColors.bpm, decimals: 0 }),
    stress: createMetricCard(metricsGrid, { label: "Stress Index", dotColor: "#f59e0b", decimals: 2 }),
    rmssd: createMetricCard(metricsGrid, { label: "RMSSD", unit: "ms", dotColor: "#a855f7", decimals: 1 }),
    sdnn: createMetricCard(metricsGrid, { label: "SDNN", unit: "ms", dotColor: "#a855f7", decimals: 1 }),
    sdsd: createMetricCard(metricsGrid, { label: "SDSD", unit: "ms", dotColor: "#a855f7", decimals: 1 }),
    lfPower: createMetricCard(metricsGrid, { label: "LF Power", dotColor: "#3b82f6", decimals: 1 }),
    hfPower: createMetricCard(metricsGrid, { label: "HF Power", dotColor: "#10b981", decimals: 1 }),
    lfHf: createMetricCard(metricsGrid, { label: "LF/HF", dotColor: "#f59e0b", decimals: 2 }),
    avnn: createMetricCard(metricsGrid, { label: "AVNN", unit: "ms", dotColor: "#a855f7", decimals: 1 }),
    pnn50: createMetricCard(metricsGrid, { label: "pNN50", unit: "%", dotColor: "#a855f7", decimals: 1 }),
    pnn20: createMetricCard(metricsGrid, { label: "pNN20", unit: "%", dotColor: "#a855f7", decimals: 1 }),
    stability: createMetricCard(metricsGrid, { label: "Stability", dotColor: "#14b8a6", decimals: 2 }),
    intensity: createMetricCard(metricsGrid, { label: "Intensity", dotColor: "#a855f7", decimals: 2 }),
    totalPower: createMetricCard(metricsGrid, { label: "Total Power", dotColor: "#6b6b7e", decimals: 1 }),
  } as const satisfies Record<string, MetricCardHandle>;
  for (const c of Object.values(m)) c.update(null);

  // ─── Charts ──────────────────────────────────────────────────────────────
  const filteredChart: ChartHandle = createChart(
    filteredHost,
    buildMultiLineOption({
      series: [
        { name: "IR", color: chartColors.ir },
        { name: "Red", color: chartColors.red },
      ],
      yName: "filtered",
      yMin: -250,
      yMax: 250,
      yNameGap: 50,
      tooltipFormatter: (params: unknown) => {
        const arr = params as Array<{ seriesName: string; value: [number, number] }>;
        if (!Array.isArray(arr) || arr.length === 0) return "";
        const t = arr[0]?.value?.[0] ?? 0;
        const lines = [`t = ${t.toFixed(2)}s`];
        for (const p of arr) lines.push(`${p.seriesName}: ${p.value[1].toFixed(1)}`);
        return lines.join("<br/>");
      },
    }),
  );

  const sqiChart: ChartHandle = createChart(
    sqiHost,
    buildRealtimeLineOption({
      color: chartColors.magnitude,
      yName: "SQI %",
      yMin: 0,
      yMax: 100,
      yNameGap: 40,
      area: true,
      tooltipFormatter: (params: unknown) => {
        const arr = params as Array<{ value: [number, number] }>;
        if (!Array.isArray(arr) || arr.length === 0) return "";
        const t = arr[0]?.value?.[0] ?? 0;
        const v = arr[0]?.value?.[1] ?? 0;
        return `t = ${t.toFixed(2)}s<br/>SQI: ${v.toFixed(0)}%`;
      },
    }),
  );

  const bpmTrendChart: ChartHandle = createChart(
    bpmTrendHost,
    buildRealtimeLineOption({
      color: chartColors.bpm,
      yName: "BPM",
      yMin: 40,
      yMax: 160,
      yNameGap: 40,
      smooth: true,
      tooltipFormatter: (params: unknown) => {
        const arr = params as Array<{ value: [number, number] }>;
        if (!Array.isArray(arr) || arr.length === 0) return "";
        const t = arr[0]?.value?.[0] ?? 0;
        const v = arr[0]?.value?.[1] ?? 0;
        return `t = ${t.toFixed(1)}s<br/>BPM: ${v.toFixed(0)}`;
      },
    }),
  );

  // ─── State (filters + buffers) ──────────────────────────────────────────
  const filterIr: PpgChannelFilter = createPpgChannelFilter();
  const filterRed: PpgChannelFilter = createPpgChannelFilter();

  const irBuf: number[] = []; // filtered IR
  const redBuf: number[] = []; // filtered Red
  const sqiBuf: number[] = []; // PPG SQI %
  const bpmHistoryBuf: number[] = []; // BPM trend (one entry per batch)

  function pushAndTrim<T>(buf: T[], v: T, max: number): void {
    buf.push(v);
    if (buf.length > max) buf.splice(0, buf.length - max);
  }

  return {
    onBatch(batch: PpgBatch): void {
      // 샘플별 filter cascade 적용 — filtered IR/Red 만 buffer 에 push.
      const filteredIr: number[] = new Array(batch.ir.length);
      const filteredRed: number[] = new Array(batch.red.length);
      for (let i = 0; i < batch.ir.length; i++) {
        const fi = processPpgSample(filterIr, batch.ir[i]);
        const fr = processPpgSample(filterRed, batch.red[i]);
        filteredIr[i] = fi;
        filteredRed[i] = fr;
        pushAndTrim(irBuf, fi, PPG_BUFFER_SIZE);
        pushAndTrim(redBuf, fr, PPG_BUFFER_SIZE);
      }

      const fs = batch.fs;
      const irLast = Math.max(irBuf.length - 1, 0);
      const redLast = Math.max(redBuf.length - 1, 0);

      // Filtered chart 갱신 (newest = t=0, fixed window).
      const irData: Array<[number, number]> = irBuf.map((v, i) => [(i - irLast) / fs, v]);
      const redData: Array<[number, number]> = redBuf.map((v, i) => [(i - redLast) / fs, v]);
      filteredChart.chart.setOption({
        xAxis: { min: -PPG_WINDOW_SEC, max: 0 },
        series: [{ data: irData }, { data: redData }],
      });

      // SQI: filtered IR 기준 (sensor-dashboard 와 동일). 마지막 batch 길이만큼 append.
      const sqi = calculatePpgSqi(irBuf);
      const newCount = batch.ir.length;
      for (const v of sqi.slice(-newCount)) pushAndTrim(sqiBuf, v, PPG_BUFFER_SIZE);
      const sqiLast = Math.max(sqiBuf.length - 1, 0);
      const sqiData: Array<[number, number]> = sqiBuf.map((v, i) => [(i - sqiLast) / fs, v]);
      sqiChart.chart.setOption({
        xAxis: { min: -PPG_WINDOW_SEC, max: 0 },
        series: [{ data: sqiData }],
      });

      // Peak detection on filtered IR → RR seconds → HRV/HR.
      const peaks = detectPpgPeaks(irBuf, fs);
      const rrSeconds = peaksToRrSeconds(peaks, fs);
      const rrMs = rrSeconds.map((s) => s * 1000);

      // 9 active metric cards 갱신 — RR ≥ 1 일 때 의미 있는 값.
      if (rrMs.length >= 1) {
        const hr = computeHeartRate(rrMs);
        const hrv = computeHrvMetrics(rrMs);
        m.bpm.update(hr.bpm);
        m.hrMax.update(hr.hrMax);
        m.hrMin.update(hr.hrMin);
        m.avnn.update(hrv.avnn);
        m.sdnn.update(hrv.sdnn);
        m.rmssd.update(hrv.rmssd);
        m.sdsd.update(hrv.sdsd);
        m.pnn50.update(hrv.pnn50);
        m.pnn20.update(hrv.pnn20);

        // BPM trend buffer — 1 entry per batch.
        pushAndTrim(bpmHistoryBuf, hr.bpm, BPM_HISTORY_SIZE);
        const bpmLast = Math.max(bpmHistoryBuf.length - 1, 0);
        // 1 entry per ~0.56s — 시간축은 -BPM_WINDOW_SEC..0.
        const bpmData: Array<[number, number]> = bpmHistoryBuf.map((v, i) => {
          const dt = (i - bpmLast) * (PPG_BUFFER_SIZE / fs / batch.ir.length); // batch interval ≈ 0.56s
          return [dt, v];
        });
        bpmTrendChart.chart.setOption({
          xAxis: { min: -BPM_WINDOW_SEC, max: 0 },
          series: [{ data: bpmData }],
        });
      }
      // 나머지 8 placeholder cards — DSP 미구현, 항상 null 유지.
    },
    resize(): void {
      filteredChart.chart.resize();
      sqiChart.chart.resize();
      bpmTrendChart.chart.resize();
    },
    dispose(): void {
      filteredChart.dispose();
      sqiChart.dispose();
      bpmTrendChart.dispose();
      root.remove();
    },
  };
}
