"""Minimal MCP server running inside the worker. Provides genuinely useful,
locally-runnable tools (ffprobe/ffmpeg) so MCP is usable out of the box with no
external server. External MCP servers can be added later; the '/mcp/load' hook
is where the OpenAI-compatible adapter would attach (reserved, non-blocking).
"""
from __future__ import annotations

import json
from pathlib import Path

from . import media

BUILTIN_SERVERS = ["local-media"]
LOADABLE_VIA_HTTP = False  # set True when a free OpenAI-compatible MCP bridge is available


def _t(tool: dict) -> dict:
    schema = tool.get("inputSchema") or {"type": "object", "properties": {}}
    return {"name": tool["name"], "description": tool.get("description", ""), "inputSchema": schema}


def list_servers() -> dict:
    return {
        "local-media": {
            "name": "local-media",
            "description": "Probe and analyze local video/audio with ffmpeg/ffprobe (runs on this machine).",
            "tools": [
                _t({"name": "probe_media", "description": "Get duration/resolution/streams of a media file.",
                    "inputSchema": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}}),
                _t({"name": "extract_audio", "description": "Extract a 16kHz mono wav from media.",
                    "inputSchema": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}}),
            ],
        }
    }


def call_tool(server: str, tool: str, arguments: dict) -> dict:
    if tool == "probe_media":
        return media.probe(str(arguments.get("path", "")))
    if tool == "extract_audio":
        return {"path": media.extract_audio_wav(str(arguments.get("path", "")))}
    raise ValueError(f"unknown tool {tool}")


def status() -> dict:
    return {"servers": list_servers(),
            "http_loadable": LOADABLE_VIA_HTTP,
            "note": "Built-in local-media tools always available. External OpenAI-compatible "
                    "MCP servers can mount via /mcp/load when a free bridge is online."}