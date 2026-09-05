"""Numpy-only audio analysis: beat tracking + silence detection.

Uses the classic spectral-flux onset envelope, an autocorrelation tempo
estimate, and a snappy peak picker - no librosa/numba dependency.
"""
from __future__ import annotations

import wave

import numpy as np

SR = 16000
NFFT = 1024
HOP = 512
FPS = SR / HOP


def read_wav_mono(path: str):
    with wave.open(path, "rb") as w:
        ch = w.getnchannels()
        raw = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32)
        if ch > 1:
            raw = raw[::ch]
    return raw / 32768.0


def _frames(x: np.ndarray, fsize: int = NFFT, hop: int = HOP):
    n = max(0, (len(x) - fsize) // hop + 1)
    idx = np.arange(fsize)[None, :] + hop * np.arange(n)[:, None]
    return x[idx]


def flux_env(x: np.ndarray, fsize: int = NFFT, hop: int = HOP):
    w = np.hanning(fsize).astype(np.float32)
    f = _frames(x, fsize, hop)
    if len(f) < 2:
        return np.zeros(4), hop
    mag = np.abs(np.fft.rfft(f * w, axis=1))
    flux = np.maximum(0.0, mag[1:] - mag[:-1]).sum(axis=1)
    flux = np.concatenate([[0.0], flux])
    denom = float(flux.max()) + 1e-9
    flux = flux / denom
    k = 7
    if len(flux) >= k:
        kernel = np.ones(k) / k
        flux = np.convolve(flux, kernel, mode="same")
    return flux, hop


def tempo_bpm(flux: np.ndarray) -> float:
    f = flux - float(flux.mean())
    lo, hi = int(FPS * 0.33), int(FPS * 1.0)  # 60..180 bpm window
    if len(f) <= hi + 2:
        for secs in (0.5, 0.4, 0.6):
            if len(f) > int(FPS * secs) + 2:
                hi = int(FPS * secs)
                break
        else:
            return 120.0
    lags = list(range(lo, hi))
    best, best_lag = -1e18, lags[len(lags) // 2]
    for lag in lags:
        a = float(np.dot(f[:-lag], f[lag:]))
        if a > best:
            best, best_lag = a, lag
    bpm = 60.0 / (best_lag / FPS)
    while bpm < 60:
        bpm *= 2.0
    while bpm > 200:
        bpm /= 2.0
    return round(bpm, 1)


def pick_peaks(flux: np.ndarray, min_dist_frames: int = 3, thresh_rel: float = 0.45):
    """Local maxima above an adaptive threshold. Returns (index, prominence) pairs."""
    lo = np.percentile(flux, 40)
    hi = float(flux.max())
    threshold = max(0.12, lo + thresh_rel * (hi - lo))
    peaks = []
    for i in range(1, len(flux) - 1):
        if flux[i] > flux[i - 1] and flux[i] >= flux[i + 1] and flux[i] >= threshold:
            peaks.append(i)
    keep = []
    for i in sorted(peaks):
        if not keep or i - keep[-1] >= min_dist_frames:
            keep.append(i)
        else:
            if flux[i] > flux[keep[-1]]:
                keep[-1] = i
    return keep


def snap_to_grid(flux: np.ndarray, times_sec: list[float], bpm: float, total: float) -> list[float]:
    """Align raw onset times onto a musical beat grid at the estimated BPM."""
    period = 60.0 / bpm
    grid_times = times_sec
    snap_radius = 0.28 * period
    out = []
    for t in grid_times:
        if t > total:
            continue
        t_end = min(t + snap_radius, total)
        i0 = max(0, int(t / period) - 1)
        i1 = int(t_end / period) + 1
        for k in range(i0, i1):
            cand = k * period
            if abs(cand - t) <= snap_radius and cand <= total:
                out.append(round(cand, 3))
                break
        else:
            out.append(round(t, 3))
    return sorted(dict.fromkeys(out))


def pick_by_intensity(peaks: list[int], flux: np.ndarray, intensity: int) -> list[int]:
    """Keep a musical subset of the peak indices: 1=sparse .. 5=everything."""
    if intensity >= 5 or len(peaks) <= 1:
        return peaks
    frac = {1: 0.30, 2: 0.50, 3: 0.70, 4: 0.85, 5: 1.0}[intensity]
    order = sorted(peaks, key=lambda i: flux[i], reverse=True)
    winners = set(order[: max(1, int(len(order) * frac))])
    return sorted(winners)


def analyze_beats(path: str, intensity: int = 3) -> dict:
    x = read_wav_mono(path)
    total = len(x) / SR
    flux, hop = flux_env(x)
    bpm = tempo_bpm(flux)
    idxs = pick_peaks(flux)
    if not idxs:
        return {"mode": "beats", "bpm": bpm, "beat_times": [], "count": 0,
                "audio": path, "full": None, "sample_rate": SR, "total_sec": round(total, 3),
                "note": "no strong onsets detected"}
    if intensity < 5:
        idxs = pick_by_intensity(idxs, flux, intensity)
    raw_sec = [round(i * hop / SR, 3) for i in idxs]
    beat_times = snap_to_grid(flux, raw_sec, bpm, total)
    return {"mode": "beats", "bpm": bpm, "beat_times": beat_times, "count": len(beat_times),
            "audio": path, "sample_rate": SR, "total_sec": round(total, 3)}


def _db(x: np.ndarray, fsize: int = NFFT, hop: int = HOP):
    f = _frames(x, fsize, hop)
    rms = np.sqrt((f ** 2).mean(axis=1) + 1e-12)
    db = 20.0 * np.log10(rms + 1e-12)
    k = 9
    if len(db) >= k:
        db = np.convolve(db, np.ones(k) / k, mode="same")
    return db, hop


def analyze_silence(path: str, threshold_db: float = -35.0, min_gap: float = 0.6) -> dict:
    x = read_wav_mono(path)
    db, hop = _db(x)
    silent = db < threshold_db
    regions = []
    sec0 = 0.0
    in_gap = False
    for i in range(len(silent)):
        ti = i * hop / SR
        if silent[i] and not in_gap:
            in_gap = True
            sec0 = ti
        elif not silent[i] and in_gap:
            in_gap = False
            if ti - sec0 >= min_gap:
                regions.append({"startSec": round(sec0, 3), "endSec": round(ti, 3),
                                "start_sec": round(sec0, 3), "end_sec": round(ti, 3), "dur_sec": round(ti - sec0, 3)})
    if in_gap:
        ti = len(silent) * hop / SR
        if ti - sec0 >= min_gap:
            regions.append({"startSec": round(sec0, 3), "endSec": round(ti, 3),
                            "start_sec": round(sec0, 3), "end_sec": round(ti, 3), "dur_sec": round(ti - sec0, 3)})
    total_silence = sum(r["dur_sec"] for r in regions)
    return {"mode": "silence", "regions": regions, "count": len(regions),
            "total_silence_sec": round(total_silence, 3), "threshold_db": threshold_db,
            "min_gap": min_gap, "audio": path, "sample_rate": SR}