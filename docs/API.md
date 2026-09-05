# Aimeva — API Reference

Two surfaces:

1. **Worker HTTP API** — FastAPI on `http://127.0.0.1:8000` (all bodies are JSON, keys are
   **snake_case**, responses are JSON; CORS `*` so the CEP panel can call it).
2. **Host dispatch** — the ExtendScript envelope the panel uses to talk to Premiere Pro.

---

## 1. Worker HTTP API

### `GET /`
Service index + endpoint list.

```json
{ "name": "Aimeva Worker", "version": "0.1.0",
  "endpoints": ["GET /health", "POST /analyze/beats", "..."] }
```

### `GET /health`
Liveness probe. Also reports tool availability.

```json
{ "ok": true, "name": "Aimeva Worker", "version": "0.1.0",
  "ffmpeg": true, "ollama": true, "tmp": "C:\\...\\ai-workers\\scratch" }
```

> `tmp` is the worker scratch dir (temp/preview files live here).

### `POST /analyze/beats`
Body: `{ "audio": "<abs path to wav/mp4>", "mode": "beats|silence", "intensity": 1-5,
"min_gap": 0.6, "threshold_db": -35.0 }`

`mode=beats` (default) — BPM + beat grid (numpy: spectral flux onsets + tempo autocorrelation,
16 kHz mono). `intensity` selects how many musical subdivisions get returned (1 = every 4th,
5 = every beat + fills).

```json
{"mode":"beats","bpm":117.2,"beat_times":[0.512,1.024,1.376,1.536,2.048],
 "count":23,"audio":"C:\\...\\test_beats_120.wav","sample_rate":16000,"total_sec":10.0}
```

`mode=silence` — low-energy regions with a smoothed RMS floor.

```json
{"mode":"silence","regions":[{"startSec":3.392,"endSec":5.568,"durSec":2.176,
  "start_sec":3.392,"end_sec":5.568,"dur_sec":2.176}],"count":1,
 "total_silence_sec":2.176,"threshold_db":-35.0,"min_gap":0.6,
 "audio":"C:\\...\\test_with_gap.wav","sample_rate":16000}
```

### `POST /analyze/scene`
Body: `{ "footage": "<abs mp4/mov path>", "model": "ollama:qwen3-vl:2b" | "",
"prompt": "", "frames": 1..6 }`

Always returns an **instant** `auto_highlights` list from ffmpeg scene-change detection. If a
vision model is available and frames can be sampled, it also returns `highlights` + a natural
language `summary` (frame count = `frames`, default 1, images resized to 256px — keep this low
on CPU-only machines).

```json
{"highlights":[],"auto_highlights":[{"start_sec":1.28},{"start_sec":4.15}],
 "model":"ollama:qwen3-vl:2b",
 "summary":"…model reply or 'vision model unavailable (…)…'",
 "footage":"C:\\...\\clip.mp4"}
```

### `POST /sound/generate`
Body: `{ "prompt": "dark riser", "duration": 3, "bpm": 120, "engine": "local" }`

Generates a WAV in the scratch dir; `engine=local` is the built-in synth (pad + sub on the beat
grid; `bpm=0` skips the grid). Returns the absolute file path.

```json
{"path":"C:\\...\\ai-workers\\scratch\\aimeva_synth__epavec0.wav",
 "duration":3.0,"engine":"local-synth","bpm":120.0}
```

### `POST /reframe`
Body: `{ "footage": "<abs path>", "ratio": "9:16", "mode": "smart-crop|edge-extension|subject-tracking",
"include_transform": true }`

Renders a preview clip and computes the Motion transform.

```json
{"preview_path":"C:\\...\\aimeva_reframe_smart-crop_5gajphpw.mp4",
 "path":"C:\\...\\aimeva_reframe_smart-crop_5gajphpw.mp4",
 "mode":"smart-crop","ratio":"9:16",
 "source_dim":"320x180","target_dim":"100x180",
 "transform":{"scale":100.0,"keep_center":true,"positionX":null,"positionY":null,
              "source":"320x180","target":"100x180"}}
```

> `transform.scale` is the **cover-zoom** the host applies to Motion Scale (16:9→9:16 ≈ 177.8%).
> `keep_center:true` means position stays centered; the host sets only Scale unless the panel
> passes numeric `positionX/Y`.

### `GET /models`
Merged model registry (see [MODELS.md](MODELS.md)).

```json
{"ollama":[{"name":"qwen3-vl:2b"},{"name":"llama3.2:3b"}],
 "curated":[{"id":"ollama:qwen3-vl:2b","tasks":["scene-review","clip-describe"]}],
 "opencode":[{"id":"opencode:openai/gpt-4o-mini","available":false,
              "catalog_source":"builtin-fallback"}],
 "ollama_ready":true,"opencode_ready":true,
 "explain_opencode":"Auto-added free opencode models. …"}
```

### `GET /opencode/models`
opencode discovery diagnostic.

```json
{"catalog_hit":false,"catalog_models":0,"provider_dirs":[],
 "opencode_models":[{ "id":"opencode:openai/gpt-4o-mini", "key":"openai/gpt-4o-mini",
   "provider":"openai","name":"GPT-4o-mini","capabilities":["vision","chat"],
   "source":"opencode","free":true,"offline":false,
   "catalog_source":"builtin-fallback","available":false,"note":"…" }],
 "explain":"Auto-added free opencode models. …"}
```

### `POST /chat`
Body: `{ "task": "chat|script|title|captions|describe", "prompt": "", "model": "ollama:qwen3:4b",
"media_path": "" }`

- `task` drives the default prompt when `prompt` is empty (see `_auto_prompt`).
- `task=describe` requires `media_path`, samples 1 frame at 256px, and uses a **vision** model
  (default `ollama:qwen3-vl:2b`) to describe + suggest captions.

```json
{"text":"Here's a potential YouTube video script ...","model":"ollama:llama3.2:3b"}
```

### `GET /agents`
Built-in agents (asynchronous, LLM-backed).

```json
{"agents":[{"id":"assistant","name":"Aimeva Assistant","description":"…"},{"id":"autocut","…"},
           {"id":"sound","…"},{"id":"title","…"},{"id":"editor","…"}]}
```

### `POST /agents/run`
Body: `{ "agent": "title", "prompt": "…", "media_path": "" }` → waits up to **180s**.

```json
{"output":"…agent reply…"}
```

Errors: `504 {error:"agent timed out"}` or `500 {error:…, trace:[…]}`.

### `GET /mcp/list`
Built-in MCP servers (usable by any MCP-capable host).

```json
{"servers":{"local-media":{"name":"local-media","tools":[
   {"name":"probe_media","description":"Media probe via ffprobe"},
   {"name":"extract_audio","description":"Extract audio track from media"} ]}}}
```

### `POST /mcp/call`
Body: `{ "server": "local-media", "tool": "probe_media", "arguments": { "path": "…" } }`

```json
{"result":{"path":"C:\\...\\clip.mp4","has_video":true,"has_audio":false,
           "duration_sec":3.0,"width":320,"height":180,"codec":"h264"}}
```

### Errors
Every endpoint returns, on failure:

```json
{ "error": "<message or 'audio path required'>", "trace": ["<last 3 trace lines>"] }
```

with the appropriate HTTP status (`400/500/504`).

---

## 2. Host dispatch (CEP → ExtendScript → Premiere)

The panel calls `host.dispatch(op, params)` which runs
`evalScript("__host.dispatch(" + JSON.stringify({op, params}) + ")", cb)`.

Envelope:

```json
{ "op": "applyReframe", "params": { "nodeId": "…", "scale": 177.8 } }
```

Response:

```json
{ "ok": true, "data": { … } }
```

or

```json
{ "ok": false, "error": "…message…", "line": "<hostscript.jsx:42>" }
```

### Ops

| op | params | returns |
|----|--------|---------|
| `ping` | — | host info (version, timebase) |
| `env` | — | project, active sequence, timebase, playhead seconds, markers |
| `selectedClip` | `nodeId?` | selected clip `{nodeId, name, mediaPath}` or empty |
| `listClips` | — | clips across video + audio tracks (`{nodeId, name, startSec, durSec}`) |
| `mediaPath` | `nodeId` | absolute media path for a project item |
| `importFile` | `path` | imports into the project; returns the new item `nodeId` |
| `addMarkers` | `times[]` | adds sequence markers at each second (frame-accurate via ticks) |
| `insertClip` | `nodeId, sec, audioOnly` | inserts a clip at playhead/`sec` |
| `insertSound` | `path, sec` | imports a wav and inserts it as audio |
| `autoCut` | `times[]`, `dryRun?` | markers (+ optional inserts) fed from the worker plan |
| `applySilencePlan` | `regions[]`, `dryRun?` | marks silence region starts |
| `applyReframe` | `nodeId, scale`, `positionX?`, `positionY?` | sets Motion Scale (and optional Position) on the selected clip |
| `selfTest` | — | runs every op as a dry run; reports per-step OK/FAIL |

The host is **stateless**: every call re-resolves `app.project → activeSequence → nodeId`
freshly — no cached Premiere handles. A full flow (e.g. auto-cut) is sent as ONE dispatch so no
cross-call state exists. Every request/result/error is logged to `%TEMP%\aimeva-host.log`.

If the panel's PDF/CEF runtime lacks `JSON`, `hostscript.jsx` falls back to a manual JSON
encoder/decoder (same envelope).