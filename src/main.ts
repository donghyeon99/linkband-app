// Link Band frontend — scan/connect via Web Bluetooth, parse incoming BLE
// notifications via `linkband/parser.ts`, and render decoded values per sensor.
//
// Activation sequence mirrors spec §5.1: Battery notify first → EEG `start`
// write → 1s wait → EEG/ACC/PPG notify in queue order. Same as the Python
// `reference-py/linkband/spike_dump.py` reference.
//
// `on{Eeg,Ppg,Acc,Bat}Bytes` are the single processing path — both live BLE
// handlers and (next milestone) replay funnel through them, so any logic
// lives once and works for both sources.

import { Parser, parseBattery } from "./linkband/parser";
import {
  ACC_NOTIFY,
  ACC_SERVICE,
  BATTERY_NOTIFY,
  BATTERY_SERVICE,
  EEG_NOTIFY,
  EEG_SERVICE,
  EEG_WRITE,
  PPG_NOTIFY,
  PPG_SERVICE,
} from "./uuids";

type Sensor = "eeg" | "ppg" | "acc" | "bat";

const counters: Record<Sensor, { packets: number; bytes: number }> = {
  eeg: { packets: 0, bytes: 0 },
  ppg: { packets: 0, bytes: 0 },
  acc: { packets: 0, bytes: 0 },
  bat: { packets: 0, bytes: 0 },
};

const parser = new Parser();

function setStatus(text: string): void {
  const el = document.getElementById("status");
  if (el) el.textContent = text;
}

function bumpCounter(sensor: Sensor, byteLength: number): void {
  counters[sensor].packets += 1;
  counters[sensor].bytes += byteLength;
  const row = document.getElementById(`row-${sensor}`);
  if (!row) return;
  row.querySelector(".pkt")!.textContent = String(counters[sensor].packets);
  row.querySelector(".byt")!.textContent = String(counters[sensor].bytes);
}

function setDetail(sensor: Sensor, text: string): void {
  const el = document.querySelector(`#row-${sensor} .detail`);
  if (el) el.textContent = text;
}

function onEegBytes(data: Uint8Array): void {
  bumpCounter("eeg", data.byteLength);
  const batch = parser.parseEeg(data);
  const last = batch.ch1Uv.length - 1;
  if (last < 0) return;
  setDetail(
    "eeg",
    `ch1=${batch.ch1Uv[last].toFixed(1)}μV  ch2=${batch.ch2Uv[last].toFixed(1)}μV  leadOff=${
      batch.leadOff[last] ? "Y" : "N"
    }  t=${batch.tDevice.toFixed(2)}s`,
  );
}

function onPpgBytes(data: Uint8Array): void {
  bumpCounter("ppg", data.byteLength);
  const batch = parser.parsePpg(data);
  const last = batch.red.length - 1;
  if (last < 0) return;
  setDetail("ppg", `RED=${batch.red[last]}  IR=${batch.ir[last]}`);
}

function onAccBytes(data: Uint8Array): void {
  bumpCounter("acc", data.byteLength);
  const batch = parser.parseAcc(data);
  const last = batch.x.length - 1;
  if (last < 0) return;
  setDetail("acc", `x=${batch.x[last]}  y=${batch.y[last]}  z=${batch.z[last]}`);
}

function onBatBytes(data: Uint8Array): void {
  bumpCounter("bat", data.byteLength);
  const status = parseBattery(data);
  setDetail("bat", `level=${status.level}%`);
}

const dispatch: Record<Sensor, (data: Uint8Array) => void> = {
  eeg: onEegBytes,
  ppg: onPpgBytes,
  acc: onAccBytes,
  bat: onBatBytes,
};

function makeHandler(sensor: Sensor): (event: Event) => void {
  return (event) => {
    const target = event.target as BluetoothRemoteGATTCharacteristic;
    if (!target.value) return;
    const data = new Uint8Array(
      target.value.buffer,
      target.value.byteOffset,
      target.value.byteLength,
    );
    try {
      dispatch[sensor](data);
    } catch (err) {
      console.warn(`${sensor} parse failed`, err);
    }
  };
}

async function connect(): Promise<void> {
  setStatus("requesting device …");
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ namePrefix: "LXB-" }],
    optionalServices: [EEG_SERVICE, PPG_SERVICE, ACC_SERVICE, BATTERY_SERVICE],
  });

  setStatus(`connecting to ${device.name ?? "?"} …`);
  if (!device.gatt) throw new Error("no GATT server on device");
  const server = await device.gatt.connect();

  device.addEventListener("gattserverdisconnected", () => {
    setStatus("disconnected");
    // BLE 재연결 시 보간 시각 리셋 (spec §13).
    parser.resetEegTimestamps();
    parser.resetPpgTimestamps();
    parser.resetAccTimestamps();
  });

  // spec §5.1 활성화 순서: Battery 먼저 → EEG start write → 1s 대기 → EEG/ACC/PPG.
  const batSvc = await server.getPrimaryService(BATTERY_SERVICE);
  const batCh = await batSvc.getCharacteristic(BATTERY_NOTIFY);
  await batCh.startNotifications();
  batCh.addEventListener("characteristicvaluechanged", makeHandler("bat"));

  const eegSvc = await server.getPrimaryService(EEG_SERVICE);
  const eegWriteCh = await eegSvc.getCharacteristic(EEG_WRITE);
  await eegWriteCh.writeValueWithResponse(new TextEncoder().encode("start"));
  await new Promise((r) => setTimeout(r, 1000));

  const eegNotifyCh = await eegSvc.getCharacteristic(EEG_NOTIFY);
  await eegNotifyCh.startNotifications();
  eegNotifyCh.addEventListener("characteristicvaluechanged", makeHandler("eeg"));

  const accSvc = await server.getPrimaryService(ACC_SERVICE);
  const accNotifyCh = await accSvc.getCharacteristic(ACC_NOTIFY);
  await accNotifyCh.startNotifications();
  accNotifyCh.addEventListener("characteristicvaluechanged", makeHandler("acc"));

  const ppgSvc = await server.getPrimaryService(PPG_SERVICE);
  const ppgNotifyCh = await ppgSvc.getCharacteristic(PPG_NOTIFY);
  await ppgNotifyCh.startNotifications();
  ppgNotifyCh.addEventListener("characteristicvaluechanged", makeHandler("ppg"));

  setStatus(`streaming from ${device.name ?? "?"}`);
}

document.getElementById("connect")?.addEventListener("click", () => {
  connect().catch((err: unknown) => {
    console.error(err);
    setStatus(`error: ${err instanceof Error ? err.message : String(err)}`);
  });
});
