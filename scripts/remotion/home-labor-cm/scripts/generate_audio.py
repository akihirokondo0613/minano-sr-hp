#!/usr/bin/env python3
"""15秒CM用のBGMと効果音を決定的に生成する。

外部音源や既存楽曲を使わず、NumPyによる波形合成だけで生成する。
同じコードから常に同じ音が得られるため、動画の再生成と権利確認が容易になる。
"""

from __future__ import annotations

import math
import wave
from pathlib import Path

import numpy as np


SAMPLE_RATE = 48_000
OUTPUT_DIR = Path(__file__).resolve().parents[1] / "public" / "minano" / "audio"
RNG = np.random.default_rng(20260804)


def seconds(value: float) -> int:
    return max(1, round(value * SAMPLE_RATE))


def fade_envelope(
    duration: float,
    *,
    attack: float = 0.01,
    decay: float = 0.08,
    sustain: float = 0.72,
    release: float = 0.12,
) -> np.ndarray:
    count = seconds(duration)
    env = np.ones(count, dtype=np.float64) * sustain
    attack_count = min(count, seconds(attack))
    decay_count = min(max(0, count - attack_count), seconds(decay))
    release_count = min(count, seconds(release))
    if attack_count:
        env[:attack_count] = np.linspace(0.0, 1.0, attack_count, endpoint=False)
    if decay_count:
        env[attack_count : attack_count + decay_count] = np.linspace(
            1.0, sustain, decay_count, endpoint=False
        )
    if release_count:
        env[-release_count:] *= np.linspace(1.0, 0.0, release_count)
    return env


def tone(
    frequency: float, duration: float, *, harmonics: tuple[float, ...] = (1.0,)
) -> np.ndarray:
    time = np.arange(seconds(duration), dtype=np.float64) / SAMPLE_RATE
    signal = np.zeros_like(time)
    for index, amplitude in enumerate(harmonics, start=1):
        signal += amplitude * np.sin(math.tau * frequency * index * time)
    divisor = max(1.0, sum(abs(value) for value in harmonics))
    return signal / divisor


def add_mono(
    target: np.ndarray,
    signal: np.ndarray,
    start: float,
    *,
    amplitude: float = 1.0,
) -> None:
    offset = seconds(start)
    end = min(target.shape[0], offset + signal.shape[0])
    if end <= offset:
        return
    target[offset:end] += signal[: end - offset] * amplitude


def add_stereo(
    target: np.ndarray,
    signal: np.ndarray,
    start: float,
    *,
    amplitude: float = 1.0,
    pan: float = 0.0,
) -> None:
    offset = seconds(start)
    end = min(target.shape[0], offset + signal.shape[0])
    if end <= offset:
        return
    left = math.sqrt((1.0 - max(-1.0, min(1.0, pan))) / 2.0)
    right = math.sqrt((1.0 + max(-1.0, min(1.0, pan))) / 2.0)
    excerpt = signal[: end - offset] * amplitude
    target[offset:end, 0] += excerpt * left
    target[offset:end, 1] += excerpt * right


def normalize(signal: np.ndarray, peak: float = 0.88) -> np.ndarray:
    maximum = float(np.max(np.abs(signal))) if signal.size else 0.0
    if maximum <= 0:
        return signal
    return signal * (peak / maximum)


def write_wav(path: Path, signal: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    clipped = np.clip(signal, -1.0, 1.0)
    pcm = (clipped * 32767).astype("<i2")
    channels = 1 if pcm.ndim == 1 else pcm.shape[1]
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(channels)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        handle.writeframes(pcm.tobytes())


def generate_bgm() -> None:
    duration = 15.0
    mix = np.zeros((seconds(duration), 2), dtype=np.float64)
    beat = 0.5  # 120 BPM
    chords = [
        (146.83, 185.00, 220.00),  # D
        (196.00, 246.94, 293.66),  # G
        (123.47, 146.83, 185.00),  # Bm
        (110.00, 138.59, 164.81),  # A
    ]

    # 柔らかなコードパッド。音声の中域を避け、低い音量で推進感だけを作る。
    for bar in range(8):
        start = bar * beat * 4
        if start >= duration:
            break
        chord = chords[bar % len(chords)]
        chord_duration = min(2.1, duration - start)
        for note_index, frequency in enumerate(chord):
            pad = tone(frequency, chord_duration, harmonics=(1.0, 0.3, 0.12))
            pad *= fade_envelope(
                chord_duration,
                attack=0.18,
                decay=0.25,
                sustain=0.6,
                release=0.45,
            )
            add_stereo(
                mix,
                pad,
                start,
                amplitude=0.12,
                pan=(-0.34, 0.0, 0.34)[note_index],
            )

    # 8分音符の短い木琴風プラック。書類カードの整列と相性を合わせる。
    melody = [0, 2, 1, 2, 0, 1, 2, 1]
    for eighth in range(30):
        start = eighth * beat / 2
        bar = int(start // 2.0)
        chord = chords[bar % len(chords)]
        frequency = chord[melody[eighth % len(melody)]] * 2.0
        pluck_duration = 0.26
        pluck = tone(frequency, pluck_duration, harmonics=(1.0, 0.42, 0.16))
        pluck *= np.exp(-np.linspace(0.0, 6.5, pluck.shape[0]))
        add_stereo(
            mix,
            pluck,
            start,
            amplitude=0.11 if eighth < 24 else 0.08,
            pan=-0.26 if eighth % 2 == 0 else 0.26,
        )

    # キック、指スナップ、ハイハットを控えめに足し、広告のカットを拍へ固定する。
    for beat_index in range(30):
        start = beat_index * beat
        kick_time = np.arange(seconds(0.22), dtype=np.float64) / SAMPLE_RATE
        kick = np.sin(math.tau * (72.0 - 34.0 * kick_time) * kick_time)
        kick *= np.exp(-kick_time * 16.0)
        add_stereo(mix, kick, start, amplitude=0.16, pan=0.0)

        if beat_index % 2 == 1:
            snap_duration = 0.1
            snap = RNG.normal(0.0, 1.0, seconds(snap_duration))
            snap = np.concatenate(([snap[0]], np.diff(snap)))
            snap *= fade_envelope(
                snap_duration,
                attack=0.001,
                decay=0.015,
                sustain=0.1,
                release=0.07,
            )
            add_stereo(mix, snap, start, amplitude=0.055, pan=0.18)

        hat_duration = 0.055
        hat = RNG.normal(0.0, 1.0, seconds(hat_duration))
        hat = np.concatenate(([hat[0]], np.diff(hat)))
        hat *= np.exp(-np.linspace(0.0, 7.0, hat.shape[0]))
        add_stereo(mix, hat, start + beat / 2, amplitude=0.018, pan=-0.25)

    # CTAへ向けて少しだけ明るくし、最後は余韻を残して消す。
    time = np.arange(mix.shape[0], dtype=np.float64) / SAMPLE_RATE
    lift = np.clip((time - 10.5) / 2.2, 0.0, 1.0)
    mix[:, 0] += 0.025 * lift * np.sin(math.tau * 587.33 * time)
    mix[:, 1] += 0.025 * lift * np.sin(math.tau * 739.99 * time)
    fade_out = np.ones_like(time)
    fade_start = seconds(14.2)
    fade_out[fade_start:] = np.linspace(1.0, 0.0, fade_out.shape[0] - fade_start)
    mix *= fade_out[:, None]
    write_wav(OUTPUT_DIR / "minano-cm-bgm.wav", normalize(mix, 0.78))


def paper_sound(pitch: float, duration: float = 0.28) -> np.ndarray:
    count = seconds(duration)
    time = np.arange(count, dtype=np.float64) / SAMPLE_RATE
    noise = RNG.normal(0.0, 1.0, count)
    bright = np.concatenate(([noise[0]], np.diff(noise)))
    body = np.sin(math.tau * pitch * time) * np.exp(-time * 13.0)
    envelope = fade_envelope(
        duration, attack=0.004, decay=0.04, sustain=0.35, release=0.12
    )
    return normalize((bright * 0.3 + body * 0.55) * envelope, 0.72)


def snap_sound(frequency: float, duration: float = 0.18) -> np.ndarray:
    time = np.arange(seconds(duration), dtype=np.float64) / SAMPLE_RATE
    click = RNG.normal(0.0, 1.0, time.shape[0]) * np.exp(-time * 52.0)
    note = np.sin(math.tau * frequency * time) * np.exp(-time * 16.0)
    return normalize(click * 0.34 + note * 0.66, 0.74)


def sweep_sound(
    start_frequency: float, end_frequency: float, duration: float
) -> np.ndarray:
    time = np.arange(seconds(duration), dtype=np.float64) / SAMPLE_RATE
    frequency = (
        start_frequency + (end_frequency - start_frequency) * (time / duration) ** 1.4
    )
    phase = math.tau * np.cumsum(frequency) / SAMPLE_RATE
    noise = RNG.normal(0.0, 1.0, time.shape[0])
    envelope = np.sin(np.pi * np.clip(time / duration, 0.0, 1.0)) ** 1.5
    return normalize((np.sin(phase) * 0.42 + noise * 0.2) * envelope, 0.72)


def generate_sfx() -> None:
    write_wav(OUTPUT_DIR / "sfx-paper-1.wav", paper_sound(164.81))
    write_wav(OUTPUT_DIR / "sfx-paper-2.wav", paper_sound(196.00))
    write_wav(OUTPUT_DIR / "sfx-paper-3.wav", paper_sound(246.94, 0.34))

    clock_duration = 0.16
    clock_time = np.arange(seconds(clock_duration), dtype=np.float64) / SAMPLE_RATE
    clock = (
        RNG.normal(0.0, 1.0, clock_time.shape[0]) * np.exp(-clock_time * 55.0) * 0.35
        + np.sin(math.tau * 1850.0 * clock_time) * np.exp(-clock_time * 34.0) * 0.65
    )
    write_wav(OUTPUT_DIR / "sfx-clock.wav", normalize(clock, 0.76))

    freeze = sweep_sound(620.0, 120.0, 0.48)
    freeze_time = np.arange(freeze.shape[0], dtype=np.float64) / SAMPLE_RATE
    freeze += np.sin(math.tau * 58.0 * freeze_time) * np.exp(-freeze_time * 7.0) * 0.44
    write_wav(OUTPUT_DIR / "sfx-freeze.wav", normalize(freeze, 0.8))

    write_wav(OUTPUT_DIR / "sfx-whoosh.wav", sweep_sound(180.0, 920.0, 0.52))
    write_wav(OUTPUT_DIR / "sfx-snap-1.wav", snap_sound(620.0))
    write_wav(OUTPUT_DIR / "sfx-snap-2.wav", snap_sound(760.0))

    check_duration = 0.5
    check = np.zeros(seconds(check_duration), dtype=np.float64)
    add_mono(
        check,
        tone(660.0, 0.18) * fade_envelope(0.18, attack=0.003, release=0.13),
        0.0,
        amplitude=0.5,
    )
    add_mono(
        check,
        tone(880.0, 0.28) * fade_envelope(0.28, attack=0.003, release=0.22),
        0.12,
        amplitude=0.48,
    )
    write_wav(OUTPUT_DIR / "sfx-check.wav", normalize(check, 0.7))

    write_wav(OUTPUT_DIR / "sfx-line.wav", sweep_sound(330.0, 780.0, 0.72))

    stamp_duration = 0.34
    stamp_time = np.arange(seconds(stamp_duration), dtype=np.float64) / SAMPLE_RATE
    stamp_noise = RNG.normal(0.0, 1.0, stamp_time.shape[0]) * np.exp(-stamp_time * 22.0)
    stamp_body = np.sin(math.tau * 72.0 * stamp_time) * np.exp(-stamp_time * 8.0)
    write_wav(
        OUTPUT_DIR / "sfx-stamp.wav",
        normalize(stamp_noise * 0.22 + stamp_body * 0.8, 0.84),
    )

    success_duration = 0.78
    success = np.zeros(seconds(success_duration), dtype=np.float64)
    for start, frequency in ((0.0, 523.25), (0.14, 659.25), (0.30, 783.99)):
        chime = tone(frequency, 0.42, harmonics=(1.0, 0.32))
        chime *= fade_envelope(0.42, attack=0.003, decay=0.04, sustain=0.5, release=0.3)
        add_mono(success, chime, start, amplitude=0.32)
    write_wav(OUTPUT_DIR / "sfx-success.wav", normalize(success, 0.7))


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    generate_bgm()
    generate_sfx()
    print(f"Generated audio assets in {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
