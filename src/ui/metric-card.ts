/**
 * MetricCard — sensor-dashboard `components/ui/MetricCard.tsx` 와
 * `components/ppg/PPGMetricsCards.tsx` 의 카드 시각 구조를 vanilla TS DOM 으로
 * 미러링한 단일 위젯. PPG metrics 패널이 12-15개 인스턴스를 만들어 사용한다.
 *
 * 차이점 (이 단계 의도된 단순화):
 * - 임계값 분류 (`classifyIndex`/`IndexThreshold`) 제거 — DSP/metrics 가 아직
 *   없으므로 status 라벨은 항상 placeholder ("—").
 * - Tailwind 클래스 대신 inline style. 다른 framework 의존성 없음.
 * - tooltip (`IndexTooltip`) 생략 — 차후 metric 단계에서 추가 검토.
 *
 * 외부 인터페이스:
 *     const handle = createMetricCard(container, { label: "BPM", unit: "bpm", dotColor: "#ef4444" })
 *     handle.update(72)        // 숫자 표시
 *     handle.update(null)      // "—" placeholder
 */
import { uiColors } from "./theme";

export interface MetricCardOptions {
  /** 사람이 읽는 라벨, 예: "BPM", "RMSSD". */
  label: string;
  /** 단위 (라벨 옆에 작게). 비우면 표시 안 함. */
  unit?: string;
  /** 라벨 좌측 dot 색상 (hex). 비우면 회색. */
  dotColor?: string;
  /** 소수점 자릿수. 기본 1. */
  decimals?: number;
  /** 라벨 아래 설명 한 줄 (옵션). */
  description?: string;
}

export interface MetricCardHandle {
  readonly element: HTMLElement;
  update(value: number | null | undefined): void;
}

function isValidNumber(v: number | null | undefined): v is number {
  return v !== null && v !== undefined && !Number.isNaN(v);
}

export function createMetricCard(
  container: HTMLElement,
  opts: MetricCardOptions,
): MetricCardHandle {
  const { label, unit, dotColor = uiColors.textMuted, decimals = 1, description } = opts;

  const card = document.createElement("div");
  card.className = "metric-card";
  card.style.cssText = `
    background: ${uiColors.bgElevated};
    border: 1px solid ${uiColors.border};
    border-radius: 8px;
    padding: 0.75rem 1rem;
    min-width: 0;
  `;

  const head = document.createElement("div");
  head.style.cssText = "display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.4rem;";

  const dot = document.createElement("span");
  dot.style.cssText = `
    width: 0.6rem; height: 0.6rem; border-radius: 50%;
    background: ${dotColor};
    flex-shrink: 0;
  `;
  head.appendChild(dot);

  const labelEl = document.createElement("span");
  labelEl.textContent = label;
  labelEl.style.cssText = `font-size: 0.8rem; font-weight: 600; color: ${uiColors.textSecondary};`;
  head.appendChild(labelEl);

  card.appendChild(head);

  const valueRow = document.createElement("div");
  valueRow.style.cssText = `
    font-size: 1.4rem;
    font-weight: 700;
    color: ${uiColors.textPrimary};
    font-family: ui-monospace, "SF Mono", Consolas, monospace;
    line-height: 1.2;
    display: flex;
    align-items: baseline;
    gap: 0.3rem;
  `;
  const valueEl = document.createElement("span");
  valueEl.textContent = "—";
  valueRow.appendChild(valueEl);

  if (unit) {
    const unitEl = document.createElement("span");
    unitEl.textContent = unit;
    unitEl.style.cssText = `font-size: 0.7rem; color: ${uiColors.textMuted}; font-weight: 400;`;
    valueRow.appendChild(unitEl);
  }

  card.appendChild(valueRow);

  // Status line — DSP 없으니 placeholder 고정.
  const statusEl = document.createElement("div");
  statusEl.textContent = "No data";
  statusEl.style.cssText = `font-size: 0.7rem; margin-top: 0.3rem; color: ${uiColors.textMuted};`;
  card.appendChild(statusEl);

  if (description) {
    const descEl = document.createElement("div");
    descEl.textContent = description;
    descEl.style.cssText = `font-size: 0.7rem; margin-top: 0.2rem; color: ${uiColors.textMuted}; line-height: 1.4;`;
    card.appendChild(descEl);
  }

  container.appendChild(card);

  return {
    element: card,
    update(value: number | null | undefined): void {
      if (isValidNumber(value)) {
        valueEl.textContent = value.toFixed(decimals);
        statusEl.textContent = "live";
        statusEl.style.color = uiColors.accent;
      } else {
        valueEl.textContent = "—";
        statusEl.textContent = "No data";
        statusEl.style.color = uiColors.textMuted;
      }
    },
  };
}
