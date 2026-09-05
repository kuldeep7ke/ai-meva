"""AIMeva AI worker - one FastAPI service on 127.0.0.1:8000.
Every endpoint accepts a JSON body with local media paths (or multipart upload).
Run: ai-workers/start-worker.bat   (creates a venv, installs deps, launches uvicorn)
"""
from __future__ import annotations

import re
import threading
import traceback
import uuid
from pathlib import Path

import numpy as np
import requests
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import agents, audio, llm, mcp_server, media, opencode_model, reframe, sound
from .media import probe

app = FastAPI(title="AIMeva Worker", version="0.1.0")

CORS = None
try:
    from fastapi.middleware.cors import CORSMiddleware
    CORS = CORSMiddleware
except Exception:
    CORS = None
if CORS:
    app.add_middleware(CORS, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class AudioReq(BaseModel):
    audio: str = ""
    mode: str = "beats"
    intensity: int = 3
    min_gap: float = 0.6
    threshold_db: float = -35.0


class FootageReq(BaseModel):
    footage: str = ""
    model: str = ""
    prompt: str = ""
    frames: int = Field(default=1, ge=1, le=6)


class SoundReq(BaseModel):
    prompt: str = ""
    duration: float = 5
    bpm: float = 0
    engine: str = "auto"


class ReframeReq(BaseModel):
    footage: str = ""
    ratio: str = "16:9"
    mode: str = "smart-crop"
    include_transform: bool = True


class ChatReq(BaseModel):
    task: str = "chat"
    prompt: str = ""
    model: str = ""
    media_path: str = ""


class AgentRunReq(BaseModel):
    agent: str = ""
    prompt: str = ""
    media_path: str = ""


class McpCallReq(BaseModel):
    server: str = ""
    tool: str = ""
    arguments: dict = Field(default_factory=dict)


def _file_or_json(req_file, json_val: str) -> str:
    if req_file is not None:
        return req_file
    return json_val


def _cleanup_upload(upload_path: str | None):
    if upload_path and upload_path.startswith(str(media.SCRATCH)):
        try:
            Path(upload_path).unlink(missing_ok=True)
        except Exception:
            pass


@app.get("/")
def root():
    return {
        "name": "AIMeva Worker",
        "version": "0.1.0",
        "endpoints": [
            "GET /health", "POST /analyze/beats", "POST /analyze/scene",
            "POST /sound/generate", "POST /reframe", "GET /models",
            "POST /chat", "GET /agents", "POST /agents/run",
            "GET /mcp/list", "POST /mcp/call", "GET /opencode/models",
        ],
    }


@app.get("/health")
def health():
    ol = llm.ollama_ready()
    ff = False
    try:
        media.ffmpeg()
        ff = True
    except Exception:
        ff = False
    return {
        "ok": True,
        "name": "AIMeva Worker",
        "version": "0.1.0",
        "ffmpeg": ff,
        "ollama": ol,
        "tmp": str(media.SCRATCH),
    }


@app.post("/analyze/beats")
async def analyze_beats(body: AudioReq):
    mode = body.mode or "beats"
    try:
        audio_path = body.audio or ""
        if not audio_path:
            raise HTTPException(400, "audio path required")
        if mode in ("beats", "beat"):
            res = audio.analyze_beats(audio_path, intensity=body.intensity)
        elif mode == "silence":
            res = audio.analyze_silence(audio_path, threshold_db=body.threshold_db, min_gap=body.min_gap)
        else:
            raise HTTPException(400, f"mode must be beats|silence, got {mode}")
        return res
    except Exception as e:
        return _err(e)


@app.post("/analyze/scene")
async def analyze_scene(body: FootageReq):
    try:
        auto = media.detect_scenes(body.footage)
        summary = "No vision model used (fast mode). Highlights estimated by scene-change detection."
        times = []
        if not llm.ollama_ready():
            return {"highlights": auto, "auto_highlights": auto, "model": body.model or "none",
                    "summary": "Fast mode only - install a vision model (qwen3-vl:2b) for a richer summary.", "footage": body.footage}
        frames = media.sample_frames(body.footage, n=body.frames, size=256)
        if not frames:
            return {"highlights": auto, "auto_highlights": auto, "model": body.model or "none",
                    "summary": summary, "footage": body.footage}
        model = body.model.removeprefix("ollama:") or "qwen3-vl:2b"
        prompts = [
            "Describe the shot and give 3 short clip captions. Then, if the images reveal "
            "1-3 clearly interesting moments (fast motion, action, color change), list their "
            "estimated times in seconds. Output ONLY JSON: "
            "{\"highlights\":[{\"start_sec\":12.5,\"reasons\":\"...\"}],\"summary\":\"...\"}",
        ]
        try:
            text = llm.chat_vision(frames, " ".join(prompts), model)
        except Exception as e:
            summary = f"vision model unavailable ({e}); highlights are scene-change estimates."
        else:
            import json as _json
            m = text.find("{")
            if m >= 0 and text.rfind("}") >= m:
                try:
                    parsed = _json.loads(text[m:text.rfind("}") + 1])
                    for h in parsed.get("highlights", []):
                        if isinstance(h, dict) and "start_sec" in h:
                            try:
                                times.append({"startSec": float(h["start_sec"]), "start_sec": float(h["start_sec"]),
                                              "reasons": h.get("reasons", "")})
                            except (TypeError, ValueError):
                                pass
                    summary = (parsed.get("summary") or "").strip() or text[:300]
                except Exception:
                    summary = text[:400]
        return {"highlights": times or auto, "auto_highlights": auto, "model": body.model or "none",
                "summary": summary, "footage": body.footage}
    except Exception as e:
        return _err(e)


@app.post("/sound/generate")
async def generate_sound(body: SoundReq):
    try:
        engine = body.engine or "auto"
        if engine == "auto":
            engine = "local"  # local always works
        return sound.generate(body.prompt, body.duration, body.bpm, engine)
    except Exception as e:
        return _err(e)


@app.post("/reframe")
async def do_reframe(body: ReframeReq):
    try:
        return reframe.preview(body.footage, body.ratio, body.mode, include_transform=body.include_transform)
    except Exception as e:
        return _err(e)


@app.get("/models")
def models_report():
    curated = []
    try:
        reg = _load_curated()
        curated = reg.get("curated", [])
    except Exception:
        curated = []
    oc = opencode_model.discover_opencode_models()
    try:
        ollama = llm.ollama_tags()
    except Exception:
        ollama = []
    return {
        "ollama": ollama,
        "curated": curated,
        "opencode": oc,
        "ollama_ready": llm.ollama_ready(),
        "opencode_ready": True,
        "explain_opencode": opencode_model.full_report().get("explain", ""),
    }


def _load_curated() -> dict:
    p = Path(__file__).resolve().parent.parent.parent / "plugin" / "models.json"
    if not p.exists():
        return {"curated": []}
    import json
    return json.loads(p.read_text(encoding="utf-8"))


@app.get("/opencode/models")
def opencode_models():
    return JSONResponse(opencode_model.full_report())


@app.post("/chat")
async def chat(body: ChatReq):
    try:
        if body.task == "describe":
            if not body.media_path:
                raise HTTPException(400, "media_path required for describe")
            frames = media.sample_frames(body.media_path, n=1, size=256)
            if not frames:
                raise HTTPException(400, "no frames could be extracted")
            model = body.model.removeprefix("ollama:") or "qwen3-vl:2b"
            text = llm.chat_vision(frames, "Describe this video clip in 2-3 sentences and suggest 3 captions.", model)
            return {"text": text, "model": body.model or model}
        model = body.model.removeprefix("ollama:") or "qwen3:4b"
        prompt = body.prompt or _auto_prompt(body.task)
        text = llm.chat([{"role": "user", "content": prompt}], model)
        return {"text": text, "model": body.model or model}
    except Exception as e:
        return _err(e)


def _auto_prompt(task: str) -> str:
    return {
        "chat": "Say hello and ask what they'd like help with in Premiere Pro.",
        "script": "Write a short, punchy voiceover script for a 60-second fun video. Keep it casual.",
        "title": "Suggest 5 punchy titles for a short-form video.",
        "captions": "Write engaging short captions for a social video.",
        "describe": "Describe a short video clip and suggest 3 captions.",
    }.get(task, "You are AIMeva, a Premiere Pro editing assistant.")


@app.get("/agents")
def agent_list():
    return {"agents": agents.list_agents()}


@app.post("/agents/run")
async def agent_run(body: AgentRunReq):
    try:
        if body.agent not in [a["id"] for a in agents.AGENTS]:
            raise HTTPException(400, f"unknown agent {body.agent}")
        result = {}
        cancel = threading.Event()

        def cb(res):
            result.update(res)
            cancel.set()

        agents.run_agent_async(body.agent, body.prompt or "", cb, body.media_path)
        if not cancel.wait(timeout=180):
            raise HTTPException(504, "agent timed out")
        if not result.get("ok"):
            raise HTTPException(500, result.get("error", "agent failed"))
        return {"output": result["output"]}
    except Exception as e:
        return _err(e)


@app.get("/mcp/list")
def mcp_list():
    return mcp_server.status()


@app.post("/mcp/call")
async def mcp_call(body: McpCallReq):
    try:
        return {"result": mcp_server.call_tool(body.server, body.tool, body.arguments)}
    except Exception as e:
        return _err(e)


def _err(e: Exception):
    tb = traceback.format_exc()
    code = e.status_code if hasattr(e, "status_code") and isinstance(getattr(e, "status_code"), int) else 500
    return JSONResponse(
        {"error": str(e), "trace": tb.splitlines()[-3:] if tb else []},
        status_code=code,
    )


def run():
    import uvicorn
    uvicorn.run("ai_workers.index:app", host="127.0.0.1", port=8000, reload=False)


if __name__ == "__main__":
    run()