# AIMeva — Memory Capsule

> Developer memory for resuming work. Update after every session.

- **Last updated:** 2026-09-05 (late — docs restructure session)
- **Repo:** `kuldeep7ke/aimeva` (public, MIT, default branch **master**)
- **Product:** free, open-source CEP extension `com.aimeva.cep` for Premiere Pro 2023+

---

## 1. Product snapshot (read this first)

**What:** A local-first AI editing assistant for **Adobe Premiere Pro 2023+** shipped as a CEP
11 extension with a stateless ExtendScript host. No backend, no license server, no accounts, no
encrypted code/files/data — per the product directive: *free, open source, auto-updatable,
user friendly, no obfuscation*.

**Capabilities:**

- Auto-Edit — beat-synced cuts, silence marking, scene/highlight detection
- Sound — grid-synced bed/riser via a local synth (real Foley engine = future work)
- Reframe — 9:16 / 1:1 / 16:9 / 21:9 preview → apply with exact cover-scale Motion math
- AI Lab — Ollama chat + clip description, 5 agents, built-in `local-media` MCP tools
- opencode free-model auto-discovery/auto-add (offline-tolerant)
- Auto-update — panel pulls `plugin/update.json` + `plugin/models.json` from GitHub `master`

**Stack:** CEP 11 panel (`extension/`, Chromium/CEF) → FastAPI worker `ai_workers/index.py`
(`127.0.0.1:8000`) → Ollama (`11434`) + vendored ffmpeg (`ai-workers/bin`).

**Docs:** full set in `docs/` (hub: `docs/README.md`). **API**: `docs/API.md`.
**Models**: `docs/MODELS.md`. **Dev loop**: `docs/DEVELOPMENT.md`.

---

## 2. Repository layout

```
.
├── extension/            CEP 11 panel: CSXS/manifest.xml, jsx/hostscript.jsx (stateless), js/
├── ai-workers/           Python package ai_workers/ + bin/ (ffmpeg) + run-worker.ps1 launcher
├── plugin/               models.json (curated registry) + update.json (auto-update manifest)
├── installer/            build-zxp.ps1, install-zxp, uninstall-zxp, start-worker.bat
├── tests/                host.test.mjs (VM harness, node --test, 16 tests)
├── README.md             repo-root landing → docs/
└── docs/                 README(hub) INSTALLATION USAGE MODELS API DEVELOPMENT
                          DISTRIBUTION REBUILD_PLAN MEMORY
```

---

## 3. Architecture decisions (do not silently reverse)

| Decision | Rationale |
|----------|-----------|
| **CEP-only, single product `com.aimeva.cep`** | UXP can't run on Premiere 2023 (25.6+ only). Old `ai-meva-plugin` UXP + `.ccx` route frozen (gitignored on disk). |
| **Stateless host: `__host.dispatch(json)` only** | The old `roots` R0..Rn ref cache threw `) does not have a value` on sequence switches. Every op re-resolves `app.project` → `activeSequence` → `nodeId` fresh; whole flows in ONE atomic call; file-scope `var __host` (NOT `this.__host`, NO `"use strict"`). |
| **Manifest proven rules** | No default `xmlns` on `<ExtensionManifest>`; no `--v=0` CEF flag; `--enable-nodejs` + `--mixed-context`; CSXS 11.0; ExtensionBundleId com.aimeva.cep. **XML comments must NOT contain `--`** (broke parsing → panel silently missing; `build-zxp.ps1` now validates). Violations = Premiere silently skips the panel. |
| **Worker on `127.0.0.1:8000`** | Single FastAPI app; JSON bodies with local file paths (no uploads); CORS `*`; full reference in `docs/API.md`. |
| **numpy-only audio** | 16 kHz mono, spectral-flux onsets + tempo autocorrelation, intensity 1–5 → grid subsets; silence = smoothed RMS below noise floor. Host snaps to `timebase` ticks. |
| **Vision = 1 request, small frames** | `images` = raw base64 strings (NOT part objects — Ollama 400s on part objects), `keep_alive 30m`, temperature 0, internal timeout 600. Frames 256px, scene default `frames=1`. |
| **Scene highlights are model-free** | Instant ffmpeg `select=gt(scene,..)` detection always returned; vision only adds summary/captions. |
| **Reframe cover = `max(dw/sw, dh/sh)*100`** | Exact Motion Scale (16:9→9:16 ≈ 177.8%). `keep_center` → host sets Scale only unless numeric positions passed. `temp_path()` returns str → always `Path(...).exists()`. |
| **opencode discovery offline-tolerant** | models.dev when reachable; else builtin candidates as `builtin-fallback` + `available:false`; provider eligibility from `opencode.json` + `auth.json` keys. |
| **Panel never deletes user media** | `media.scrub_tmp` restricted to scratch paths only. |
| **Extension = source of truth** | Installer copies `extension/` verbatim; no compile step. |
| **All code plaintext** | No obfuscation anywhere; builds have no protect step. |

---

## 4. Operational facts & gotchas

**Ports:** AIMeva worker `8000` · Ollama `11434`.

**Endpoints (compact — full detail in `docs/API.md`):**

```
GET  /health | /
POST /analyze/beats  {audio, mode: beats|silence, intensity, min_gap, threshold_db}
POST /analyze/scene  {footage, model, prompt, frames(1..6)}
POST /sound/generate {prompt, duration, bpm, engine}
POST /reframe        {footage, ratio, mode, include_transform}
GET  /models  |  GET /opencode/models
POST /chat    {task, model, prompt, media_path?}   (task=describe → vision)
GET  /agents  |  POST /agents/run  {agent, prompt, media_path}   (180s cap)
GET  /mcp/list  |  POST /mcp/call  {server, tool, arguments}
```

**Launch the worker (proven commands only):**

```powershell
# one-shot
installer\start-worker.bat
# detached (survives console + any tool session)
Start-Process powershell -ArgumentList `
  '-NoProfile -ExecutionPolicy Bypass -File "C:\<abs>\ai-workers\run-worker.ps1"' -WindowStyle Hidden
```

**Do NOT:** pipe uvicorn through `Tee-Object`, or use `Start-Process -RedirectStandardOutput`
for the worker — both break the detached process. Working console capture:
`ai-workers\scratch\launch-worker-console.bat` → logs `scratch\worker-console.log`.

**Diagnostics:** `%TEMP%\aimeva-host.log` (each host request/result/error + file:line) ·
`ai-workers\scratch\` (previews, probe scripts, results).

**Slow-vision reality (dev box, CPU-only):** one 256px frame → ~160s+; whole `/analyze/scene`
can exceed 600s and times out **gracefully** (clean 200, `vision model unavailable (…)` +
instant `auto_highlights`). The worker does **not** crash — it's genuinely slow inference.
Consequence: default query paths avoid vision; the scene endpoint defaults to `frames=1`.

**Git hygiene — do NOT commit:** `.venv/`, `ai-workers/bin/*.exe*`, `scratch/`,
`installer/dist/`, `installer/tools/` (ZXPSignCmd + dev `.p12`), `*.zxp`,
`ai-meva-plugin/`, `*.egg-info/`.

---

## 5. Current status (2026-09-05)

### Done & verified
- [x] Stateless host rewrite — ops: ping/env/selectedClip/listClips/mediaPath/importFile/
      addMarkers/insertClip/insertSound/autoCut/applySilencePlan/applyReframe/selfTest;
      manual-JSON fallback; `%TEMP%\aimeva-host.log`.
- [x] `tests/host.test.mjs` **16/16 green** (incl. stateless sequence-swap + manual JSON).
- [x] Panel: 5 tabs (Auto-Edit / Sound / Reframe / AI Lab / Settings) +
      `config.js host.js worker.js models.js updater.js ui.js`.
- [x] Worker package `ai_workers/` (media/audio/llm/opencode_model/agents/mcp_server/sound/
      reframe/index) — editable venv install OK (fastapi 0.141.1, uvicorn 0.52.4, numpy 2.5.2).
- [x] **Live smoke test (all 200):** beat bpm=117.2 (120 synthesized) with grid snap ·
      silence found the 2.18s gap · local-synth sound wav · reframe 320x180→100x180
      (scale 100) · models {ollama=4, curated=8, opencode=4} · real chat via llama3.2:3b ·
      5 agents · MCP list + probe_media · **direct Ollama vision 200 + description**.
- [x] Scene endpoint graceful degradation proven (600s read-timeout → clean 200 + instant
      highlights). Root cause of earlier "connection reset" probes = **my own overlapping worker
      restarts**, not a worker bug.
- [x] Installer chain: `build-zxp.ps1` + **`sign-zxp.ps1` (self-signed dev cert via
      Adobe ZXPSignCmd 4.1.3, offline, `Signature verified successfully`, META-INF present)** ·
      `install-zxp`/`uninstall-zxp`/`start-worker`. Unsigned `.zxp` is rejected by installer
      apps ("was not installed") — signing fixed that route.
- [x] **Docs restructured** (this session): repo-root `README.md`; `docs/` hub +
      new **MODELS.md**, **API.md**, **DEVELOPMENT.md**; USAGE/INSTALLATION/DISTRIBUTION/
      REBUILD_PLAN/MEMORY updated; all 30 `.md` local links verified.
- [x] **Timebase fixed (2026-09-06, from live self-test `fps:0`).** `Sequence.timebase`
      is ticks-per-FRAME as a string (`"10594584000"` @23.976), not seconds — old code did
      `ticks * tb` and `fps = 1/tb`. Now: `TICKS_PER_SECOND = 254016000000`,
      `ticksToSec = ticks/TICKS`, `env.fps` real (≈23.98), `env.ticksPerFrame` raw.
      Markers/inserts were never affected (native `secondsToTicks`); only displayed
      fps/durations were wrong. Mock mirrors real timebase; env test asserts fps=30.
- [x] **Live-log bug fixed (2026-09-06): `insertSound → imported but could not locate`.**
      Root cause: project-tree walks used `kids.numChildren` — real Premiere
      `ProjectItemCollection` exposes **`numItems`**, so `findById`/`opImportFile` never
      iterated (broke `importFile` locate, `mediaPath`, `insertClip` by nodeId). The VM harness
      mock encoded the same wrong property, hiding it — mock now uses `numItems` + a nested
      bin, with regression tests. Bonus: `mkErr` now takes `$.line`, so host errors report the
      real throw-site line instead of every error claiming the `mkErr` definition line.
      Tests: `tests/host.test.mjs` **22/22** (new tests verified to FAIL on pre-fix code).
- [x] **Renamed display name Aimeva → AIMeva** (panel title/menu/BundleName, installer
      banners, worker `/health` name + AI persona, docs). Stable IDs untouched: bundle id
      `com.aimeva.cep`, folder names, `%TEMP%\aimeva-host.log`, repo/URLs, `AIMEVA` JS namespace.
- [x] **Scene dropdown empty → fixed.** Root cause: models load once at panel boot; if the worker
      was offline then, the select stayed empty forever (+ dup-append bug on refresh). Now:
      options cleared before populate, default `ollama:qwen3-vl:2b` fallback also on load
      failure, and Find-highlights self-heals (reloads models if dropdown empty). Tab switches
      refresh the Sequence/env summary.
- [x] **Pro UI redesign, brand `#ff7700`.** New dark theme (orange primary/ghost buttons, focus
      rings, pills, status bar), header uses project `icons/icon-48.png` + favicon, manifest
      declares `<Icons><Default>./icons/icon-48.png</Default></Icons>`. All JS-referenced
      class names / `--vars` preserved; `node --check` clean, host tests 22/22.
- [x] **Panel GET broken → fixed (2026-09-06, `models: Failed to execute 'fetch'`).**
      `worker.js call()` attached a JSON body to GET requests — fetch throws
      `Request with GET/HEAD method cannot have body`. Killed models grid, agents, MCP tools
      (health dot worked because it uses its own GET). Now body only on POST; VM tests load
      the real `worker.js` with a stubbed fetch (GET = no body, POST = JSON body).
- [x] **Selection false-positive → fixed (2026-09-06).** `selectedClipInfo` assumed
      `{numItems, getTrackItem()}` but Premiere returns a plain Array → always "not
      selected". Accepts both shapes; `requireClip` message now appends the host's
      underlying `[host: ...]` reason. Harness covers both selection shapes.
- [x] Commits `38d67ff` (rebuild) + `7d31922` (docs restructure) pushed to
      `kuldeep7ke/aimeva` **master**.

### Uncommitted work
- [x] All of the above committed as `39ac395` and pushed to `master`; system install
      refreshed (elevated robocopy, all markers verified in
      `C:\Program Files\Common Files\Adobe\CEP\extensions\com.aimeva.cep`).

### Open risks & next steps
- [ ] **Acceptance gate:** run Settings → **Self Test** inside real Premiere Pro 2023
      (needed before the panel is trusted in production use).
- [ ] Real Foley/ambience engine (currently local synth) — MMAudio/WaveSpeed/ThinkSound.
- [ ] Async job queue for slow CPU vision.
- [ ] Panel polish: streaming chat UI, progress on long vision calls.
- [ ] opencode models route = `available:false` until a free proxy is reachable; re-verify
      when network allows models.dev.

---

## 6. Conventions

- No code comments unless asked. Plaintext everywhere (no obfuscation).
- snake_case worker JSON; host envelope `{op, params}` → `{ok, data|error, line}`.
- Host errors carry `line`; every request logged to `%TEMP%\aimeva-host.log`.
- New endpoints → update `GET /` list + `docs/API.md` + (if model-related) `MODELS.md`.

---

## 7. Verification checklist

1. Python: `ai-workers\.venv\Scripts\python.exe -m py_compile ai-workers\ai_workers\*.py`,
   relaunch worker, `Invoke-RestMethod http://127.0.0.1:8000/health`.
2. Host: `node --test tests\host.test.mjs` (16). JS: `node --check extension\js\*.js`
   (`hostscript.jsx` will fail `--check` — it's ExtendScript; the VM harness validates it).
3. ZXP: `installer\build-zxp.ps1` (entries + manifest). Install: `installer\install-zxp.bat`.
4. Live Premiere: Settings → Self Test → read `%TEMP%\aimeva-host.log`.
5. Docs edits: re-run the local-link checker (all `](...)` targets must resolve).

---

## 8. Next-session handoff

1. Commit + push the current docs restructure (root README, MODELS/API/DEVELOPMENT,
   DOCS edits) to `master`.
2. Re-run verification checklist (§7) to confirm nothing regressed.
3. Live-Premiere Self Test → fix any real host op (`%TEMP%\aimeva-host.log` line numbers locate
   it) — this is the release-gating item.
4. Then: real sound engine → async vision queue → chat streaming UI.
5. If touching opencode discovery, keep the offline fallback and re-check
   `GET /opencode/models` (`catalog_models`, `provider_dirs`).