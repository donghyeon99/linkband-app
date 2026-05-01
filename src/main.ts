// Link Band — first milestone: scan, connect, subscribe to all four sensor
// notifications, and display per-sensor packet/byte counts. No parsing yet.
//
// Activation sequence mirrors spec §5.1: Battery notify first → EEG `start`
// write → 1s wait → EEG/ACC/PPG notify in queue order. Same as the Python
// `linkband/spike_dump.py` reference.

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

function setStatus(text: string): void {
  const el = document.getElementById("status");
  if (el) el.textContent = text;
}

function bumpCounter(sensor: Sensor, data: DataView): void {
  counters[sensor].packets += 1;
  counters[sensor].bytes += data.byteLength;

  const row = document.getElementById(`row-${sensor}`);
  if (!row) return;
  row.querySelector(".pkt")!.textContent = String(counters[sensor].packets);
  row.querySelector(".byt")!.textContent = String(counters[sensor].bytes);

  const previewLen = Math.min(data.byteLength, 16);
  const u8 = new Uint8Array(data.buffer, data.byteOffset, previewLen);
  const hex = Array.from(u8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
  row.querySelector(".hex")!.textContent =
    hex + (data.byteLength > previewLen ? " ..." : "");
}

function makeHandler(sensor: Sensor): (event: Event) => void {
  return (event) => {
    const target = event.target as BluetoothRemoteGATTCharacteristic;
    if (target.value) bumpCounter(sensor, target.value);
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
