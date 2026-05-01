/**
 * EEG view — sensor-dashboard `EEGVisualizer.tsx` 의 전체 레이아웃을 vanilla TS 로 미러링.
 *
 * 구조 (sensor-dashboard 동일):
 *   1. Hero card        — "🧠 EEG Brain Wave Analysis" + 설명
 *   2. 2-col Row        — Ch1 RawData (FP1) | Ch2 RawData (FP2). 각 카드 안에:
 *                          h3 + 설명 + LeadOff banner + Saturated banner + Chart
 *   3. 2-col Row        — Ch1 SQI | Ch2 SQI placeholder
 *   4. 2-col Row        — Power Spectrum | Band Power placeholder
 *   5. Full-width       — EEG Analysis Indices placeholder
 *
 * DSP 의존 패널 (3, 4, 5) 는 placeholder. DSP 도착 시 동일 카드에 차트 init.
 *
 * 외부 인터페이스:
 *     const view = createEegView(container)
 *     view.onBatch(eegBatch)
 *     view.dispose()
 */
import { EEG_FS, type EegBatch } from "../linkband/models";
import { type ChartHandle, buildRealtimeLineOption, createChart } from "./chart";
import { chartColors, uiColors } from "./theme";

const EEG_BUFFER_SIZE = 2000; // ~4s @ 500Hz
const EEG_WINDOW_SEC = EEG_BUFFER_SIZE / EEG_FS; // = 4 — xAxis 고정 윈도우 (sensor-dashboard appendCap 의 시간 등가)
const SATURATION_THRESHOLD_UV = 300_000;
const STYLE_ID = "eeg-view-style";

export interface EegViewHandle {
  onBatch(batch: EegBatch): void;
  /** 컨테이너 가시화 직후 호출 — 탭 전환 등으로 0×0 → 정상 size 변할 때 ECharts 가
   *  새 사이즈로 다시 measure 하도록 강제. */
  resize(): void;
  dispose(): void;
}

// ─── Style injection (1회) ────────────────────────────────────────────────
// 2-col grid 는 반응형 (≥1024px 에서만 2열). inline style 로 @media 표현 못 하니
// 모듈 첫 호출 시 <style> 태그 한 번 주입.
function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .eeg-grid-2col {
      display: grid;
      grid-template-columns: 1fr;
      gap: 1.25rem;
      margin-bottom: 1.5rem;
    }
    @media (min-width: 1024px) {
      .eeg-grid-2col { grid-template-columns: 1fr 1fr; }
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

interface ChannelCard {
  card: HTMLElement;
  chartHost: HTMLElement;
  leadOffBanner: HTMLElement;
  saturatedBanner: HTMLElement;
}

function makeChannelCard(title: string, desc: string): ChannelCard {
  const card = makeCard();
  card.appendChild(makeCardTitle(title));
  card.appendChild(makeCardDesc(desc));

  const leadOffBanner = makeBanner(
    "⚠ Electrode contact issue (lead-off detected) — signal quality may be degraded",
  );
  const saturatedBanner = makeBanner(
    "⚠ Electrodes appear floating — saturated to reference voltage. Place band on head to see real EEG.",
  );
  card.appendChild(leadOffBanner);
  card.appendChild(saturatedBanner);

  const chartHost = document.createElement("div");
  chartHost.style.cssText = "width: 100%; height: 220px;";
  card.appendChild(chartHost);

  return { card, chartHost, leadOffBanner, saturatedBanner };
}

function buildChannelChart(host: HTMLElement, color: string, label: string): ChartHandle {
  return createChart(
    host,
    buildRealtimeLineOption({
      color,
      yName: "μV",
      yMin: -150,
      yMax: 150,
      yNameGap: 50,
      tooltipFormatter: (params: unknown) => {
        const arr = params as Array<{ value: [number, number] }>;
        if (!Array.isArray(arr) || arr.length === 0) return "";
        const t = arr[0]?.value?.[0] ?? 0;
        const v = arr[0]?.value?.[1] ?? 0;
        return `t = ${t.toFixed(2)}s<br/>${label}: ${v.toFixed(2)} μV`;
      },
    }),
  );
}

// ─── createEegView ─────────────────────────────────────────────────────────

export function createEegView(container: HTMLElement): EegViewHandle {
  ensureStyles();

  const root = document.createElement("section");
  root.className = "eeg-view-root";

  // (1) Hero card.
  const hero = makeCard();
  hero.appendChild(makeCardTitle("🧠 EEG Brain Wave Analysis", 2));
  const heroSub = document.createElement("p");
  heroSub.textContent = "Real-time EEG signal processing and analysis visualization.";
  heroSub.style.cssText = `margin: 0; font-size: 0.9rem; color: ${uiColors.textSecondary};`;
  hero.appendChild(heroSub);
  hero.style.marginBottom = "1.5rem";
  root.appendChild(hero);

  // (2) Ch1/Ch2 RawData 2-col row.
  const row1 = document.createElement("div");
  row1.className = "eeg-grid-2col";
  const ch1 = makeChannelCard(
    "🔧 Ch1 Filtered EEG Signal (FP1)",
    "Channel 1 (FP1) signal processing — 60Hz notch + 1-45Hz bandpass filter (DSP pending; raw signal shown for now).",
  );
  const ch2 = makeChannelCard(
    "🔧 Ch2 Filtered EEG Signal (FP2)",
    "Channel 2 (FP2) signal processing — 60Hz notch + 1-45Hz bandpass filter (DSP pending; raw signal shown for now).",
  );
  row1.appendChild(ch1.card);
  row1.appendChild(ch2.card);
  root.appendChild(row1);

  // (3) SQI 2-col placeholder.
  const row2 = document.createElement("div");
  row2.className = "eeg-grid-2col";
  for (const [title, desc] of [
    ["📈 Ch1 Signal Quality Index (SQI)", "Channel 1 (FP1) electrode contact and signal quality monitoring."],
    ["📈 Ch2 Signal Quality Index (SQI)", "Channel 2 (FP2) electrode contact and signal quality monitoring."],
  ] as const) {
    const c = makeCard();
    c.appendChild(makeCardTitle(title));
    c.appendChild(makeCardDesc(desc));
    c.appendChild(makePlaceholder("SQI chart", "180px"));
    row2.appendChild(c);
  }
  root.appendChild(row2);

  // (4) Power Spectrum + Band Power placeholders.
  const row3 = document.createElement("div");
  row3.className = "eeg-grid-2col";
  for (const [title, desc, label] of [
    [
      "🌈 Power Spectrum (1-45Hz)",
      "Ch1, Ch2 frequency-domain EEG signal analysis.",
      "Power Spectrum",
    ],
    [
      "🎯 Frequency Band Power",
      "Real-time band-level power — Delta, Theta, Alpha, Beta, Gamma.",
      "Band Power cards",
    ],
  ] as const) {
    const c = makeCard();
    c.appendChild(makeCardTitle(title));
    c.appendChild(makeCardDesc(desc));
    c.appendChild(makePlaceholder(label, "200px"));
    row3.appendChild(c);
  }
  root.appendChild(row3);

  // (5) Full-width Indices placeholder.
  const idxCard = makeCard();
  idxCard.appendChild(makeCardTitle("🧠 EEG Analysis Indices"));
  idxCard.appendChild(
    makeCardDesc("Real-time EEG analysis — focus, relaxation, stress, and 4 more indices."),
  );
  idxCard.appendChild(makePlaceholder("EEG Analysis Indices", "180px"));
  root.appendChild(idxCard);

  container.appendChild(root);

  // ─── Charts (single-line each) ──────────────────────────────────────────
  const chart1 = buildChannelChart(ch1.chartHost, chartColors.ch1Filtered, "Ch1 (FP1)");
  const chart2 = buildChannelChart(ch2.chartHost, chartColors.ch2Filtered, "Ch2 (FP2)");

  // ─── Buffers + onBatch ──────────────────────────────────────────────────
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

      const fs = batch.fs;
      const ch1Last = Math.max(ch1Buf.length - 1, 0);
      const ch2Last = Math.max(ch2Buf.length - 1, 0);

      // LeadOff: parser 가 채널별 분리 정보 없음 (spec §17 Q2 미해결) — 양쪽 카드에 동일 토글.
      const anyLeadOff = batch.leadOff.some((v) => v);
      ch1.leadOffBanner.style.display = anyLeadOff ? "block" : "none";
      ch2.leadOffBanner.style.display = anyLeadOff ? "block" : "none";

      // Saturated: per-channel — ch1Uv 와 ch2Uv 각각 검사.
      const ch1Sat = batch.ch1Uv.every((v) => Math.abs(v) > SATURATION_THRESHOLD_UV);
      const ch2Sat = batch.ch2Uv.every((v) => Math.abs(v) > SATURATION_THRESHOLD_UV);
      ch1.saturatedBanner.style.display = ch1Sat ? "block" : "none";
      ch2.saturatedBanner.style.display = ch2Sat ? "block" : "none";

      // 좌표는 초 단위 — 가장 오래된 = -(N-1)/fs, 최신 = 0.
      // chartData 는 buffer 길이 기반 — buffer 차오를수록 좌측으로 grow.
      // xAxis 는 EEG_WINDOW_SEC 고정 → 빈 좌측 영역은 그냥 비어 있음 (라인 X).
      const ch1Data: Array<[number, number]> = ch1Buf.map((v, i) => [(i - ch1Last) / fs, v]);
      const ch2Data: Array<[number, number]> = ch2Buf.map((v, i) => [(i - ch2Last) / fs, v]);
      chart1.chart.setOption({
        xAxis: { min: -EEG_WINDOW_SEC, max: 0 },
        series: [{ data: ch1Data }],
      });
      chart2.chart.setOption({
        xAxis: { min: -EEG_WINDOW_SEC, max: 0 },
        series: [{ data: ch2Data }],
      });
    },
    resize(): void {
      chart1.chart.resize();
      chart2.chart.resize();
    },
    dispose(): void {
      chart1.dispose();
      chart2.dispose();
      root.remove();
    },
  };
}
