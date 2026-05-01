"""linkband.parser 단위 테스트 (tests-first / RED 단계).

본 파일은 `linkband/parser.py` 본체를 작성하기 *전에* 먼저 짜는 사양 표현이다.
`linkband.parser` 가 아직 없으므로 이 시점에 pytest 를 돌리면 collection 단계에서
ImportError 로 전부 실패 — TDD 규칙상 의도된 RED 상태.

각 케이스 docstring 에 spec § 출처를 명시한다.

빌더 헬퍼(`eeg_packet`/`ppg_packet`/`acc_packet`) 는 합성 패킷 생성용으로,
spec §6 (4-byte LE u32 header) + 센서별 샘플 레이아웃을 그대로 구성한다.
boundary 테스트(μV 산식, 부호확장, leadOff)는 합성 패킷, 통합 테스트(179/172/184)는
2026-05-01 spike 의 실 디바이스 line 1 raw bytes 를 fixture 로 박아 넣는다.
"""

import time
from collections.abc import Iterable

import numpy as np
import pytest
from linkband.parser import Parser, _decode_acc_sample, parse_battery

from linkband.models import AccBatch, BatteryStatus, EegBatch, PpgBatch

# ─────────────────────────────────────────────────────────────────────────────
# Synthetic packet builders
# spec §6 의 [4-byte header LE u32] + [N × sample] 구조.
# 헤더 timestamp 는 32.768kHz 틱 단위. timeRaw=32768 ⇒ packetTimestampSec = 1.0.
# ─────────────────────────────────────────────────────────────────────────────


def _le_u32(value: int) -> bytes:
    """4-byte little-endian unsigned 32 (spec §6.1 헤더 인코딩)."""
    return value.to_bytes(4, "little", signed=False)


def _be_u24(value: int) -> bytes:
    """3-byte big-endian. 음수면 2의 보수로 인코딩 (24-bit two's complement).

    EEG 채널은 -8388608..8388607 범위, PPG 는 0..16777215 범위에서 사용.
    """
    if value < 0:
        value = value + 0x1000000
    return value.to_bytes(3, "big", signed=False)


def eeg_packet(time_raw: int, samples: Iterable[tuple[int, int, int]]) -> bytes:
    """EEG 합성 패킷: 헤더 + N × (lead_off_u8, ch1_be_s24, ch2_be_s24). spec §7.1."""
    body = bytearray()
    for lead_off, ch1, ch2 in samples:
        body.append(lead_off & 0xFF)
        body += _be_u24(ch1)
        body += _be_u24(ch2)
    return _le_u32(time_raw) + bytes(body)


def ppg_packet(time_raw: int, samples: Iterable[tuple[int, int]]) -> bytes:
    """PPG 합성 패킷: 헤더 + N × (red_be_u24, ir_be_u24). spec §8.1."""
    body = bytearray()
    for red, ir in samples:
        body += _be_u24(red)
        body += _be_u24(ir)
    return _le_u32(time_raw) + bytes(body)


def acc_packet(time_raw: int, samples: Iterable[tuple[int, int, int]]) -> bytes:
    """ACC 합성 패킷: 헤더 + N × (x_le_s16, y_le_s16, z_le_s16). spec §9.1.

    각 축 2 bytes Little-Endian signed (실측 확정, §17 Q1).
    """
    body = bytearray()
    for x, y, z in samples:
        body += int(x).to_bytes(2, "little", signed=True)
        body += int(y).to_bytes(2, "little", signed=True)
        body += int(z).to_bytes(2, "little", signed=True)
    return _le_u32(time_raw) + bytes(body)


# spec §7.2 의 정확한 LSB 값. 산식 그대로 평가:
#   1 × Vref / Gain / Resolution × 1e6 = 1 × 4.033 / 12 / 8388607 × 1e6
# 결과 ≈ 0.040064 μV/LSB. spec 의 "≈ 0.04004" 는 거친 근사 (~0.06% 차).
EEG_LSB_UV = 1.0 * 4.033 / 12.0 / 8388607.0 * 1e6


# ─────────────────────────────────────────────────────────────────────────────
# Real-device fixtures (from tests/fixtures/real/*.txt line 1, 2026-05-01 spike)
# 같은 헤드밴드(LXB-0263003F)의 첫 패킷 raw bytes. Q1/Q6/Q7 검증의 근거.
# ─────────────────────────────────────────────────────────────────────────────

# EEG: 책상 위 미착용 → 모든 25 샘플이 leadOff=0, ch1=ch2=0x7FFFFF (saturated rail).
# 헤더 ticks = 0x00072095 = 467605 → 14.27s @ boot.
EEG_REAL_LINE1 = bytes.fromhex("95200700" + "007fffff7fffff" * 25)

# PPG: 책상 위, 광 센서 정상 동작. 헤더 ticks = 0x0007A6FD = 501501 → 15.305s.
# s1: red=0x004106=16646, ir=0x006032=24626.
PPG_REAL_LINE1 = bytes.fromhex(
    "fda607000041060060320056b300602f0056b70060350056ae0060300056ad00602e0056b200602f"
    "0056b20060280056b30060260056bf00602a0056cf0060360056eb0060450056fe00605800570d00"
    "606900572200607400572000606900571b00605a00571700605200571900606100571c0060570057"
    "2c0060690057800060be00580400614200584f00619600582600617b0057c400613d005770006108"
    "00571f0060c10056d9006071"
)

# ACC: 책상 위 정지. 헤더 ticks = 0x0007B6A5 = 505509 → 15.430s.
# s1: bytes [00 39 00 07 00 e0] → 16-bit LE: x=0x3900=14592, y=0x0700=1792, z=0xe000=-8192
ACC_REAL_LINE1 = bytes.fromhex(
    "a5b607000039000700e00037000500e10037000700db0037000600dd0036000500dc0036000400db"
    "0036000500de0036000200e1003b000000e1003c00ff00e10039000000e80039000100e5003c0000"
    "00e60039000100e40039000300e3003a000200e2003c000200e1003d000100e0003a000200e3003d"
    "000200e1003b000100e3003b000000e1003b000200e30038000300e3003a000300e50038000200e6"
    "003c000200e5003c000100e6003b000100e4003e00ff00e3"
)


# ─────────────────────────────────────────────────────────────────────────────
# 1. 헤더 타임스탬프 변환 (spec §6.1)
# ─────────────────────────────────────────────────────────────────────────────


class TestHeaderTimestamp:
    """패킷 헤더 4-byte LE u32 → epoch sec (raw / 32768.0). spec §6.1.

    Q6 잠금(2026-05-01): 이 timestamp 는 boot-relative uptime 이지 wall-clock 이 아님 —
    실측 첫 패킷 ~15s 가 그 증거 (wall-clock 이라면 u32 overflow). 의미와 무관하게
    raw 값을 32768 로 나눈 sec 단위로 t_device 에 들어가는지만 본다.
    """

    def test_time_raw_32768_is_one_second(self) -> None:
        """timeRaw=0x00008000(=32768) ⇒ t_device == 1.0 sec 정확. spec §6.1."""
        parser = Parser()
        packet = eeg_packet(32768, [(0, 0, 0)])
        batch = parser.parse_eeg(packet)
        assert batch.t_device == pytest.approx(1.0, abs=1e-12)

    def test_time_raw_zero_is_zero_seconds(self) -> None:
        """timeRaw=0 ⇒ t_device == 0.0 sec. spec §6.1."""
        parser = Parser()
        packet = eeg_packet(0, [(0, 0, 0)])
        batch = parser.parse_eeg(packet)
        assert batch.t_device == pytest.approx(0.0, abs=1e-12)


# ─────────────────────────────────────────────────────────────────────────────
# 2. EEG 변환 정확성 (spec §7.1, §7.2)
# ─────────────────────────────────────────────────────────────────────────────


class TestEegConversion:
    """24-bit 부호확장 + μV 변환식 + lead_off 보존. spec §7.1, §7.2, §17 Q2."""

    def test_ch1_raw_one_yields_lsb_microvolts(self) -> None:
        """ch1_raw=0x000001 ⇒ ch1_uv == 1×LSB ≈ 0.04 μV. spec §7.2.

        산식: μV = raw × Vref / Gain / Resolution × 1e6
        """
        parser = Parser()
        packet = eeg_packet(0, [(0, 1, 0)])
        batch = parser.parse_eeg(packet)
        assert batch.ch1_raw[0] == 1
        assert batch.ch1_uv[0] == pytest.approx(EEG_LSB_UV, rel=1e-12)
        assert batch.ch1_uv[0] == pytest.approx(0.04004, abs=1e-3)

    def test_ch1_raw_max_positive(self) -> None:
        """ch1_raw=0x7FFFFF (=8388607, 양의 최대) ⇒ ch1_uv ≈ +336,083 μV. spec §7.1, §7.2."""
        parser = Parser()
        packet = eeg_packet(0, [(0, 0x7FFFFF, 0)])
        batch = parser.parse_eeg(packet)
        assert batch.ch1_raw[0] == 0x7FFFFF
        expected = 0x7FFFFF * 4.033 / 12.0 / 8388607.0 * 1e6
        assert batch.ch1_uv[0] == pytest.approx(expected, rel=1e-12)

    def test_ch1_raw_sign_extension_to_negative(self) -> None:
        """패킷 바이트 0x80 0x00 0x00 ⇒ raw -8388608 (24-bit 2의 보수) ⇒ ch1_uv ≈ -336,083 μV.

        부호확장 누락 시 양의 큰 값(+8,388,608)이 되어버린다 — 검증 포인트. spec §7.1.
        """
        parser = Parser()
        packet = eeg_packet(0, [(0, -8388608, 0)])
        batch = parser.parse_eeg(packet)
        assert batch.ch1_raw[0] == -8388608
        expected = -8388608 * 4.033 / 12.0 / 8388607.0 * 1e6
        assert batch.ch1_uv[0] == pytest.approx(expected, rel=1e-12)
        assert batch.ch1_uv[0] < 0  # 부호확장 누락 회귀 방지

    def test_lead_off_preserved_as_bool_and_raw(self) -> None:
        """leadOffRaw=1 ⇒ lead_off=True, lead_off_raw=1. spec §7.3, §17 Q2."""
        parser = Parser()
        packet = eeg_packet(0, [(1, 0, 0)])
        batch = parser.parse_eeg(packet)
        assert bool(batch.lead_off[0]) is True
        assert batch.lead_off_raw[0] == 1
        assert batch.lead_off.dtype == np.bool_
        assert batch.lead_off_raw.dtype == np.uint8

    def test_full_eeg_packet_real_fixture(self) -> None:
        """실 디바이스 line 1 (179 bytes) → 25-샘플 EegBatch. spec §7, fixture: 2026-05-01.

        모든 샘플이 saturated (책상 위 미착용 — 전극 floating → ADC rail).
        ch1_raw, ch2_raw 전부 0x7FFFFF. lead_off 전부 False. fs=500.
        """
        parser = Parser()
        assert len(EEG_REAL_LINE1) == 179
        batch = parser.parse_eeg(EEG_REAL_LINE1)
        assert isinstance(batch, EegBatch)
        assert batch.fs == 500
        assert len(batch.ch1_raw) == 25
        assert len(batch.ch2_raw) == 25
        assert len(batch.lead_off) == 25
        assert batch.ch1_raw.dtype == np.int32
        assert (batch.ch1_raw == 0x7FFFFF).all()
        assert (batch.ch2_raw == 0x7FFFFF).all()
        assert not batch.lead_off.any()  # 모두 False
        # 헤더 ticks 0x00072095 / 32768 = 14.270... sec
        assert batch.t_device == pytest.approx(0x00072095 / 32768.0, rel=1e-12)


# ─────────────────────────────────────────────────────────────────────────────
# 3. PPG 부호확장 트랩 (spec §8.1, §17 Q3)
# ─────────────────────────────────────────────────────────────────────────────


class TestPpgSignExtension:
    """Kotlin `(byte.toInt() shl 16) or ...` 의 누락된 `& 0xFF` 버그를 Python 에서 회피.

    spec §8.1. 실 디바이스 PPG 값은 항상 0x80 0000 미만이라 bug 가 latent 상태였음 —
    합성 패킷으로 정량 검증 유지.
    """

    def test_red_high_byte_above_0x80_is_unsigned(self) -> None:
        """RED 첫 바이트가 0x80 이상이어도 결과는 절대 음수가 아님. spec §8.1.

        Kotlin: `(0xFF.toByte().toInt() shl 16) | ...` ⇒ -256 (sign-ext) → 잘못됨.
        Python: `(b[0] << 16) | (b[1] << 8) | b[2]` ⇒ 0..0xFFFFFF, 항상 비음수.
        """
        parser = Parser()
        packet = ppg_packet(0, [(0xFFFFFF, 0)])
        batch = parser.parse_ppg(packet)
        assert batch.red[0] == 0xFFFFFF
        assert batch.red[0] >= 0
        packet2 = ppg_packet(0, [(0x800000, 0)])
        batch2 = Parser().parse_ppg(packet2)
        assert batch2.red[0] == 0x800000
        assert batch2.red[0] >= 0

    def test_full_ppg_packet_real_fixture(self) -> None:
        """실 디바이스 line 1 (172 bytes) → 28-샘플 PpgBatch. spec §8, fixture: 2026-05-01.

        s1: red=0x004106=16646, ir=0x006032=24626. 모든 샘플 비음수.
        """
        parser = Parser()
        assert len(PPG_REAL_LINE1) == 172
        batch = parser.parse_ppg(PPG_REAL_LINE1)
        assert isinstance(batch, PpgBatch)
        assert batch.fs == 50
        assert len(batch.red) == 28
        assert len(batch.ir) == 28
        assert batch.red.dtype == np.int32
        assert batch.red[0] == 0x004106
        assert batch.ir[0] == 0x006032
        assert (batch.red >= 0).all()
        assert (batch.ir >= 0).all()
        assert batch.t_device == pytest.approx(0x0007A6FD / 32768.0, rel=1e-12)


# ─────────────────────────────────────────────────────────────────────────────
# 4. ACC 16-bit LE 디코더 (spec §9.1, §17 Q1)
# ─────────────────────────────────────────────────────────────────────────────


class TestAccDecode16LE:
    """6-byte ACC 샘플은 axis 당 16-bit signed Little-Endian. spec §9.1, §17 Q1.

    실측 확정 (2026-05-01): Kotlin SDK 가 LSB(인덱스 0/2/4) 를 누락하고 MSB 만 읽는
    버그였음. 본 테스트가 그 회귀 방지선.
    """

    def test_decode_acc_sample_reads_16bit_le_per_axis(self) -> None:
        """bytes [LSB_x, MSB_x, LSB_y, MSB_y, LSB_z, MSB_z] 를 axis 당 LE signed 로. spec §9.1.

        sample = [0x10, 0x00, 0xff, 0xff, 0x00, 0x80]:
          x = 0x0010 (LE: 0x10 + 0x00<<8) = 16
          y = 0xffff (LE: 0xff + 0xff<<8) = -1 signed
          z = 0x8000 (LE: 0x00 + 0x80<<8) = -32768 (signed 16-bit min)
        """
        sample = bytes([0x10, 0x00, 0xFF, 0xFF, 0x00, 0x80])
        x, y, z = _decode_acc_sample(sample)
        assert (x, y, z) == (16, -1, -32768)

    def test_decode_acc_sample_lsb_and_msb_both_count(self) -> None:
        """byte 0(LSB) 또는 byte 1(MSB) 어느 쪽을 바꿔도 결과 변동. spec §9.1.

        Kotlin SDK 는 byte 1 만 읽고 byte 0 을 무시했음 — 이 회귀 방지.
        """
        # 같은 0x42 값을 LSB 위치에 둘 때와 MSB 위치에 둘 때 결과가 다름
        s_low_only = bytes([0x42, 0x00, 0x00, 0x00, 0x00, 0x00])
        s_high_only = bytes([0x00, 0x42, 0x00, 0x00, 0x00, 0x00])
        assert _decode_acc_sample(s_low_only)[0] == 0x42      # 66
        assert _decode_acc_sample(s_high_only)[0] == 0x4200   # 16896

    def test_full_acc_packet_real_fixture(self) -> None:
        """실 디바이스 line 1 (184 bytes) → 30-샘플 AccBatch. spec §9, fixture: 2026-05-01.

        s1 bytes [00 39 00 07 00 e0] → 16-bit LE: x=14592, y=1792, z=-8192.
        책상 위 정지 IMU 의 1g 중력 벡터 (magnitude ≈ 16800 ≈ 1g @ ±2g 16-bit).
        """
        parser = Parser()
        assert len(ACC_REAL_LINE1) == 184
        batch = parser.parse_acc(ACC_REAL_LINE1)
        assert isinstance(batch, AccBatch)
        assert batch.fs == 25
        assert len(batch.x) == 30
        assert batch.x.dtype == np.int16
        assert batch.y.dtype == np.int16
        assert batch.z.dtype == np.int16
        # s1 spot-check
        assert batch.x[0] == 14592
        assert batch.y[0] == 1792
        assert batch.z[0] == -8192
        # 1g 중력 magnitude check (sqrt(x²+y²+z²) ≈ 16800, ±2g 16-bit 에서 1g 근방)
        mag0 = float(np.sqrt(int(batch.x[0]) ** 2 + int(batch.y[0]) ** 2 + int(batch.z[0]) ** 2))
        assert 15000 < mag0 < 18000
        assert batch.t_device == pytest.approx(0x0007B6A5 / 32768.0, rel=1e-12)


# ─────────────────────────────────────────────────────────────────────────────
# 5. Battery (spec §11)
# ─────────────────────────────────────────────────────────────────────────────


class TestBattery:
    """표준 BLE Battery Service 알림 파싱 (헤더 없음, 1-byte 퍼센트). spec §11.

    실 디바이스 30s spike 동안 0 패킷 — level-change 트리거 추정 (§17 Q4).
    fixture 는 합성으로 유지.
    """

    def test_payload_0x57_yields_level_87(self) -> None:
        """1-byte payload {0x57} ⇒ BatteryStatus(level=87, t_recv ≈ now). spec §11."""
        before = time.time()
        status = parse_battery(b"\x57")
        after = time.time()
        assert isinstance(status, BatteryStatus)
        assert status.level == 87
        assert before <= status.t_recv <= after


# ─────────────────────────────────────────────────────────────────────────────
# 6. 패킷 간 타임스탬프 연속성 (spec §13 보간 규칙)
# ─────────────────────────────────────────────────────────────────────────────


class TestEegTimestampContinuity:
    """같은 Parser 인스턴스로 EEG 패킷 연속 파싱 시 1/fs 간격 강제. spec §13.

    Kotlin `lastEegSampleTimestampMillis` 미러링: 두 번째 패킷부턴 자기 헤더가 아니라
    직전 패킷 마지막 샘플 + 1/fs 를 첫 샘플 시각으로 쓴다 (재연결 시 reset).
    fs=500Hz (§7, §17 Q7) — sample 간격 = 1/500 = 2ms.
    """

    def test_second_packet_continues_from_last_sample(self) -> None:
        """packet2.t_device == packet1.last_sample_t + 1/500 = 25/500 = 50ms. spec §13."""
        parser = Parser()
        # packet1: 헤더 0, 25 샘플 ⇒ 첫 샘플 t=0, 마지막 샘플 t = 24/500
        packet1 = eeg_packet(0, [(0, i, 0) for i in range(25)])
        batch1 = parser.parse_eeg(packet1)
        assert batch1.t_device == pytest.approx(0.0, abs=1e-12)

        # packet2: 헤더는 일부러 엉뚱한 값(99999) — 보간 규칙대로면 무시되어야
        packet2 = eeg_packet(99999, [(0, i, 0) for i in range(25)])
        batch2 = parser.parse_eeg(packet2)
        # batch1 마지막 = 24/500, batch2 첫 샘플 = 24/500 + 1/500 = 25/500 = 0.05s
        assert batch2.t_device == pytest.approx(25.0 / 500.0, rel=1e-9)

    def test_reset_eeg_timestamps_reinitializes_from_header(self) -> None:
        """reset 후 다음 패킷 t_device 는 다시 자기 헤더 기반. spec §13 (재연결 시 리셋)."""
        parser = Parser()
        parser.parse_eeg(eeg_packet(0, [(0, 0, 0) for _ in range(25)]))
        parser.reset_eeg_timestamps()

        packet = eeg_packet(32768, [(0, 0, 0) for _ in range(25)])
        batch = parser.parse_eeg(packet)
        assert batch.t_device == pytest.approx(1.0, abs=1e-12)
