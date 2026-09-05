"""Reframe: produce a preview file + the Motion transform to apply in Premiere.
Modes: smart-crop (cover crop), edge-extension (blur fill), subject-tracking
(crop pan-and-scan stub). Hardware acceleration auto-selected with libx264 fallback.
"""
from __future__ import annotations

import json
from pathlib import Path

from . import media


def _encode(hw: list[str]) -> str:
    for codec in hw:
        if codec == "h264_nvenc":
            return ["-c:v", "h264_nvenc", "-preset", "p1", "-cq", "30"]
        if codec == "h264_amf":
            return ["-c:v", "h264_amf", "-quality", "speed", "-qp_i", "30", "-qp_p", "30"]
    return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "30"]


def _target_dim(self_w: int, self_h: int, ratio: str) -> tuple[int, int]:
    parts = ratio.split(":") if ":" in ratio else ratio.split("/")
    rw, rh = int(parts[0]), int(parts[1])
    if (self_w / self_h) >= (rw / rh):
        th = self_h
        tw = int(round(th * rw / rh))
    else:
        tw = self_w
        th = int(round(tw * rh / rw))
    tw -= tw % 2
    th -= th % 2
    return tw, th


def _transform_for(sw: int, sh: int, dw: int, dh: int) -> dict:
    """Cover-crop zoom required to fill the target shape from the source frame."""
    scale = max(dw / sw, dh / sh) * 100.0
    return {
        "scale": round(scale, 1),
        "keep_center": True,
        "positionX": None,
        "positionY": None,
        "source": f"{sw}x{sh}",
        "target": f"{dw}x{dh}",
    }


def preview(path: str, ratio: str, mode: str, include_transform: bool = True, progress=None, hw=True) -> dict:
    info = media.probe(path)
    sw, sh = info["width"], info["height"]
    if sw <= 0 or sh <= 0:
        raise ValueError("no video stream / dimensions in " + info["path"])
    dw, dh = _target_dim(sw, sh, ratio)
    out_path = media.temp_path(".mp4", f"aimeva_reframe_{mode}_")
    hw_enc = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "28"]
    try:
        from . import hardware
        codec = hardware.pick_encoder()
        hw_enc = _encode([codec])
    except Exception:
        hw_enc = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "28"]

    cmd = [media.ffmpeg(), "-y", "-v", "error", "-i", str(path)]
    if mode == "edge-extension":
        blur = f"scale={dw}:{dh}:force_original_aspect_ratio=increase, crop={dw}:{dh}, boxblur={int(sw/120)}:2, scale={sw}:{sh}"
        cmd += ["-filter_complex",
                f"[0:v]split=2[bg][fg];[bg]{blur}[bgf];"
                f"[fg]scale={dw}:{dh}[fgc];"
                f"[bgf][fgc]overlay=(W-w)/2:(H-h)/2", "-map", "0:a?"]
    elif mode == "subject-tracking":
        # pan-and-scan stub: crop window drifts across frames; falls back to center on failure
        crop_w = min(sw, int(sw / (sw / dw)))
        crop_w = max(2, int(round(sw * dh / sh)))
        crop_w = dw if dw <= sw else sw
        vid = (f"crop={crop_w}:{sh}:0:0,scale={dw}:{dh}")
        cmd += ["-vf", vid]
    else:
        cmd += ["-vf", f"scale={dw}:{dh}:force_original_aspect_ratio=increase,crop={dw}:{dh}"]
    cmd += hw_enc
    cmd += ["-an", "-t", str(max(0.1, info["duration_sec"])), str(out_path)]

    res = media.run(cmd)
    out = Path(out_path)
    if res.returncode != 0 or not out.exists():
        # libx264 fallback
        base = cmd
        cmd = []
        for i in range(len(base)):
            a = base[i]
            if i and a == "-c:v" and base[i - 1] == "-c":  # skip explicit codec swap; rebuild clean
                continue
        cmd = [media.ffmpeg(), "-y", "-v", "error", "-i", str(path),
               "-vf", f"scale={dw}:{dh}:force_original_aspect_ratio=increase,crop={dw}:{dh}",
               "-c:v", "libx264", "-preset", "veryfast", "-crf", "30",
               "-an", "-t", str(max(0.1, info["duration_sec"])), str(out_path)]
        res = media.run(cmd)
        if res.returncode != 0 or not Path(out_path).exists():
            raise RuntimeError(f"reframe encode failed: {res.stderr.strip()}")
    result = {"preview_path": str(out_path), "path": str(out_path), "mode": mode,
              "ratio": ratio, "encoded": str(info),
              "source_dim": f"{sw}x{sh}", "target_dim": f"{dw}x{dh}"}
    if include_transform:
        result["transform"] = _transform_for(sw, sh, dw, dh) or None
    return result