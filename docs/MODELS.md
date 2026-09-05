# AIMeva — Models

AIMeva is **local-first**: the core features (`beats`, `silence`, `reframe`, `sound`) run with
**no model at all**. Models are only needed for the *text/vision* features (chat, clip
descriptions, scene summaries, agents). This guide explains where the panel gets its model list
and how to make the right models available.

## 1. Where the model list comes from

The panel's model dropdowns are merged from **three sources** (`GET /models` on the worker):

| Source | Key | Meaning |
|--------|-----|---------|
| Curated registry | `curated` | `plugin/models.json` (auto-fetched from GitHub). Sensible defaults + task-tagged candidates. |
| Live Ollama install | `ollama` | Whatever you've `ollama pull`ed, detected at runtime — **auto-added** with no config. |
| opencode free models | `opencode` | Free models opencode defines (`GET /opencode/models`). Auto-added when they become available. |

Nothing in the registry is required to run the plugin; it only improves the dropdown choices.

## 2. Curated defaults (`plugin/models.json`)

| Task | Default | Alternatives |
|------|---------|--------------|
| Scene analysis / describe | `ollama:qwen3-vl:2b` | `ollama:qwen2.5vl:7b` (better, heavier), `ollama:llama3.2-vision`, `opencode:gemini-1.5-flash` (when available) |
| Chat / titles / scripts | `ollama:qwen3:4b` | `ollama:qwen3:8b`, `ollama:phi4-mini` |

`opencode_media_task_keywords` in the manifest is the keyword set the worker uses to decide
which opencode models are "useful for media tasks".

## 3. Ollama (recommended, fully offline)

```powershell
ollama pull qwen3:4b        # text chat — titles, scripts, captions, agent reasoning
ollama pull qwen3-vl:2b     # vision — clip descriptions, scene summaries
```

- The worker talks to Ollama at `http://127.0.0.1:11434` (override with env `AIMEVA_OLLAMA`).
- Any installed tag shows up in the panel automatically (no restart needed; hit **Refresh** in
  Settings if you want it immediately).
- **Vision is slow on CPU-only machines** — a single 256px frame through `qwen3-vl:2b` can take
  minutes. Scene *highlight* detection never waits for a model (it uses ffmpeg scene-change
  detection and returns instantly); the vision model only adds a summary/captions layer.

## 4. opencode free models (auto-added)

`extension` ships no opencode key. Instead the worker **discovers** free models at runtime
(`GET /opencode/models`):

1. Fetches the [models.dev](https://models.dev) catalog when the network allows.
2. If the catalog is unreachable (offline), it falls back to the built-in free-candidate list
   and marks each as `"catalog_source": "builtin-fallback"`, `"available": false` so the UI
   never lies about availability.
3. Provider eligibility comes from your opencode config
   (`~/.config/opencode/opencode.json`) and sign-ins
   (`~/.local/share/opencode/auth.json`) — only providers you actually have are surfaced.

The panel **auto-adds** surfaced opencode models to its dropdown the moment they appear — no
reinstall, just **Settings → Update / refresh**.

> Current status on the dev machine: the catalog is unreachable in this environment, so the
> worker reports the 4 built-in candidates (gpt-4o-mini, gemini-1.5-flash, gemini-2.0-flash…)
> as *listed but not yet routed* (`available: false`). Once a free routing proxy is reachable,
> they flip to usable automatically.

## 5. How to add or retune models

1. Edit `plugin/models.json` (`curated` + `opencode_media_task_keywords`).
2. Merge on `master` — the panel's next **Update** check pulls it and refreshes the drop-downs.
3. Ollama models need no registry entry; pull them and they appear.
4. `GET /opencode/models` shows the discovery diagnostic (`catalog_models`,
   `provider_dirs`, `opencode_models`) for debugging.

## 6. Model → feature map

| Feature | Uses | Model needed? |
|---------|------|---------------|
| Beat detection | numpy (local) | No |
| Silence marking | numpy (local) | No |
| Sound generation | local synth | No |
| Reframe | ffmpeg | No |
| Scene highlights | ffmpeg `select` scene detection | No |
| Scene summary / captions | vision (Ollama) | Yes — `qwen3-vl:2b` etc. |
| Chat / titles / scripts | text LLM (Ollama / opencode) | Yes — `qwen3:4b` etc. |
| Agents | text LLM via Ollama | Yes — defaults to installed qwen3/llama3.2 |
| Media MCP | ffprobe/ffmpeg | No |