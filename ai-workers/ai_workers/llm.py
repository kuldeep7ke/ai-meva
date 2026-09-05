"""Local and cloud model access: Ollama via HTTP, plus an optional OpenAI-style
cloud endpoint. The panel-proxy /opencode endpoint lives in opencode_model.py."""
from __future__ import annotations

import json
import os

import requests

OLLAMA = os.environ.get("AIMEVA_OLLAMA", "http://127.0.0.1:11434")
CLOUD_URL = os.environ.get("AIMEVA_CLOUD_URL", "").rstrip("/")
CLOUD_KEY = os.environ.get("AIMEVA_CLOUD_KEY", "")


def ollama_ready() -> bool:
    try:
        r = requests.get(f"{OLLAMA}/api/version", timeout=2)
        return r.status_code == 200
    except Exception:
        return False


def ollama_tags() -> list[dict]:
    try:
        r = requests.get(f"{OLLAMA}/api/tags", timeout=5)
        if r.status_code != 200:
            return []
        models = r.json().get("models", [])
        return [{"id": "ollama:" + m["name"], "name": m["name"], "source": "ollama",
                 "size_gb": round((m.get("size") or 0) / (1024 ** 3), 2),
                 "capabilities": ["chat"]} for m in models]
    except Exception:
        return []


def ollama_has(name: str) -> bool:
    return any(t["name"].split(":")[0] == name for t in ollama_tags())


def chat(messages: list[dict], model: str, timeout: int = 300) -> str:
    model = model.removeprefix("ollama:")
    if model in ("opencode", ""):
        raise RuntimeError("use an ollama model id, e.g. ollama:qwen3:4b")
    body = {"model": model, "messages": messages, "stream": False,
            "keep_alive": "30m", "options": {"temperature": 0}}
    r = requests.post(f"{OLLAMA}/api/chat", json=body, timeout=timeout)
    if r.status_code != 200:
        raise RuntimeError(f"ollama error {r.status_code}: {r.text[:300]}")
    return (r.json().get("message") or {}).get("content", "")


def chat_vision(frames: list[str], prompt: str, model: str = "qwen3-vl:2b",
                timeout: int = 600) -> str:
    import base64
    images = []
    for f in frames:
        with open(f, "rb") as fh:
            images.append(base64.b64encode(fh.read()).decode())
    prompt_image = ("You are Aimeva, a premiere editing assistant. Look at the "
                    "sampled frames from a video clip. " + prompt)
    body = {
        "model": model,
        "messages": [{"role": "user", "content": prompt_image, "images": images}],
        "stream": False,
        "keep_alive": "30m",
        "options": {"temperature": 0},
    }
    r = requests.post(f"{OLLAMA}/api/chat", json=body, timeout=timeout)
    if r.status_code != 200:
        raise RuntimeError(f"ollama vision error {r.status_code}: {r.text[:300]}")
    return (r.json().get("message") or {}).get("content", "")


def cloud_chat(messages: list[dict], model: str, timeout: int = 300) -> str:
    body = {"model": model, "messages": messages, "stream": False}
    headers = {"Authorization": f"Bearer {CLOUD_KEY}"} if CLOUD_KEY else {}
    r = requests.post(f"{CLOUD_URL}/v1/chat/completions", json=body, headers=headers, timeout=timeout)
    if r.status_code != 200:
        raise RuntimeError(f"cloud error {r.status_code}: {r.text[:300]}")
    return r.json()["choices"][0]["message"]["content"]


def models_report() -> dict:
    llm_down = ""
    try:
        ollama = ollama_tags()
        llm_down = "ok"
    except Exception as e:
        ollama = []
        llm_down = str(e)
    return {"ollama_ready": ollama_ready(), "ollama_models": ollama,
            "cloud_configured": bool(CLOUD_URL)}