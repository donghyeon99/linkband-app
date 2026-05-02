/**
 * BandPowerCard — sensor-dashboard `components/eeg/BandPowerCards.tsx` 의 한 카드를
 * vanilla TS DOM 으로 미러링.
 *
 * 시각 구조 (sensor-dashboard 동일):
 *   1. 상단 row: 색 dot (좌) + "dB" 라벨 (우)
 *   2. **Total** vertical bar (큰 막대, h≈32px) — bottom-up fill, overlay text 로
 *      combined dB 값 (centered, white drop-shadow)
 *   3. **Ch1 / Ch2** vertical bars (작은 막대, h≈24px each) — header row 에 채널
 *      이름 + 숫자, bar fill bottom-up. **Ch1 = 파랑, Ch2 = 빨강** (band color 아님)
 *   4. Band 이름 (sm semibold)
 *   5. Range + 설명 (예: "8-13Hz · Relaxed/calm")
 *   6. L/R diff (예: "L/R diff: 2.3 dB") cyan
 *
 * **정규화**: cross-band global maxPower 기반. 호출 측이 모든 band 의 max 를
 * 계산해서 `update({ ch1Db, ch2Db, maxPower })` 로 넘겨준다. 카드는 자체적으로
 * `(v / maxPower) * 100` 으로 막대 width 산출 (음수 dB 면 0%, max ≤ 0 면 전부 0%).
 *
 * 외부 인터페이스:
 *     const handle = createBandPowerCard(container, {
 *       bandName: "Delta", freqRange: "0.5-4Hz",
 *       color: "#8B4513", description: "Deep sleep",
 *     })
 *     handle.update({ ch1Db: 41.2, ch2Db: 43.0, maxPower: 50.0 })
 *     handle.update(null)
 */
import { uiColors } from "./theme";

export interface BandPowerCardOptions {
  /** Band 이름 (예: "Delta"). */
  bandName: string;
  /** 주파수 범위 (예: "0.5-4Hz"). 부제로 표시. */
  freqRange: string;
  /** Band 색상 (hex) — 헤더 dot + Total bar fill 에 사용. */
  color: string;
  /** Band 설명 (예: "Deep sleep"). 부제로 표시. */
  description: string;
}

export interface BandPowerCardUpdate {
  /** Channel 1 (FP1) band power dB. */
  ch1Db: number;
  /** Channel 2 (FP2) band power dB. */
  ch2Db: number;
  /** 모든 band 의 ch1/ch2 max — global 정규화용. */
  maxPower: number;
}

export interface BandPowerCardHandle {
  readonly element: HTMLElement;
  update(values: BandPowerCardUpdate | null): void;
}

const BAR_BG = "#2a2a36"; // 어두운 회색 배경 막대
const CH1_COLOR = "#3b82f6"; // 파랑 (sensor-dashboard `bg-blue-500`)
const CH2_COLOR = "#ef4444"; // 빨강 (sensor-dashboard `bg-red-500`)
const DIFF_COLOR = "#67e8f9"; // cyan-300 (sensor-dashboard `text-cyan-300`)

interface VerticalBar {
  /** Bar 안 fill div (height 갱신). */
  fill: HTMLElement;
  /** Bar 안 overlay text (선택 — Total bar 는 사용, Ch1/Ch2 는 미사용). */
  overlay: HTMLElement | null;
}

function makeVerticalBar(
  height: string,
  fillColor: string,
  withOverlay: boolean,
): { wrap: HTMLElement; bar: VerticalBar } {
  const wrap = document.createElement("div");
  wrap.style.cssText = `
    height: ${height};
    background: ${BAR_BG};
    border-radius: 4px;
    position: relative;
    overflow: hidden;
  `;
  const fill = document.createElement("div");
  fill.style.cssText = `
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 0%;
    background: ${fillColor};
    opacity: 0.85;
    border-radius: 4px;
    transition: height 0.25s ease;
  `;
  wrap.appendChild(fill);

  let overlay: HTMLElement | null = null;
  if (withOverlay) {
    overlay = document.createElement("div");
    overlay.style.cssText = `
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      font-size: 0.72rem;
      font-weight: 700;
      color: white;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
      font-family: ui-monospace, "SF Mono", Consolas, monospace;
    `;
    overlay.textContent = "—";
    wrap.appendChild(overlay);
  }

  return { wrap, bar: { fill, overlay } };
}

export function createBandPowerCard(
  container: HTMLElement,
  opts: BandPowerCardOptions,
): BandPowerCardHandle {
  const { bandName, freqRange, color, description } = opts;

  const card = document.createElement("div");
  card.className = "band-power-card";
  card.style.cssText = `
    background: ${uiColors.bgElevated};
    border: 1px solid ${uiColors.border};
    border-radius: 8px;
    padding: 0.7rem 0.75rem;
    min-width: 0;
    transition: background 0.15s ease;
  `;
  card.addEventListener("mouseenter", () => {
    card.style.background = "#23232f";
  });
  card.addEventListener("mouseleave", () => {
    card.style.background = uiColors.bgElevated;
  });

  // (1) 상단 row: dot + "dB" 라벨.
  const headRow = document.createElement("div");
  headRow.style.cssText =
    "display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.4rem;";
  const dot = document.createElement("span");
  dot.style.cssText = `
    width: 0.55rem; height: 0.55rem; border-radius: 50%;
    background: ${color};
    flex-shrink: 0;
  `;
  headRow.appendChild(dot);
  const unitEl = document.createElement("span");
  unitEl.textContent = "dB";
  unitEl.style.cssText = `font-size: 0.62rem; color: ${uiColors.textMuted};`;
  headRow.appendChild(unitEl);
  card.appendChild(headRow);

  // (2) Total bar (큰).
  const totalSection = document.createElement("div");
  totalSection.style.cssText = "margin-bottom: 0.45rem;";
  const totalLabel = document.createElement("div");
  totalLabel.textContent = "Total";
  totalLabel.style.cssText = `font-size: 0.62rem; color: ${uiColors.textMuted}; margin-bottom: 0.15rem;`;
  totalSection.appendChild(totalLabel);
  const total = makeVerticalBar("2rem", color, true);
  totalSection.appendChild(total.wrap);
  card.appendChild(totalSection);

  // (3) Ch1 / Ch2 vertical bars (작은).
  const ch1Section = document.createElement("div");
  ch1Section.style.cssText = "margin-bottom: 0.3rem;";
  const ch1Head = document.createElement("div");
  ch1Head.style.cssText =
    "display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.1rem;";
  const ch1Label = document.createElement("span");
  ch1Label.textContent = "Ch1";
  ch1Label.style.cssText = `font-size: 0.62rem; color: #93c5fd;`; // blue-300
  ch1Head.appendChild(ch1Label);
  const ch1Value = document.createElement("span");
  ch1Value.textContent = "—";
  ch1Value.style.cssText = `font-size: 0.62rem; color: ${uiColors.textMuted}; font-family: ui-monospace, "SF Mono", Consolas, monospace;`;
  ch1Head.appendChild(ch1Value);
  ch1Section.appendChild(ch1Head);
  const ch1 = makeVerticalBar("1.5rem", CH1_COLOR, false);
  ch1Section.appendChild(ch1.wrap);
  card.appendChild(ch1Section);

  const ch2Section = document.createElement("div");
  ch2Section.style.cssText = "margin-bottom: 0.5rem;";
  const ch2Head = document.createElement("div");
  ch2Head.style.cssText =
    "display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.1rem;";
  const ch2Label = document.createElement("span");
  ch2Label.textContent = "Ch2";
  ch2Label.style.cssText = `font-size: 0.62rem; color: #fca5a5;`; // red-300
  ch2Head.appendChild(ch2Label);
  const ch2Value = document.createElement("span");
  ch2Value.textContent = "—";
  ch2Value.style.cssText = `font-size: 0.62rem; color: ${uiColors.textMuted}; font-family: ui-monospace, "SF Mono", Consolas, monospace;`;
  ch2Head.appendChild(ch2Value);
  ch2Section.appendChild(ch2Head);
  const ch2 = makeVerticalBar("1.5rem", CH2_COLOR, false);
  ch2Section.appendChild(ch2.wrap);
  card.appendChild(ch2Section);

  // (4) Band name.
  const nameEl = document.createElement("div");
  nameEl.textContent = bandName;
  nameEl.style.cssText = `font-size: 0.85rem; font-weight: 600; color: ${uiColors.textPrimary}; line-height: 1.2;`;
  card.appendChild(nameEl);

  // (5) Range · description.
  const subEl = document.createElement("div");
  subEl.textContent = `${freqRange} · ${description}`;
  subEl.style.cssText = `font-size: 0.65rem; color: ${uiColors.textMuted}; line-height: 1.3;`;
  card.appendChild(subEl);

  // (6) L/R diff.
  const diffEl = document.createElement("div");
  diffEl.textContent = "L/R diff: —";
  diffEl.style.cssText = `font-size: 0.65rem; color: ${DIFF_COLOR}; margin-top: 0.2rem; font-family: ui-monospace, "SF Mono", Consolas, monospace;`;
  card.appendChild(diffEl);

  container.appendChild(card);

  return {
    element: card,
    update(values: BandPowerCardUpdate | null): void {
      if (
        values === null ||
        !Number.isFinite(values.ch1Db) ||
        !Number.isFinite(values.ch2Db)
      ) {
        if (total.bar.overlay) total.bar.overlay.textContent = "—";
        ch1Value.textContent = "—";
        ch2Value.textContent = "—";
        diffEl.textContent = "L/R diff: —";
        total.bar.fill.style.height = "0%";
        ch1.bar.fill.style.height = "0%";
        ch2.bar.fill.style.height = "0%";
        return;
      }
      const { ch1Db, ch2Db, maxPower } = values;
      const combined = (ch1Db + ch2Db) / 2;

      // Cross-band global 정규화 — sensor-dashboard 와 동일.
      // maxPower ≤ 0 면 전부 0% (음수 dB 영역 — div explosion 회피).
      const norm = (v: number): number =>
        maxPower > 0 ? Math.max(0, Math.min(100, (v / maxPower) * 100)) : 0;
      const pctTotal = norm(combined);
      const pctCh1 = norm(ch1Db);
      const pctCh2 = norm(ch2Db);

      total.bar.fill.style.height = `${pctTotal}%`;
      ch1.bar.fill.style.height = `${pctCh1}%`;
      ch2.bar.fill.style.height = `${pctCh2}%`;

      if (total.bar.overlay) total.bar.overlay.textContent = combined.toFixed(1);
      ch1Value.textContent = ch1Db.toFixed(1);
      ch2Value.textContent = ch2Db.toFixed(1);
      diffEl.textContent = `L/R diff: ${Math.abs(ch1Db - ch2Db).toFixed(1)} dB`;
    },
  };
}
