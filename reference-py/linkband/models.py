"""Link Band 센서 배치 데이터클래스.

BLE 패킷 1개 = 인스턴스 1개 (numpy 배치). 샘플당 객체가 아님.
EEG 는 500Hz 라 50ms 마다 샘플 25개씩 — 작은 Python 객체로 만들면 메모리·DSP
호출 비용이 폭증한다. numpy 배열로 묶어두면 둘 다 싸진다.

스펙 출처: docs/01-protocol-spec.md §13 (2026-05-01 잠금).
필드 구성·dtype·raw/변환값 동시 보관 결정은 거기서 잠긴 사항 — 본 모듈에서
임의로 확장하지 말고 변경이 필요하면 스펙부터 갱신할 것.
"""

from dataclasses import dataclass

import numpy as np

# `kw_only=True` (PEP 681 / py3.10+) 를 쓴 이유:
# 스펙 표기 순서대로 필드를 두면 기본값 있는 `fs` 다음에 기본값 없는 ndarray
# 필드들이 와서 일반 dataclass 로는 정의 자체가 에러. kw_only 로 바꾸면
# 순서 제약이 사라진다. 부수 효과로 호출부가 반드시
# `EegBatch(t_device=..., ch1_uv=...)` 형태가 되므로, shape 이 같은 ndarray
# 인자 6개가 위치로 뒤섞여 들어갈 위험도 차단된다.


@dataclass(kw_only=True)
class EegBatch:
    """EEG BLE 패킷 1개 — 25 samples / 50ms @ 500Hz.

    실측으로 fs 500Hz 확정 (spec §7, §17 Q7). Kotlin SDK 의 `eegSampleRate=250.0` 은 오류.

    `*_raw` (24-bit 2의 보수 ADC 카운트) 와 `*_uv` (μV 변환값) 둘 다 보관해서
    학생이 변환식을 직접 추적할 수 있게 한다:
        μV = raw × Vref / Gain / Resolution × 1e6
           = raw × 4.033 / 12 / 8388607 × 1e6      (≈ 0.04004 μV / LSB)
    스펙 §7.2 참조.

    `lead_off` 는 bool (Kotlin SDK 패리티: `lead_off_raw > 0`).
    `lead_off_raw` 는 원래 uint8 을 그대로 보관 — 펌웨어가 채널별 비트마스크로
    쓰는 게 맞는지 실 디바이스 검증 후 확정 (스펙 §17 Q2).
    """

    t_device: float           # epoch sec — 패킷 헤더 타임스탬프 / 32768 (스펙 §6.1, boot-relative)
    t_recv: float             # 패킷 도착 시각 wall-clock (time.time())
    fs: int = 500
    ch1_uv: np.ndarray        # float64, shape (N,)
    ch2_uv: np.ndarray        # float64, shape (N,)
    ch1_raw: np.ndarray       # int32,   shape (N,)
    ch2_raw: np.ndarray       # int32,   shape (N,)
    lead_off: np.ndarray      # bool,    shape (N,)
    lead_off_raw: np.ndarray  # uint8,   shape (N,)


@dataclass(kw_only=True)
class PpgBatch:
    """PPG BLE 패킷 1개 — 샘플 28개 (50Hz × 560ms).

    24-bit ADC raw 값만 보관. PPG는 문서화된 단위 변환이 없다.
    BPM/HRV 산출은 `linkband.dsp` / `linkband.metrics` 영역이며 모델 단계가 아님.
    """

    t_device: float
    t_recv: float
    fs: int = 50
    red: np.ndarray           # int32, shape (N,)
    ir: np.ndarray            # int32, shape (N,)


@dataclass(kw_only=True)
class AccBatch:
    """ACC BLE 패킷 1개 — 샘플 30개 (25Hz × 1200ms).

    각 축은 16-bit signed Little-Endian — 실측 확정 (spec §9.1, §17 Q1).
    Kotlin SDK 가 인덱스 1/3/5 (MSB) 만 읽는 LSB 누락 버그였음.
    """

    t_device: float
    t_recv: float
    fs: int = 25
    x: np.ndarray             # int16, shape (N,)
    y: np.ndarray             # int16, shape (N,)
    z: np.ndarray             # int16, shape (N,)


@dataclass(kw_only=True)
class BatteryStatus:
    """표준 BLE Battery Service 알림 (스펙 §11).

    `t_device` 없음 — 배터리 알림은 헤더 타임스탬프 없이 퍼센트 1바이트만
    실려온다. 시각 기준은 wall-clock 뿐.
    """

    t_recv: float
    level: int                # 0..100
