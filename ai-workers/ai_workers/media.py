"""Shared media helpers: ffmpeg discovery, probing, audio extraction."""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

# ffmpeg lives next to the ai-workers package root, not inside the package dir.
_WORKER_ROOT = Path(__file__).resolve().parent.parent
_BIN_DIR = _WORKER_ROOT / "bin"

SCRATCH = _WORKER_ROOT / "scratch"
SCRATCH.mkdir(exist_ok=True)


def ffmpeg() -> str:
    cands = [str(_BIN_DIR / "ffmpeg.exe"), str(_BIN_DIR / "ffmpeg")]
    which = shutil.which("ffmpeg")
    if which:
        cands.append(which)
    for cand in cands:
        if cand and Path(cand).exists():
            return cand
    raise RuntimeError("ffmpeg not found - add ai-workers/bin/ffmpeg(.exe) or install ffmpeg on PATH")


def ffprobe() -> str:
    for cand in (str(_BIN_DIR / "ffprobe.exe"),
                 str(_BIN_DIR / "ffprobe"),
                 shutil.which("ffprobe")):
        if cand and Path(cand).exists():
            return cand
    raise RuntimeError("ffprobe not found")


def run(cmd: list[str], timeout: int = 600) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, timeout=timeout, text=True)


def probe(path: str) -> dict:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"media not found: {path}")
    res = run([ffprobe(), "-v", "error", "-show_format", "-show_streams",
               "-of", "json", str(p)])
    if res.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {res.stderr.strip()}")
    import json
    data = json.loads(res.stdout or "{}")
    streams = data.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    duration = None
    try:
        duration = float(data.get("format", {}).get("duration", 0) or 0)
    except (TypeError, ValueError):
        pass
    if duration is None or duration == 0:
        try:
            duration = float(video.get("duration") or 0) if video else 0
        except (TypeError, ValueError):
            duration = 0
    width = int(video.get("width") or 0) if video else 0
    height = int(video.get("height") or 0) if video else 0
    return {
        "path": str(p),
        "has_video": bool(video),
        "has_audio": bool(audio),
        "duration_sec": duration,
        "width": width,
        "height": height,
        "codec": (video or {}).get("codec_name", ""),
    }


def extract_audio_wav(path: str, target: Path | None = None, sr: int = 16000) -> str:
    """Extract mono 16 kHz PCM WAV from any media file. Returns the wav path."""
    target = target or Path(SCRATCH) / f"{Path(path).stem}_a16k.wav"
    cmd = [ffmpeg(), "-y", "-v", "error", "-i", str(path),
           "-vn", "-ac", "1", "-ar", str(sr), "-f", "wav", str(target)]
    res = run(cmd)
    if res.returncode != 0 or not target.exists():
        raise RuntimeError(f"audio extraction failed: {res.stderr.strip()}")
    return str(target)


def sample_frames(path: str, n: int = 6, size: int = 384, target_dir: Path | None = None) -> list[str]:
    """Extract n evenly spaced jpg frames for vision models."""
    info = probe(path)
    dur = info["duration_sec"]
    if dur <= 0:
        dur = 1.0
    target_dir = target_dir or Path(SCRATCH)
    frames: list[str] = []
    for i in range(n):
        t = (dur / (n + 1)) * (i + 1)
        out = target_dir / f"fr_{Path(path).stem}_{i}.jpg"
        cmd = [ffmpeg(), "-y", "-v", "error", "-ss", f"{t:.3f}", "-i", str(path),
               "-frames:v", "1", "-vf", f"scale={size}:-2", str(out)]
        if run(cmd).returncode != 0:
            continue
        frames.append(str(out))
    return frames


def detect_scenes(path: str, threshold: float = 0.30) -> list[dict]:
    """Fast, model-free highlight candidates via ffmpeg scene-change detection."""
    from pathlib import Path as _P
    cmd = [ffmpeg(), "-hide_banner", "-i", str(_P(path)),
           "-vf", f"select='gt(scene,{threshold})'", "-f", "null", "-"]
    res = run(cmd)
    scenes = []
    for line in (res.stderr or "").splitlines():
        low = line.lower()
        if "select" not in low or "t:" not in low or "scene" not in low:
            continue
        t = _extract_sec(line)
        if t is not None:
            scenes.append({"start_sec": round(t, 2)})
    return scenes


def _extract_sec(line: str) -> float | None:
    import re
    m = re.search(r"\bt:\s*([0-9.]+)", line)
    return float(m.group(1)) if m else None


def temp_path(suffix: str, prefix: str = "aimeva_") -> str:
    fd, p = tempfile.mkstemp(suffix=suffix, prefix=prefix, dir=str(SCRATCH))
    os.close(fd)
    return p


def ffmpeg_path_abs() -> str:
    return ffmpeg()


def scrub_tmp(*paths: str) -> None:
    for p in paths:
        try:
            if p and Path(p).is_file() and str(Path(p).resolve()).startswith(str(SCRATCH.resolve())):
                Path(p).unlink(missing_ok=True)
        except Exception:
            pass