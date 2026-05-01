/**
 * 차트 공통 스타일 (sensor-dashboard `src/lib/charts/theme.ts` 포팅).
 *
 * 색상·축 라벨 스타일·legend 스타일을 한 곳에서 정의해서 EEG/PPG/ACC view 가
 * 공유한다. sensor-dashboard 의 dark theme 색상 그대로 (Design Ref: §3.4).
 */

export const chartColors = {
  // EEG channel colors
  ch1Filtered: "#3b82f6", // FP1 — blue (RawDataChart 의 ch1 색)
  ch2Filtered: "#ef4444", // FP2 — red
  // PPG colors
  ir: "#a855f7",
  red: "#ef4444",
  bpm: "#ef4444",
  // ACC axis colors
  accX: "#ef4444",
  accY: "#4ade80",
  accZ: "#3b82f6",
  magnitude: "#facc15",
  // Lead-off / warning highlight
  warn: "#ef4444",
  warnBg: "rgba(127, 29, 29, 0.2)",
  warnBorder: "rgba(239, 68, 68, 0.3)",
  // Axis & grid
  axisLabel: "#8888aa",
  gridLine: "rgba(255,255,255,0.05)",
} as const;

export const axisLabelStyle = {
  color: chartColors.axisLabel,
  fontSize: 10,
};

export const splitLineStyle = {
  lineStyle: { color: chartColors.gridLine },
};

export const legendTextStyle = {
  color: chartColors.axisLabel,
  fontSize: 11,
};

/** Dark UI base colors (sensor-dashboard 의 `bg-section-bg` / `text-metric-*` 토큰 매핑). */
export const uiColors = {
  bgBase: "#0a0a0e",
  bgSection: "#15151c",
  bgElevated: "#1d1d27",
  border: "rgba(255,255,255,0.08)",
  textPrimary: "#e5e7eb",
  textSecondary: "#a8a8b8",
  textMuted: "#6b6b7e",
  accent: "#10b981",
} as const;

/** rgba helper — 16진수 hex + alpha 0..1 → CSS rgba. */
export function rgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** ECharts area 그라디언트 — 투명한 위쪽 → 더 투명한 아래쪽. */
export function areaGradient(hex: string, topAlpha = 0.3, bottomAlpha = 0.05) {
  return {
    type: "linear" as const,
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: rgba(hex, topAlpha) },
      { offset: 1, color: rgba(hex, bottomAlpha) },
    ],
  };
}
