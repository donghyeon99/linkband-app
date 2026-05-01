/**
 * Link Band DSP — TS port of sensor-dashboard `src/lib/dsp/{biquad,eegPipeline,spectrum}.ts`.
 *
 * 단일 파일로 통합 — sensor-dashboard 의 3 파일 (`biquad.ts`, `eegPipeline.ts`,
 * `spectrum.ts`) 의 함수·상수를 한 곳에. SQI / 분석 지표 등도 추후 이 파일에 추가.
 *
 * **fs 차이 (중요)**: sensor-dashboard 는 `EEG_SAMPLE_RATE = 250` 가정.
 * 우리 spec §7 / §17 Q7 실측 확정값은 **500Hz**. 하드코드 250 직접 복사하면 모든
 * 필터 cutoff 가 절반 이상으로 어긋남. 본 포팅은 `EEG_SAMPLE_RATE = EEG_FS = 500`
 * 으로 갱신, 모든 시간-기반 상수 (transient 등) 같은 비율로 스케일.
 *
 * 본 commit 범위: biquad primitives + EEG 단일-샘플 필터 cascade (notch → HP → LP).
 * spectrum / SQI / indices 는 후속 commits.
 */
import { EEG_FS } from "./models";

// ─── Biquad primitives (sensor-dashboard `biquad.ts` 미러) ────────────────

export interface BiquadState {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

export interface BiquadCoefs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export const createBiquadState = (): BiquadState => ({ x1: 0, x2: 0, y1: 0, y2: 0 });

/** RBJ notch — `f0` 주변 좁은 stopband. Q 가 클수록 더 좁음. */
export function notchCoefs(sampleRate: number, f0: number, q: number): BiquadCoefs {
  const w0 = (2 * Math.PI * f0) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: 1 / a0,
    b1: (-2 * cos) / a0,
    b2: 1 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** RBJ 2-pole highpass — `f0` 이하 차단. Butterworth 면 Q = 1/√2. */
export function highpassCoefs(sampleRate: number, f0: number, q: number): BiquadCoefs {
  const w0 = (2 * Math.PI * f0) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: ((1 + cos) / 2) / a0,
    b1: (-(1 + cos)) / a0,
    b2: ((1 + cos) / 2) / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** RBJ 2-pole lowpass — `f0` 이상 차단. */
export function lowpassCoefs(sampleRate: number, f0: number, q: number): BiquadCoefs {
  const w0 = (2 * Math.PI * f0) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: ((1 - cos) / 2) / a0,
    b1: (1 - cos) / a0,
    b2: ((1 - cos) / 2) / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** RBJ "constant 0 dB peak gain" bandpass — `f0` 중심 통과대. linkband Yf 와 호환. */
export function bandpassCoefs(sampleRate: number, f0: number, q: number): BiquadCoefs {
  const w0 = (2 * Math.PI * f0) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: alpha / a0,
    b1: 0,
    b2: -alpha / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** linkband Yf.calcBandpassQ — band-pass Q 산식. */
export function calcLinkbandBandpassQ(fLow: number, fHigh: number): number {
  const fc = (fLow + fHigh) / 2;
  const bw = fHigh - fc;
  const n = Math.pow(10, Math.floor(Math.log10(fc)));
  return (n * Math.sqrt((fc - bw) * (fc + bw))) / (2 * bw);
}

/** linkband Yf.calcNotchQ — notch Q 산식 (대역폭 `bw` 기반). */
export function calcLinkbandNotchQ(f0: number, bw: number): number {
  const n = Math.pow(10, Math.floor(Math.log10(f0)));
  return (n * f0 * bw) / Math.sqrt((f0 - bw) * (f0 + bw));
}

/** Direct-form II transposed biquad — 한 샘플 처리 후 state 갱신. */
export function processBiquad(coefs: BiquadCoefs, state: BiquadState, x: number): number {
  const y =
    coefs.b0 * x +
    coefs.b1 * state.x1 +
    coefs.b2 * state.x2 -
    coefs.a1 * state.y1 -
    coefs.a2 * state.y2;
  state.x2 = state.x1;
  state.x1 = x;
  state.y2 = state.y1;
  state.y1 = y;
  return y;
}

// ─── EEG filter cascade (sensor-dashboard `eegPipeline.ts` 미러, fs 갱신) ──

export const EEG_SAMPLE_RATE = EEG_FS; // 500 (sensor-dashboard 의 250 → 500)
/** 1초 transient (필터 settling). sensor-dashboard 에서 250 (1s @ 250Hz) → 500 (1s @ 500Hz). */
export const EEG_TRANSIENT_SAMPLES = EEG_FS;

const BUTTERWORTH_Q = 1 / Math.SQRT2;
const NOTCH_COEFS = notchCoefs(EEG_SAMPLE_RATE, 60, 2); // Q=2 linkband 호환
const HP_COEFS = highpassCoefs(EEG_SAMPLE_RATE, 1, BUTTERWORTH_Q);
const LP_COEFS = lowpassCoefs(EEG_SAMPLE_RATE, 45, BUTTERWORTH_Q);

export interface EegChannelFilter {
  notch: BiquadState;
  hp: BiquadState;
  lp: BiquadState;
  samplesProcessed: number;
}

export const createEegChannelFilter = (): EegChannelFilter => ({
  notch: createBiquadState(),
  hp: createBiquadState(),
  lp: createBiquadState(),
  samplesProcessed: 0,
});

/**
 * EEG 단일 raw 샘플 → notch (60Hz) → HP (1Hz) → LP (45Hz) cascade 후 filtered 값.
 * `filter` 를 in-place 갱신. transient (`EEG_TRANSIENT_SAMPLES` 동안) 에선 0 반환.
 */
export function processEegSample(filter: EegChannelFilter, sample: number): number {
  const n = processBiquad(NOTCH_COEFS, filter.notch, sample);
  const h = processBiquad(HP_COEFS, filter.hp, n);
  const l = processBiquad(LP_COEFS, filter.lp, h);
  const out = filter.samplesProcessed < EEG_TRANSIENT_SAMPLES ? 0 : l;
  filter.samplesProcessed++;
  return out;
}
