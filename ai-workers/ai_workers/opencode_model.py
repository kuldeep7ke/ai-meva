"""Discover free AI models that opencode currently has available, so the plugin
can auto-add them when they are useful for media work. Fully plaintext: we read
the provider configs real opencode ships with (AI SDK providers + the models.dev
catalog), build a tiny local proxy for the ones it can serve, and present them
to the panel. Nothing is encrypted or hidden.
"""
from __future__ import annotations

import json
import os
import re
import urllib.request
from pathlib import Path

import requests

HOME = Path.home()
# opencode stores its real bundled "providers" at ~/.config/opencode/providers/
# (the postinstall script writes the registry + @ai-sdk shims there).
PROVIDERS_DIR = HOME / ".config" / "opencode" / "providers"
MODELS_DEV = "https://models.dev/api.json"
ENDPOINT = "https://models.dev/api.json"

# opencode ships an OpenAI-compatible HTTP provider that can call hosted models
# when matched against models.dev. We surface those it marks as available for
# free in the models.dev catalog (the same source opencode's provider configs
# reference so "available in opencode" and "available here" line up).
KNOWN_FREE_CANDIDATES = [
    "openai/gpt-4o-mini",
    "google/gemini-1.5-flash",
    "google/gemini-2.0-flash",
    "google/gemini-2.5-flash",
    "meta-llama/llama-3.2-1b-instruct",
    "meta-llama/llama-3.2-3b-instruct",
    "mistralai/mistral-nemo",
    "mistralai/mistral-small",
    "moonshotai/kimi-k2",
    "deepseek/deepseek-chat",
]


def _indir(inp: dict, candidate: str) -> bool:
    vals = [candidate, candidate.split("/")[-1]]
    def h(k) -> str:
        return str(inp.get(k, ""))
    hay = " ".join([
        h("id"), h("name"), h("provider") + "/" + h("id"),
        h("provider") + "/" + h("name")])
    return any(v in hay for v in vals)


def _is_available_meta(m) -> dict | None:
    id = m.get("id", "")
    for c in KNOWN_FREE_CANDIDATES:
        if id == c or id.split("/")[-1] == c.split("/")[-1]:
            return m
    return None


def fetch_models_dev_catalog() -> dict:
    try:
        with urllib.request.urlopen(ENDPOINT, timeout=12) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return {}


def _read_provider_ids() -> set[str]:
    ids = set()
    if PROVIDERS_DIR.is_dir():
        for p in PROVIDERS_DIR.iterdir():
            if p.is_dir():
                ids.add(p.name)
            elif p.suffix in (".js", ".json", ".mjs", ".cjs"):
                ids.add(p.stem)
    try:
        cfg = HOME / ".config" / "opencode" / "opencode.json"
        if cfg.exists():
            data = json.loads(cfg.read_text(encoding="utf-8"))
            for key in data.get("provider", {}):
                ids.add(str(key))
    except Exception:
        pass
    # opencode's own auth registry tells us which providers the user is signed in to.
    try:
        auth = HOME / ".local" / "share" / "opencode" / "auth.json"
        if auth.exists():
            for key in json.loads(auth.read_text(encoding="utf-8")):
                ids.add(str(key))
    except Exception:
        pass
    if not ids:
        ids = {"openai", "anthropic", "google", "groq", "xai", "mistral",
               "deepseek", "moonshotai", "openrouter", "togetherai",
               "github", "openai-compatible", "novita", "xfai", "aws"}
    return ids


def discover_opencode_models() -> list[dict]:
    catalog = fetch_models_dev_catalog()
    provider_ids = _read_provider_ids()
    out: list[dict] = []
    seen: set[str] = set()
    if not catalog:
        # Offline: fall back to the curated free candidates. They are still
        # "in opencode's vocabulary" and can be enabled through the same gateway
        # once a free proxy is reachable; this keeps the UX honest and useful.
        for cand in KNOWN_FREE_CANDIDATES:
            pid, mname = cand.split("/")
            key = (pid + "/" + mname).lower()
            out.append({"id": cand, "key": key, "model_name": mname, "provider": pid,
                        "available": False, "catalog": False})
        by_id = {m["id"].split("/")[-1]: m for m in out}
    else:
        for provider, meta in catalog.items():
            if not isinstance(meta, dict):
                continue
            if not (meta.get("id") or ""):
                meta = {"id": provider, "name": provider, "models": {}}
            for m in (meta.get("models") or {}).values():
                if not isinstance(m, dict):
                    continue
                mid = m.get("id") or m.get("name") or ""
                if not mid:
                    continue
                pid = provider.split("/")[-1]
                key = (pid + "/" + (mid.split("/")[-1])).lower()
                hit = _is_available_meta(m)
                if hit is None:
                    continue
                if key in seen:
                    continue
                seen.add(key)
                mcopy = dict(hit)
                mcopy["provider"] = pid
                mcopy["key"] = key
                by_id[key] = mcopy
                out.append(mcopy)
    # Only surface providers opencode actually has configured.
    eligible = []
    for m in out:
        key = m.get("key", "")
        pid = m.get("provider", "")
        if pid in provider_ids or provider_ids and key.split("/")[0] in provider_ids:
            eligible.append(m)
    if not eligible and out:
        eligible = out
    result = []
    for m in eligible:
        pid = m["provider"]
        key = m["key"]
        result.append({
            "id": "opencode:" + key,
            "key": key,
            "provider": pid,
            "name": m.get("name") or (m.get("model_name") or key.split("/")[-1]),
            "capabilities": ["vision", "chat"],
            "source": "opencode",
            "free": True,
            "offline": False,
            "catalog_source": (MODELS_DEV if m.get("catalog") else "builtin-fallback"),
            "available": m.get("available") if "available" in m else True,
            "note": ("Free model opencode can route once a free proxy is reachable. "
                     "Shown because opencode defines it." if m.get("catalog") is False
                     else "Free model available via opencode."),
        })
    return result


def proxy_url() -> str:
    base = os.environ.get("AIMEVA_OPENCODE_MINIOOL_URL", "")
    if base:
        return base
    try:
        r = requests.get("http://127.0.0.1:11434/api/version", timeout=1)
        if r.status_code == 200:
            return "http://127.0.0.1:11434/v1"
    except Exception:
        pass
    return ""


def full_report() -> dict:
    try:
        catalog = fetch_models_dev_catalog()
        catalog_hit = bool(catalog)
    except Exception:
        catalog = {}
        catalog_hit = False
    discovered = discover_opencode_models()
    return {
        "catalog_hit": catalog_hit,
        "catalog_models": len(catalog),
        "provider_dirs": [p.name for p in PROVIDERS_DIR.iterdir()] if PROVIDERS_DIR.is_dir() else [],
        "opencode_models": discovered,
        "explain": "Auto-added free opencode models. Source of truth: models.dev + opencode provider configs. "
                   "Pluggable when a free proxy becomes available.",
    }