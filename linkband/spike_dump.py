"""Spike: 30s raw BLE dump from Link Band — seeds parser fixtures.

Output: tests/fixtures/real/{eeg,ppg,acc,battery}.txt; one line = `<usec_hex>\\t<packet_hex>`.
Spec §3 (UUIDs), §5.1 (start sequence). 일회성 스파이크 — 본체 ble.py 와 별개.
"""

import asyncio
import time
from contextlib import ExitStack
from pathlib import Path

from bleak import BleakClient, BleakScanner
from bleak.exc import BleakError

EEG_NOTIFY = "00ab4d15-66b4-0d8a-824f-8d6f8966c6e5"
EEG_WRITE = "0065cacb-9e52-21bf-a849-99a80d83830e"
PPG_NOTIFY = "6c739642-23ba-818b-2045-bfe8970263f6"
ACC_NOTIFY = "d3d46a35-4394-e9aa-5a43-e7921120aaed"
BATTERY_NOTIFY = "00002a19-0000-1000-8000-00805f9b34fb"
OUT_DIR = Path("tests/fixtures/real")
DURATION_SEC = 30


def _writer(fp):
    def cb(_sender, data: bytearray) -> None:
        fp.write(f"{int(time.time() * 1e6):x}\t{data.hex()}\n")
    return cb


def _on_disconnect(_client) -> None:
    # 끊김 시점을 즉시 찍어서 — 활성화 단계에서 끊겼는지, 스트리밍 중간이었는지 사후 구분.
    print(f"!! BLE disconnected (usec={int(time.time() * 1e6):x})")


async def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("scanning for LXB- ...")
    dev = await BleakScanner.find_device_by_filter(
        lambda d, _ad: bool(d.name and d.name.startswith("LXB-")), timeout=10.0)
    if dev is None:
        raise SystemExit("no LXB- found — pair in Windows Settings → Bluetooth first?")
    print(f"found {dev.name} @ {dev.address}")
    with ExitStack() as stack:
        fs = {n: stack.enter_context(open(OUT_DIR / f"{n}.txt", "w", encoding="utf-8", buffering=1))
              for n in ("eeg", "ppg", "acc", "battery")}
        async with BleakClient(dev, disconnected_callback=_on_disconnect) as c:
            await c.start_notify(BATTERY_NOTIFY, _writer(fs["battery"]))
            await c.write_gatt_char(EEG_WRITE, b"start", response=True)
            await asyncio.sleep(1.0)
            await c.start_notify(EEG_NOTIFY, _writer(fs["eeg"]))
            await c.start_notify(ACC_NOTIFY, _writer(fs["acc"]))
            await c.start_notify(PPG_NOTIFY, _writer(fs["ppg"]))
            print(f"streaming {DURATION_SEC}s ...")
            await asyncio.sleep(DURATION_SEC)
            try:
                await c.write_gatt_char(EEG_WRITE, b"stop", response=True)
            except BleakError as e:
                print(f"(stop write skipped — already disconnected: {e})")
    print(f"done — see {OUT_DIR}")


if __name__ == "__main__":
    asyncio.run(main())
