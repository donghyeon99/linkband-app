/**
 * ACC view — sensor-dashboard `ACCVisualizer.tsx` 의 4-row 레이아웃 미러링.
 *
 * 구조 (sensor-dashboard 동일):
 *   1. Hero card        — "📐 ACC Acceleration Analysis" + 설명 + 3 InfoBadge
 *   2. Full-width       — "3-Axis Acceleration Waveform" (X/Y/Z multi-line)
 *   3. Full-width       — "Magnitude" (√(x²+y²+z²) per-sample, area chart)
 *   4. Full-width       — "📐 Movement Analysis" placeholder
 *
 * Magnitude 는 DSP 가 아닌 단순 산술 (3D 벡터 norm) — view 안에서 계산.
 *
 * 외부 인터페이스:
 *     const view = createAccView(container)
 *     view.onBatch(accBatch)
 *     view.dispose()
 */
import { ACC_FS, type AccBatch } from "../linkband/models";
import {
  type ChartHandle,
  buildMultiLineOption,
  buildRealtimeLineOption,
  createChart,
} from "./chart";
import { chartColors, rgba, uiColors } from "./theme";

const ACC_BUFFER_SIZE = 200; // ~8s @ 25Hz
const ACC_WINDOW_SEC = ACC_BUFFER_SIZE / ACC_FS; // = 8 — xAxis 고정 윈도우

export interface AccViewHandle {
  onBatch(batch: AccBatch): void;
  dispose(): void;
}

// ─── DOM helpers (eeg/ppg-view.ts 와 동일 패턴) ───────────────────────────
function makeCard(): HTMLElement {
  const card = document.createElement("div");
  card.style.cssText = `
    background: ${uiColors.bgSection};
    border: 1px solid ${uiColors.border};
    border-radius: 8px;
    padding: 1.25rem;
    margin-bottom: 1.5rem;
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

function makeCardDesc(html: string): HTMLElement {
  const p = document.createElement("p");
  p.innerHTML = html;
  p.style.cssText = `margin: 0 0 0.85rem 0; font-size: 0.85rem; color: ${uiColors.textSecondary}; line-height: 1.5;`;
  return p;
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

/**
 * sensor-dashboard `components/ui/InfoBadge.tsx` 의 단순 미러 — 색 컬러키 + 텍스트.
 * shadcn Badge 의존성 없이 inline span + style. accent color 는 yellow 고정.
 */
function makeInfoBadge(text: string): HTMLElement {
  const badge = document.createElement("span");
  badge.textContent = text;
  badge.style.cssText = `
    display: inline-block;
    padding: 0.25rem 0.7rem;
    border-radius: 9999px;
    font-size: 0.72rem;
    font-weight: 500;
    background: ${rgba(chartColors.magnitude, 0.15)};
    color: ${chartColors.magnitude};
    border: 1px solid ${rgba(chartColors.magnitude, 0.35)};
    margin-right: 0.4rem;
  `;
  return badge;
}

// ─── createAccView ────────────────────────────────────────────────────────

export function createAccView(container: HTMLElement): AccViewHandle {
  const root = document.createElement("section");
  root.className = "acc-view-root";

  // (1) Hero card.
  const hero = makeCard();
  hero.appendChild(makeCardTitle("📐 ACC Acceleration Analysis", 2));
  // sensor-dashboard 의 X/Y/Z 색 강조 inline 구문 미러.
  hero.appendChild(
    makeCardDesc(
      `The accelerometer measures the movement and tilt of the headset.
       <strong style="color:${chartColors.accX}"> X-axis</strong> (left/right),
       <strong style="color:${chartColors.accY}"> Y-axis</strong> (front/back),
       <strong style="color:${chartColors.accZ}"> Z-axis</strong> (up/down) —
       acceleration is measured along all three axes in units of g.`,
    ),
  );
  const badgeRow = document.createElement("div");
  badgeRow.style.cssText = "display: flex; flex-wrap: wrap; gap: 0.25rem; margin-top: 0.25rem;";
  badgeRow.appendChild(makeInfoBadge("3-axis (X, Y, Z)"));
  badgeRow.appendChild(makeInfoBadge("25Hz sampling"));
  badgeRow.appendChild(makeInfoBadge("Unit: g (gravitational acceleration)"));
  hero.appendChild(badgeRow);
  root.appendChild(hero);

  // (2) 3-Axis waveform card.
  const waveCard = makeCard();
  waveCard.appendChild(makeCardTitle("3-Axis Acceleration Waveform"));
  waveCard.appendChild(
    makeCardDesc(
      "When stationary, Z-axis ≈ -1g (gravity), X/Y ≈ 0. Each axis value changes as you move your head.",
    ),
  );
  const waveHost = document.createElement("div");
  waveHost.style.cssText = "width: 100%; height: 240px;";
  waveCard.appendChild(waveHost);
  root.appendChild(waveCard);

  // (3) Magnitude card.
  const magCard = makeCard();
  magCard.appendChild(makeCardTitle("Magnitude"));
  magCard.appendChild(
    makeCardDesc(
      "√(x² + y² + z²) — combines movement from all directions into a single value. About 1g at rest, varies with movement.",
    ),
  );
  const magHost = document.createElement("div");
  magHost.style.cssText = "width: 100%; height: 200px;";
  magCard.appendChild(magHost);
  root.appendChild(magCard);

  // (4) Movement Analysis placeholder.
  const motionCard = makeCard();
  motionCard.appendChild(makeCardTitle("📐 Movement Analysis"));
  motionCard.appendChild(
    makeCardDesc(
      "Real-time acceleration summary and activity state (stationary/moving) analysis.",
    ),
  );
  motionCard.appendChild(makePlaceholder("Movement Analysis cards", "180px"));
  root.appendChild(motionCard);

  container.appendChild(root);

  // ─── Charts ──────────────────────────────────────────────────────────────
  const waveChart: ChartHandle = createChart(
    waveHost,
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
        const t = arr[0]?.value?.[0] ?? 0;
        const lines = [`t = ${t.toFixed(2)}s`];
        for (const p of arr) lines.push(`${p.seriesName}: ${p.value[1]}`);
        return lines.join("<br/>");
      },
    }),
  );

  // Magnitude — 0..30000 고정 (1g LSB 16384 기준 여유). area + smooth (sensor-dashboard
  // AccMagnitudeChart 와 동일).
  const magChart: ChartHandle = createChart(
    magHost,
    buildRealtimeLineOption({
      color: chartColors.magnitude,
      yName: "magnitude",
      yMin: 0,
      yMax: 30000,
      yNameGap: 55,
      area: true,
      smooth: true,
      tooltipFormatter: (params: unknown) => {
        const arr = params as Array<{ value: [number, number] }>;
        if (!Array.isArray(arr) || arr.length === 0) return "";
        const t = arr[0]?.value?.[0] ?? 0;
        const v = arr[0]?.value?.[1] ?? 0;
        return `t = ${t.toFixed(2)}s<br/>magnitude: ${v.toFixed(0)}`;
      },
    }),
  );

  // ─── Buffers + onBatch ──────────────────────────────────────────────────
  const xBuf: number[] = [];
  const yBuf: number[] = [];
  const zBuf: number[] = [];
  const magBuf: number[] = [];

  function pushAndTrim(buf: number[], value: number): void {
    buf.push(value);
    if (buf.length > ACC_BUFFER_SIZE) buf.splice(0, buf.length - ACC_BUFFER_SIZE);
  }

  return {
    onBatch(batch: AccBatch): void {
      // x/y/z 버퍼 + per-sample magnitude 계산 (DSP 가 아닌 산술).
      for (let i = 0; i < batch.x.length; i++) {
        const x = batch.x[i];
        const y = batch.y[i];
        const z = batch.z[i];
        pushAndTrim(xBuf, x);
        pushAndTrim(yBuf, y);
        pushAndTrim(zBuf, z);
        pushAndTrim(magBuf, Math.sqrt(x * x + y * y + z * z));
      }

      const fs = batch.fs;
      const xLast = Math.max(xBuf.length - 1, 0);
      const yLast = Math.max(yBuf.length - 1, 0);
      const zLast = Math.max(zBuf.length - 1, 0);
      const magLast = Math.max(magBuf.length - 1, 0);

      // xAxis 는 ACC_WINDOW_SEC 고정 → buffer 차오를수록 라인이 좌측으로 grow.
      const xData: Array<[number, number]> = xBuf.map((v, i) => [(i - xLast) / fs, v]);
      const yData: Array<[number, number]> = yBuf.map((v, i) => [(i - yLast) / fs, v]);
      const zData: Array<[number, number]> = zBuf.map((v, i) => [(i - zLast) / fs, v]);
      const magData: Array<[number, number]> = magBuf.map((v, i) => [(i - magLast) / fs, v]);

      waveChart.chart.setOption({
        xAxis: { min: -ACC_WINDOW_SEC, max: 0 },
        series: [{ data: xData }, { data: yData }, { data: zData }],
      });
      magChart.chart.setOption({
        xAxis: { min: -ACC_WINDOW_SEC, max: 0 },
        series: [{ data: magData }],
      });
    },
    dispose(): void {
      waveChart.dispose();
      magChart.dispose();
      root.remove();
    },
  };
}
