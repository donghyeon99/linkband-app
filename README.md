# linkband-app

Link Band BLE SDK — browser app (TypeScript + Web Bluetooth API), deployable as a
single static SPA.

Educational tool: students access via URL on Chromium-based browsers (Chrome / Edge),
click Connect, and stream EEG / PPG / accelerometer data from the headband directly
to the browser. No backend server.

## Status

WIP. Protocol spec is locked in `docs/01-protocol-spec.md` based on reverse-engineering
the official [SDK-Android](https://github.com/LooxidLabs/SDK-Android) (Kotlin) and
[link_band_sdk](https://github.com/LooxidLabs/link_band_sdk) (Python+Electron) repos,
plus on-device verification (see `docs/02-progress-log.md`).

The first milestone — scan / connect / per-sensor packet count — is implemented in
`src/main.ts`. Parser and visualization are next.

## Architecture

```
[Link Band headband] ──BLE (Web Bluetooth API)──> [Browser TS app]
                                                  · scan / connect / GATT
                                                  · packet parse
                                                  · DSP filters
                                                  · metrics (BPM, HRV, band power)
                                                  · React/Canvas visualization
```

Web Bluetooth requires Chromium (Chrome or Edge), HTTPS or localhost, and a user
gesture (button click) to call `requestDevice()`. Vercel auto-provisions HTTPS so
production is fine.

## Repo layout

```
linkband-app/
├── docs/                     ← spec + progress log (language-agnostic)
├── src/                      ← TypeScript source (primary)
├── tests/                    ← TS tests (vitest, future)
├── package.json              ← TS deps (Vite + TS strict)
├── tsconfig.json
├── vite.config.ts
├── index.html
└── reference-py/             ← Python reference implementation
    ├── pyproject.toml        ← Python deps (uv)
    ├── linkband/             ← models.py, parser.py, spike_dump.py
    └── tests/                ← pytest + spike dump fixtures
```

The Python implementation under `reference-py/` is the canonical numerical reference
against which the TS parser is validated. It is frozen at commit `be16261` (15/15
parser tests GREEN); ongoing development happens in TypeScript at the repo root.

## Setup

### TypeScript app (primary)

```bash
npm install
npm run dev    # vite dev server (Chromium browser)
npm run build  # production build → dist/
```

### Python reference (validation only)

```bash
cd reference-py
uv sync
uv run pytest         # parser test suite
uv run python -m linkband.spike_dump   # 30s BLE dump (needs device)
```

## License

TBD
