"""Sound generation. Default engine is a fully-local, dependency-free ambient
synthesizer (so sound works with nothing but numpy + ffmpeg). A 'cloud' engine
stubs a call to a hosted model; a local MMAudio/ThinkSound integration is a
documented extension point (replace generate_cloud).
"""
from __future__ import annotations

import wave

import numpy as np

from . import media

SR = 44100


def _adsr(n: int, a: float = 0.01, r: float = 0.08) -> np.ndarray:
    env = np.ones(n)
    na = max(1, int(a * SR))
    nr = max(1, int(r * SR))
    env[:na] = np.linspace(0, 1, na)
    env[-nr:] *= np.linspace(1, 0, nr)
    return env


def _tone(freq: float, dur: float, gain: float, harmonic_gain: float = 0.4) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    phase = 2 * np.pi * freq * t
    wave = (np.sin(phase) +
            harmonic_gain * 0.5 * np.sin(2 * phase) +
            harmonic_gain * 0.25 * np.sin(3 * phase))
    return gain * wave * _adsr(n)


def _pad(root: float, dur: float) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    vib = 1.0 + 0.002 * np.sin(2 * np.pi * 0.5 * t)
    out = np.zeros(n)
    for mult in (1.0, 1.5, 2.0):
        out += np.sin(2 * np.pi * root * mult * t * vib)
    out /= 4.0
    return out * _adsr(n)


def synthesize(prompt: str, duration: float, bpm: float = 0.0) -> np.ndarray:
    """Local ambient synth: evolving chord pad + sub bass pulsed on the beat grid."""
    duration = max(1.0, float(duration))
    bpm = float(bpm) if bpm and bpm > 0 else 0.0
    n = int(duration * SR)

    x = _pad(110.0, duration) * 0.30

    if bpm:
        step = 60.0 / bpm
        k = 0
        while k * step < duration:
            idx = int(k * step * SR)
            seg = int(min(step * 0.9, duration - k * step) * SR)
            x[idx:idx + seg] += _tone(110.0 / 2, seg / SR, 0.12) * _adsr(seg)
            k += 1
    else:
        # no bpm -> a slow ambient sub swells instead of pulses
        seg = int(duration * SR)
        x += _tone(55.0, duration, 0.06, harmonic_gain=0.2) * _adsr(seg, a=0.3, r=0.6)

    peak = float(np.max(np.abs(x))) or 1.0
    x = x / peak * 0.7
    fade = int(0.05 * SR)
    if fade > 0:
        x[:fade] *= np.linspace(0, 1, fade)
        x[-fade:] *= np.linspace(1, 0, fade)
    return x


def write_wav(path: str, x: np.ndarray, sr: int = SR) -> str:
    pcm = (np.clip(x, -1.0, 1.0) * 32767).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    return path


def generate(prompt: str, duration: float, bpm: float, engine: str) -> dict:
    if engine == "cloud":
        out_path = media.temp_path(".wav", "aimeva_cloud_")
        text = generate_cloud(prompt, duration, bpm)
        x = synthesize(prompt, duration, bpm)
        write_wav(out_path, x)
        return {"path": out_path, "duration": duration, "engine": "cloud-stub",
                "bpm": float(bpm or 0),
                "note": "cloud engine is a stub - replace generate_cloud to use a real model"}
    x = synthesize(prompt, duration, bpm)
    out_path = media.temp_path(".wav", "aimeva_synth_")
    write_wav(out_path, x)
    return {"path": out_path, "duration": duration, "engine": "local-synth",
            "bpm": float(bpm or 0)}


def generate_cloud(prompt: str, duration: float, bpm: float) -> str:
    """Extension point: replace with a real hosted audio module easily."""
    return ""