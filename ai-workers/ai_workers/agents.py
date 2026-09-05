"""Callback-based agent runner (no AST parsing, easy to understand).
Agents are simple prompts. Long-running tasks run in a background thread.
"""
from __future__ import annotations

import json
import threading
from urllib.parse import quote

import requests

from . import llm

AGENTS = [
    {"id": "assistant", "name": "Assistant",
     "description": "General editing assistant - answers questions and gives tips.",
     "system": "You are AIMeva, a friendly Premiere Pro editing assistant. Be concise and practical."},
    {"id": "autocut", "name": "Auto-cut advisor",
     "description": "Suggests cut points and pacing for social clips.",
     "system": ("You recommend beat-synced editing for a short social video. "
                "Suggest cut times, pacing, and which moments to highlight. Be concise.")},
    {"id": "sound", "name": "Sound designer",
     "description": "Writes a sound-design brief (music/SFX/ambience).",
     "system": ("You are a sound designer for short-form video. Write a short "
                "sound-design brief given a clip description or theme.")},
    {"id": "title", "name": "Title writer",
     "description": "Creates punchy titles and captions.",
     "system": "You write punchy, short titles and captions for social video clips."},
    {"id": "editor", "name": "Editor critic",
     "description": "Reviews a script/timeline description and suggests edits.",
     "system": "You are a ruthless content editor who reviews a plan and returns concrete improvements."},
]

RESULT_CACHE: list[dict] = []


def list_agents() -> list[dict]:
    return [{k: a[k] for k in ("id", "name", "description")} for a in AGENTS]


def run_agent_async(agent_id: str, prompt: str, callback: callable, media_path: str | None = None):
    def work():
        try:
            text = _run(agent_id, prompt, media_path)
            callback({"ok": True, "output": text})
        except Exception as e:
            callback({"ok": False, "error": str(e)})
    threading.Thread(target=work, daemon=True).start()


def _run(agent_id: str, prompt: str, media_path: str | None) -> str:
    agent = next((a for a in AGENTS if a["id"] == agent_id), AGENTS[0])
    if media_path:
        try:
            info = _probe_media(media_path)
        except Exception:
            info = {"media": media_path}
        user = (
            f"{prompt}\n\nCONTEXT - media info:\n{json.dumps(info, default=str)}\n"
            "Use this along with the prompt; list any extra files that would help your task."
        )
    else:
        user = prompt
        info = {}
    return llm.chat([{"role": "system", "content": agent["system"]},
                     {"role": "user", "content": user}], _default_model())


def _default_model() -> str:
    try:
        tags = llm.ollama_tags()
        for pref in ("qwen3:8b", "qwen3:4b", "phi4-mini", "llama3.2"):
            if any(t["name"].split(":")[0] == pref for t in tags):
                return "ollama:" + pref
    except Exception:
        pass
    return "ollama:qwen3:4b"


def _probe_media(path: str) -> dict:
    from . import media
    return media.probe(path)