# Aimeva — Memory Capsule

> Project memory/context for resuming work. Update after every session.

Last updated: 2026-09-05 (late)
Repo: `kuldeep7ke/aimeva` (public, default branch **master**)

---

## 1. What this is

**Aimeva** is a **free, open-source (MIT) CEP extension for Premiere Pro 2023+** (PPRO
`[23.0,99.9]`, CSXS 11). Stateless ExtendScript host, local-first AI worker
(FastAPI + Ollama + vendored ffmpeg), **no backend / no license server / no encryption** —
per user directive "free, open source, auto-updatable, user friendly, no encrypted files".

Capabilities: beat-synced auto-cut, silence marking, scene/highlights, sound generation on the
grid, reframe preview→apply with correct Motion-scale math, chat/describe/agents/MCP, opencode
free-model discovery, auto-update via GitHub raw + releases.

## 2. Repository layout

```
.
├── extension/            CEP 11 panel: CSXS/manifest.xml, jsx/hostscript.jsx (stateless), js/
├── ai-workers/           Python package ai_workers/ + bin/ (ffmpeg) + run-worker.ps1 launcher
├── plugin/               models.json (curated registry) + update.json (auto-update manifest)
├── installer/            build-zxp.ps1, install-zxp, uninstall-zxp, start-worker.bat
├── tests/                host.test.mjs (VM harness, node --test)
└── docs/                 README, INSTALLATION, USAGE, DISTRIBUTION, REBUILD_PLAN, MEMORY
```

## 3. Architecture decisions (do not silently reverse)

| Decision | Rationale |
|----------|-----------|
| **CEP-only, single product `com.aimeva.cep`** | UXP can't run on Premiere 2023 (25.6+ only). The old `ai-meva-plugin` UXP + `.ccx` route is frozen. |
| **Stateless host: `__host.dispatch(json)` only** | No cached Premiere handles (the old `roots` R0..Rn bridge threw `) does not have a value` on sequence switches). Every op re-resolves `app.project`, `activeSequence`, `nodeId` fresh; whole flows in ONE atomic call; file-scope `var __host` (NOT `this.__host`, no `"use strict"`). |
| **Manifest proven rules** | No default `xmlns` on `<ExtensionManifest>`; no `--v=0` CEF flag; `--enable-nodejs` + `--mixed-context`; CSXS 11.0; ExtensionBundleId com.aimeva.cep. Violations = Premiere silently skips the panel. |
| **Worker on `127.0.0.1:8000`** | Single FastAPI app in `ai-workers/ai_workers/index.py`. JSON bodies, local file paths (no uploads). |
| **numpy-only audio** | `audio.py`: 16 kHz mono, spectral-flux onset + tempo autocorrelation, intensity 1–5 maps to grid subsets; silence = smoothed RMS below noise floor. Beat grid snapping rounds to `timebase` (ticks) on the host side. |
| **Vision = 1 request, small frames** | `llm.chat_vision`: base64 `images` array of RAW b64 strings (NOT part-objects — Ollama 400s on part objects), `keep_alive 30m`, temperature 0, timeout 600. `sample_frames(size=256)`. Scene endpoint default `frames=1`; instant ffmpeg `detect_scenes` highlights layer always returned. |
| **Reframe cover = `max(dw/sw, dh/sh)*100`** | Exact cover-zoom Motion Scale (16:9→9:16 ≈ 177.8%). Position stays centered (`keep_center`); host only sets Scale unless numeric positions passed. `temp_path()` returns a str → always `Path(...).exists()`. |
| **opencode discovery is offline-tolerant** | models.dev catalog when reachable; else `KNOWN_FREE_CANDIDATES` as `catalog_source:"builtin-fallback"`, `available:false`; reads `~/.config/opencode/opencode.json` + `~/.local/share/opencode/auth.json` keys for provider eligibility; lives in `ai_workers/opencode_model.py`. |
| **Panel never deletes media** | Worker scratch only. `media.scrub_tmp` restricted to scratch paths. |
| **Extension = source of truth** | Installer copies `extension/` verbatim; no compile step. `nodejs` updates (maint): re-download CEP `CSInterface.js`. |
| **All code plaintext** | No obfuscation; builds don't run a protect step. |

## 4. Ports & endpoints

| Service | Port |
|---------|------|
| Aimeva worker (uvicorn) | 8000 |
| Ollama | 11434 |

```
GET  /health                       -> {ok, ffmpeg(bool), ollama(bool), tmp}
POST /analyze/beats  {audio, mode: beats|silence, intensity, min_gap, threshold_db}
POST /analyze/scene  {footage, model, prompt, frames(1..6)}  -> highlights + auto_highlights + summary
POST /sound/generate {prompt, duration, bpm, engine: local}   -> local-synth wav (pad+sub on grid)
POST /reframe        {footage, ratio, mode, include_transform}-> preview path + transform{scale,keep_center}
GET  /models         -> {ollama[], curated[], opencode[], ollama_ready}
GET  /opencode/models-> opencode free models + catalog stats   (in /models too)
POST /chat           {task, model, prompt, media_path?}         describe = vision
GET  /agents         ; POST /agents/run
GET  /mcp/list       ; POST /mcp/call {server:"local-media", tool:"probe_media"|"extract_audio"}
```

## 5. Current status (2026-09-05)

- [x] Stateless host rewrite (`extension/jsx/hostscript.jsx`) — ops ping/env/selectedClip/
      listClips/mediaPath/importFile/addMarkers/insertClip/insertSound/autoCut/
      applySilencePlan/applyReframe/selfTest; manual JSON fallback; `%TEMP%\aimeva-host.log`.
- [x] **Tests `tests/host.test.mjs` 16/16 green** incl. stateless sequence-swap + manual-JSON
      fallback (VM harness, `node --test`).
- [x] Panel UI 5 tabs + `config.js/host.js/worker.js/models.js/updater.js/ui.js`.
- [x] Worker package `ai_workers/` (media/audio/llm/opencode_model/agents/mcp_server/sound/
      reframe/index) + `pyproject.toml` + `requirements.txt`; venv `ai-workers\.venv` editable
      install OK (fastapi 0.141.1, uvicorn 0.52.4, numpy 2.5.2).
- [x] **Live worker smoke test** (this session, all 200s):
      health(ffmpeg+ollama) / beats bpm=117.2 on 120bpm synth (grid snap 0.512..) /
      silence found [3.39–5.57]s gap / sound local-synth wav / reframe 320x180→100x180
      transform scale 100 / models{ollama=4, curated=8, opencode=4} / chat via llama3.2:3b
      (real title) / agents(5) / mcp list+call probe_media / vision direct-ollama 200 with
      description at 164s (CPU box).
- [x] Vision endpoint graceful (slow-CPU reality): single 256px frame exceeds 600s on this
      box → clean 200 with `vision model unavailable (…read timeout…)` + instant
      `auto_highlights` still returned. **Not a crash; environmental.** Direct Ollama vision
      proven working (200 + description). Async job queue = future enhancement.
- [x] Fixed along the way: curated `models.json` path (3 parents up), opencode offline fallback,
      reframe `th/dh` naming + `Path(out_path)` + cover-scale, `chat_vision` raw-b64 images,
      scene `frames=1` + ffmpeg scene-detect layer, describe→256px.
- [x] Docs rewritten for the CEP/free product (README/INSTALLATION/USAGE/DISTRIBUTION/MEMORY).
- [ ] **Not load-tested in a live Premiere session** (needs you to run the Settings → Self Test
      once real PPRO 2023 is open — that's the acceptance gate).
- [ ] Sound: real Foley/ambience engine (currently local synth). MMAudio/WaveSpeed/ThinkSound.
- [ ] Async job queue for slow vision on CPU-only machines.
- [ ] Panel polish: streaming chat UI, per-op progress on long vision calls.

## 6. Conventions

- No code comments unless asked. Plaintext everywhere. snake_case worker JSON; host JSON is
  camelCase in the envelope `{op, params}` → `{ok,data|error,line}`.
- Host errors carry `line`; every request/result logged to `%TEMP%\aimeva-host.log`.
- venv drives the worker: `\ai-workers\.venv\Scripts\python.exe`. Launch detached:
  `Start-Process powershell -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File "<abs>\ai-workers\run-worker.ps1"' -WindowStyle Hidden` — do **not** pipe uvicorn through Tee (breaks detach) or use `-RedirectStandardOutput` (tool kills the tree). Console capture is available at
  `ai-workers\scratch\worker-console.log` via `scratch\launch-worker-console.bat` (STILL TRYING).
- Debug/diagnostics: `%TEMP%\aimeva-host.log`, `ai-workers\scratch\`.
- Do NOT commit: `.venv/`, `ai-workers/bin/*.exe*`, `scratch/`, `dist/`, `*.zxp`.

## 7. How to verify after changes

1. Python: `ai-workers\.venv\Scripts\python.exe -m py_compile ai-workers\ai_workers\*.py`,
   then relaunch + `Invoke-RestMethod http://127.0.0.1:8000/health`.
2. Host: `node --test tests\host.test.mjs` (16 tests). JS: `node --check` each edited file.
3. ZXP: `installer\build-zxp.ps1` (verifies entries + manifest). Install: `installer\install-zxp.bat`.
4. Live Premiere: Settings → Self Test, read `%TEMP%\aimeva-host.log`.

## 8. Next-session handoff

1. Push `master`.
2. Run full host suite + worker smoke (section 7).
3. Live-Premiere self-test → fix any real host op (host.log line numbers will locate it).
4. Then: real sound engine, async vision queue, chat streaming UI.
5. If touching opencode discovery: keep the offline fallback; re-run `GET /opencode/models` with
   `catalog_models`/`provider_dirs` eyes.