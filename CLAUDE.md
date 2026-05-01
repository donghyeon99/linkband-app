# linkband-app — Project Context

## What this is

Educational sensor analysis tool. Python implements the full **Link Band BLE SDK**
(connection, packet parsing, DSP, metric computation). React side is a thin viewer
that consumes WebSocket messages — no business logic on the frontend.

End users are **students**. Implementation is by the repo owner (donghyeon99);
students consume the resulting Python package and notebooks rather than co-authoring.

## Status

- **Protocol spec is locked**: `docs/01-protocol-spec.md` (533 lines, reverse-engineered
  from [LooxidLabs/SDK-Android](https://github.com/LooxidLabs/SDK-Android) Kotlin SDK
  and [LooxidLabs/link_band_sdk](https://github.com/LooxidLabs/link_band_sdk) Python core).
- **Bundle 1 (data model)** and **Bundle 2 (open questions strategy)** decisions are
  LOCKED — see §13 and §17 of the spec. Do not re-debate these unless explicitly flagged.
- **Bundle 3 (API surface for student DX)** and **Bundle 4 (WebSocket format / repo
  layout / MVP order)** are deferred — to be revisited once code skeleton exists.
- **No code yet.** First commit (`a0ac3cd`) is empty scaffold.

## Architecture

```
[Link Band headband] ──BLE──> [Python] ──WebSocket──> [React viewer]
                              · BLE connect (bleak)
                              · packet parse
                              · DSP filters
                              · metrics (BPM, HRV, band power)
```

## Immediate next step (P0 from spec §16)

Implement **`linkband/models.py`** per spec §13.

- Method **가** (assistant drafts → owner reviews → commit) for this file.
- After this file the method may switch to **나** (owner writes → assistant reviews) —
  confirm at the time.
- After `models.py`: `linkband/parser.py` (testable with synthetic packets, no real
  device needed). Then `linkband/ble.py` (needs real device).

## Working style preferences

- Professional Python: type hints, dataclasses, numpy. Educational comments only for
  the **WHY** (e.g., 24-bit sign-extension, μV conversion formula).
- **numpy batch dataclasses**, not per-sample objects (250 Hz EEG would explode).
- `uv` for dependency management. `uv sync` to set up.
- Python **3.12**.
- Format/lint: `ruff` (configured in pyproject.toml).

## Locked decisions (do NOT re-litigate)

From spec §13 (Bundle 1):
- Timestamps: `t_device` (header) + `t_recv` (wall-clock) both stored
- EEG: raw int + μV float both stored
- `t_start` as float epoch sec
- Sample timestamps interpolated uniformly from packet header (Kotlin parity)
- ACC dtype: `int16`; decoder isolated as `_decode_acc_sample()` for hypothesis A/B swap
- `lead_off: bool` (Kotlin parity) + `lead_off_raw: uint8` (bitmask preservation)

From spec §17 (Bundle 2): the six open questions Q1–Q6 are documented as
**verification-only**, with strategies in place that don't depend on resolution.
They get answered when a real device is first connected.

## Reference material (not in repo)

Original Kotlin SDK files were downloaded to `../sensor-dashboard/.tmp_kotlin/`
during analysis (gitignored, kept for cross-checking parser logic).

## Conversation history

This repo was scaffolded on 2026-05-01 in a Claude Code session whose cwd was the
sibling repo `../sensor-dashboard/` (the previous mock-data based dashboard). The
spec was developed and locked in that session. Subsequent work continues in this
repo. The previous session's work is archived in
`../sensor-dashboard/docs/linkband-sdk-spec/01-protocol-spec.md` (identical to
this repo's `docs/01-protocol-spec.md`).
