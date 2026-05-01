// Link Band frontend entry — Web Bluetooth + parser + ECharts views.
//
// Activation sequence mirrors spec §5.1: Battery notify first → EEG `start`
// write → 1s wait → EEG/ACC/PPG notify in queue order. Same as the Python
// `reference-py/linkband/spike_dump.py`.
//
// Live BLE notifications and Replay (fetch the dump txt files from
// reference-py) both feed the same on{Eeg,Ppg,Acc,Bat}Bytes pipeline,
// which calls parser, then forwards the typed batch to the corresponding
// view (src/ui/{eeg,ppg,acc}-view.ts). Battery is just a header-pill text.

import { Parser, parseBattery } from "./linkband/parser";
import { createAccView } from "./ui/acc-view";
import { createEegView } from "./ui/eeg-view";
import { createPpgView } from "./ui/ppg-view";
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

const parser = new Parser();

// Views — single instance per sensor, never disposed (page lifetime).
const eegContainer = document.getElementById("eeg-container");
const ppgContainer = document.getElementById("ppg-container");
const accContainer = document.getElementById("acc-container");
if (!eegContainer || !ppgContainer || !accContainer) {
  throw new Error("layout containers missing — check index.html");
}
const eegView = createEegView(eegContainer);
const ppgView = createPpgView(ppgContainer);
const accView = createAccView(accContainer);

function setStatus(text: string): void {
  const el = document.getElementById("status");
  if (el) el.textContent = text;
}

function setBattery(text: string): void {
  const el = document.getElementById("battery");
  if (el) el.textContent = text;
}

function onEegBytes(data: Uint8Array): void {
  const batch = parser.parseEeg(data);
  eegView.onBatch(batch);
}

function onPpgBytes(data: Uint8Array): void {
  const batch = parser.parsePpg(data);
  ppgView.onBatch(batch);
}

function onAccBytes(data: Uint8Array): void {
  const batch = parser.parseAcc(data);
  accView.onBatch(batch);
}

function onBatBytes(data: Uint8Array): void {
  const status = parseBattery(data);
  setBattery(`Battery ${status.level}%`);
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

// ─── Replay (디바이스 없이 동작 검증, dev 전용) ──────────────────────────

async function replayStream(
  url: string,
  handler: (data: Uint8Array) => void,
  cadenceMs: number,
): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const txt = await res.text();
  const lines = txt.split("\n").filter((l) => l.length > 0);
  for (const line of lines) {
    const hex = line.split("\t")[1];
    if (!hex) continue;
    const matches = hex.match(/.{2}/g);
    if (!matches) continue;
    const bytes = Uint8Array.from(matches.map((b) => parseInt(b, 16)));
    try {
      handler(bytes);
    } catch (err) {
      console.warn(`replay handler failed for ${url}`, err);
    }
    await new Promise((r) => setTimeout(r, cadenceMs));
  }
}

async function probeFixtureRoot(): Promise<string | null> {
  for (const root of [
    "/reference-py/tests/fixtures/real1",
    "/reference-py/tests/fixtures/real",
  ]) {
    const probe = await fetch(`${root}/eeg.txt`).catch(() => null);
    if (probe?.ok) return root;
  }
  return null;
}

async function replay(): Promise<void> {
  setStatus("locating fixtures …");
  const root = await probeFixtureRoot();
  if (!root) {
    setStatus("error: fixture root not reachable (try `npm run dev`)");
    return;
  }
  setStatus(`replaying from ${root} …`);
  await Promise.all([
    replayStream(`${root}/eeg.txt`, onEegBytes, 50),
    replayStream(`${root}/ppg.txt`, onPpgBytes, 560),
    replayStream(`${root}/acc.txt`, onAccBytes, 1200),
  ]);
  setStatus("replay done");
}

document.getElementById("replay")?.addEventListener("click", () => {
  replay().catch((err: unknown) => {
    console.error(err);
    setStatus(`replay error: ${err instanceof Error ? err.message : String(err)}`);
  });
});
