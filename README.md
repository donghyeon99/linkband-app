# linkband-app

Link Band BLE SDK — browser app (TypeScript + Web Bluetooth API), deployable as a
single static SPA.

Educational tool: students access via URL on Chromium-based browsers (Chrome / Edge),
click Connect, and stream EEG / PPG / accelerometer data from the headband directly
to the browser. No backend server.

## Status

- Protocol spec is locked in `docs/01-protocol-spec.md` based on reverse-engineering
  the official [SDK-Android](https://github.com/LooxidLabs/SDK-Android) (Kotlin) and
  [link_band_sdk](https://github.com/LooxidLabs/link_band_sdk) (Python+Electron) repos,
  plus on-device verification.
- TypeScript implementation is in: BLE GATT scan/connect, packet parser
  (15 parser tests + 67 DSP tests, all GREEN), DSP (EEG filter cascade, PPG
  bandpass, EEG/PPG SQI, FFT spectrum, Morlet wavelet band power, EEG indices,
  HRV/HR with IQR+weighted+gated BPM), and visualization (EEG / PPG / ACC views
  with rich threshold-aware cards and hover tooltips matching the
  [sdk.linkband.store](https://sdk.linkband.store) reference).
- Numerical results reconciled against the deployed reference on 2026-05-02 — see
  the `[FIX] [PROGRESS]` entry in `docs/02-progress-log.md` (DSP formulas /
  visualization / ACC unit fix).
- Deployable as a Vercel static SPA. Web Bluetooth requires Chromium (Chrome /
  Edge), HTTPS or localhost, and a user gesture (button click) to call
  `requestDevice()`.

For implementation history and decision log, see `docs/02-progress-log.md`.

## Architecture

```
[Link Band headband] ──BLE (Web Bluetooth)──> [Browser TS app]
                                              · GATT scan / connect
                                              · packet parse (parser.ts)
                                              · DSP (filters, SQI, spectrum, indices)
                                              · ECharts visualization
                                              · Real-time WS-style update loop
```

UI is vanilla TypeScript + ECharts (no React). Charts are throttled by frame
counter — filtered traces tick every batch (50 ms), heavy DSP (band power /
indices / Morlet wavelet) every 10 batches (500 ms) — to keep the main thread
responsive.

## Repo layout

```
linkband-app/
├── docs/                     ← spec + progress log (language-agnostic)
├── src/
│   ├── linkband/             ← models.ts, parser.ts, dsp.ts, thresholds.ts
│   ├── ui/                   ← eeg-view, ppg-view, acc-view, chart, *-card
│   └── main.ts
├── tests/                    ← vitest (parser + DSP)
├── package.json              ← TS deps (Vite + TS strict)
├── tsconfig.json
├── vite.config.ts
├── index.html
└── reference-py/             ← Python reference implementation (frozen)
    ├── pyproject.toml        ← Python deps (uv)
    ├── linkband/             ← models.py, parser.py, spike_dump.py
    └── tests/                ← pytest + spike dump fixtures
```

The Python implementation under `reference-py/` is the canonical numerical
reference against which the TS parser is validated. It is frozen at commit
`be16261` (15/15 parser tests GREEN); ongoing development happens in TypeScript
at the repo root.

## Setup

### TypeScript app (primary)

```bash
npm install
npm run dev        # vite dev server (Chromium browser)
npm run build      # production build → dist/
npm run test:run   # vitest (parser + DSP suites)
```

### Python reference (validation only)

```bash
cd reference-py
uv sync
uv run pytest                            # parser test suite
uv run python -m linkband.spike_dump     # 30s BLE dump (needs device)
```

## License

TBD
