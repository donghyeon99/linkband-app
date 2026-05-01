// Link Band BLE GATT UUIDs (spec §3, BleManager.kt:32–47).

export const EEG_SERVICE = "df7b5d95-3afe-00a1-084c-b50895ef4f95";
export const EEG_NOTIFY = "00ab4d15-66b4-0d8a-824f-8d6f8966c6e5";
export const EEG_WRITE = "0065cacb-9e52-21bf-a849-99a80d83830e";

export const PPG_SERVICE = "1cc50ec0-6967-9d84-a243-c2267f924d1f";
export const PPG_NOTIFY = "6c739642-23ba-818b-2045-bfe8970263f6";

export const ACC_SERVICE = "75c276c3-8f97-20bc-a143-b354244886d4";
export const ACC_NOTIFY = "d3d46a35-4394-e9aa-5a43-e7921120aaed";

// 표준 BLE Battery Service (0x180F / 0x2A19).
export const BATTERY_SERVICE = 0x180f;
export const BATTERY_NOTIFY = 0x2a19;
