"""Link Band BLE 패킷 파서.

각 센서 패킷을 numpy batch (`linkband.models.*Batch`) 로 변환한다.
인스턴스 상태는 spec §13 보간 규칙용 — 마지막 샘플 시각을 센서별로 기억해서
패킷 사이 균일한 1/fs 간격을 유지한다 (Kotlin `lastEegSampleTimestampMillis` 미러).

원전 비교 (`SDK-Android/SensorDataParser.kt`):
- 헤더 LE u32 + 32.768kHz 분주: line 78–80, 그대로 미러.
- EEG 24-bit BE + 부호확장 + μV: line 91–96, 그대로 미러.
- PPG 24-bit BE: line 144–145 의 `& 0xFF` 누락 버그 회피 — Python int 는 본디
  비음수 (spec §8.1).
- ACC: line 187–189 가 LSB(인덱스 0/2/4)를 누락하는 버그가 있어 우리는 16-bit LE
  로 정정 (spec §9.1, §17 Q1, 2026-05-01 실측 확정).
- 패킷 간 샘플 시각 보간: line 82, 109–111 의 lastSampleTimestamp 로직 미러
  (spec §13 Q1.4).
"""

import time

import numpy as np

from linkband.models import AccBatch, BatteryStatus, EegBatch, PpgBatch

# spec §6.1 — 32.768 kHz 펌웨어 RTC 분주
_TICKS_PER_SEC = 32768.0

# spec §7.2 — μV 변환식 상수
_EEG_VREF = 4.033
_EEG_GAIN = 12.0
_EEG_RES = 8388607.0  # 2^23 - 1
_EEG_UV_FACTOR = _EEG_VREF / _EEG_GAIN / _EEG_RES * 1e6  # ≈ 0.040064 μV/LSB

_HEADER_SIZE = 4

# 센서별 fs / 샘플 크기 (spec §7, §8, §9, §17 Q7)
_EEG_FS = 500
_EEG_SAMPLE_SIZE = 7  # leadOff(1) + ch1_be_s24(3) + ch2_be_s24(3)
_PPG_FS = 50
_PPG_SAMPLE_SIZE = 6  # red_be_u24(3) + ir_be_u24(3)
_ACC_FS = 25
_ACC_SAMPLE_SIZE = 6  # x_le_s16(2) + y_le_s16(2) + z_le_s16(2)


def _header_seconds(packet: bytes) -> float:
    """패킷 첫 4 바이트 LE u32 → boot-relative epoch sec (spec §6.1, §17 Q6)."""
    raw = int.from_bytes(packet[:_HEADER_SIZE], "little", signed=False)
    return raw / _TICKS_PER_SEC


def _decode_acc_sample(buf: bytes) -> tuple[int, int, int]:
    """6-byte ACC 샘플 → (x, y, z) 16-bit signed Little-Endian (spec §9.1, §17 Q1).

    각 축 2 bytes LE. Kotlin SDK 의 LSB 누락 버그를 회피한 정정 디코더 —
    인덱스 0(LSB) 와 1(MSB) 둘 다 데이터로 취급.
    """
    x = int.from_bytes(buf[0:2], "little", signed=True)
    y = int.from_bytes(buf[2:4], "little", signed=True)
    z = int.from_bytes(buf[4:6], "little", signed=True)
    return x, y, z


def parse_battery(data: bytes) -> BatteryStatus:
    """1-byte 퍼센트 → BatteryStatus (spec §11). 헤더 없음, stateless."""
    if not data:
        raise ValueError("empty battery payload")
    return BatteryStatus(t_recv=time.time(), level=data[0])


class Parser:
    """헤드밴드 패킷 → numpy batch. 인스턴스 상태로 샘플 시각을 보간한다.

    Use:
        parser = Parser()
        eeg = parser.parse_eeg(packet_bytes)   # EegBatch
        ppg = parser.parse_ppg(packet_bytes)   # PpgBatch
        acc = parser.parse_acc(packet_bytes)   # AccBatch
        # BLE 재연결/센서 재시작 시 보간 시각 리셋
        parser.reset_eeg_timestamps()
    """

    def __init__(self) -> None:
        # 직전 패킷의 *마지막* 샘플 시각 (sec). None 이면 다음 패킷의 헤더로 초기화.
        self._last_eeg_t: float | None = None
        self._last_ppg_t: float | None = None
        self._last_acc_t: float | None = None

    # ─── reset (재연결 시) ───────────────────────────────────────────────────

    def reset_eeg_timestamps(self) -> None:
        self._last_eeg_t = None

    def reset_ppg_timestamps(self) -> None:
        self._last_ppg_t = None

    def reset_acc_timestamps(self) -> None:
        self._last_acc_t = None

    # ─── EEG (spec §7) ───────────────────────────────────────────────────────

    def parse_eeg(self, data: bytes) -> EegBatch:
        """179-byte EEG 패킷 → 25-샘플 EegBatch (fs=500). spec §7.

        샘플 레이아웃: 1 byte leadOff + 3-byte BE signed CH1 + 3-byte BE signed CH2.
        μV = raw × 4.033 / 12 / 8388607 × 1e6 (spec §7.2).
        """
        n = (len(data) - _HEADER_SIZE) // _EEG_SAMPLE_SIZE
        first_t = self._first_sample_time(self._last_eeg_t, _header_seconds(data), _EEG_FS)

        ch1_raw = np.empty(n, dtype=np.int32)
        ch2_raw = np.empty(n, dtype=np.int32)
        lead_off_raw = np.empty(n, dtype=np.uint8)
        for i in range(n):
            off = _HEADER_SIZE + i * _EEG_SAMPLE_SIZE
            lead_off_raw[i] = data[off]
            # `int.from_bytes(..., signed=True)` 가 24-bit two's complement 부호확장을 한 번에 처리
            ch1_raw[i] = int.from_bytes(data[off + 1 : off + 4], "big", signed=True)
            ch2_raw[i] = int.from_bytes(data[off + 4 : off + 7], "big", signed=True)
        lead_off = lead_off_raw > 0  # Kotlin parity: leadOff > 0
        ch1_uv = ch1_raw.astype(np.float64) * _EEG_UV_FACTOR
        ch2_uv = ch2_raw.astype(np.float64) * _EEG_UV_FACTOR

        self._last_eeg_t = first_t + (n - 1) / _EEG_FS
        return EegBatch(
            t_device=first_t,
            t_recv=time.time(),
            fs=_EEG_FS,
            ch1_uv=ch1_uv,
            ch2_uv=ch2_uv,
            ch1_raw=ch1_raw,
            ch2_raw=ch2_raw,
            lead_off=lead_off,
            lead_off_raw=lead_off_raw,
        )

    # ─── PPG (spec §8) ───────────────────────────────────────────────────────

    def parse_ppg(self, data: bytes) -> PpgBatch:
        """172-byte PPG 패킷 → 28-샘플 PpgBatch (fs=50). spec §8.

        샘플 레이아웃: 3-byte BE unsigned RED + 3-byte BE unsigned IR.
        Kotlin SDK 의 sign-extension 버그(`& 0xFF` 누락) 회피 — Python int 는 본디
        비음수라 `signed=False` 로 0..0xFFFFFF 안전 (spec §8.1).
        """
        n = (len(data) - _HEADER_SIZE) // _PPG_SAMPLE_SIZE
        first_t = self._first_sample_time(self._last_ppg_t, _header_seconds(data), _PPG_FS)

        red = np.empty(n, dtype=np.int32)
        ir = np.empty(n, dtype=np.int32)
        for i in range(n):
            off = _HEADER_SIZE + i * _PPG_SAMPLE_SIZE
            red[i] = int.from_bytes(data[off : off + 3], "big", signed=False)
            ir[i] = int.from_bytes(data[off + 3 : off + 6], "big", signed=False)

        self._last_ppg_t = first_t + (n - 1) / _PPG_FS
        return PpgBatch(
            t_device=first_t,
            t_recv=time.time(),
            fs=_PPG_FS,
            red=red,
            ir=ir,
        )

    # ─── ACC (spec §9) ───────────────────────────────────────────────────────

    def parse_acc(self, data: bytes) -> AccBatch:
        """184-byte ACC 패킷 → 30-샘플 AccBatch (fs=25). spec §9, §17 Q1.

        각 축 16-bit signed Little-Endian. numpy 의 `<i2` dtype view 로 (n, 3)
        인터리브를 한 번에 분리. `.copy()` 로 read-only buffer 에서 분리.
        """
        n = (len(data) - _HEADER_SIZE) // _ACC_SAMPLE_SIZE
        first_t = self._first_sample_time(self._last_acc_t, _header_seconds(data), _ACC_FS)

        arr = np.frombuffer(data, dtype="<i2", count=n * 3, offset=_HEADER_SIZE).reshape(-1, 3)
        x = arr[:, 0].copy()
        y = arr[:, 1].copy()
        z = arr[:, 2].copy()

        self._last_acc_t = first_t + (n - 1) / _ACC_FS
        return AccBatch(
            t_device=first_t,
            t_recv=time.time(),
            fs=_ACC_FS,
            x=x,
            y=y,
            z=z,
        )

    @staticmethod
    def _first_sample_time(last_t: float | None, header_t: float, fs: int) -> float:
        """spec §13 Q1.4 보간 — 직전 마지막 샘플 + 1/fs, 없으면 헤더 사용."""
        if last_t is None:
            return header_t
        return last_t + 1.0 / fs
