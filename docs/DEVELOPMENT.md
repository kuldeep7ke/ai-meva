# AIMeva — Development

Everything a developer needs: how the system is wired, how to run it, how to test, how to
build/package.

## 1. Architecture in one picture

```
Premiere Pro 2023+ (PPRO host)
└─ CEP panel (extension/ — com.aimeva.cep, CEP 11, Chromium/CEF)
   ├─ js/ui.js          tabs: Auto-Edit / Sound / Reframe / AI Lab / Settings
   ├─ js/worker.js      HTTP client for the FastAPI worker (127.0.0.1:8000)
   ├─ js/models.js      model registry client (GET /models + GET /opencode/models)
   ├─ js/updater.js     auto-update: plugin/update.json + plugin/models.json from GitHub
   ├─ js/host.js        host.dispatch(op, params) → evalScript
   └─ jsx/hostscript.jsx  STATELESS ExtendScript host — __host.dispatch(json)
              │          re-resolves app.project/activeSequence/nodeId per call,
              │          logs every op to %TEMP%\aimeva-host.log
              ▼
ai-workers/ (ai_workers package, FastAPI on 127.0.0.1:8000)
   index.py            routes + pydantic schemas + error envelope
   media.py            ffmpeg/ffprobe wrapper, probe, sample_frames, detect_scenes, temp files
   audio.py            numpy beats + silence (no external audio deps)
   llm.py              Ollama chat + vision, optional cloud
   opencode_model.py   models.dev catalog + provider configs + builtin fallback
   agents.py           5 async LLM agents
   mcp_server.py       built-in local-media MCP tools
   sound.py            local synth (pad + sub on the beat grid)
   reframe.py          preview render + cover-scale transform math
                │  ← Ollama (127.0.0.1:11434) · vendored ffmpeg (ai-workers/bin)
```

## 2. Prerequisites (dev machine)

Python 3.11+, Node 18+ (for `node --test` and `node --check`), ffmpeg optional (vendored),
Premiere Pro 2023+ for live host testing. Ollama optional but recommended.

## 3. Run the worker

```powershell
installer\start-worker.bat          # one-shot (launcher creates ai-workers\.venv on first run)
# or
ai-workers\.venv\Scripts\python.exe -m py_compile ai-workers\ai_workers\*.py   # sanity
powershell -ExecutionPolicy Bypass -File ai-workers\run-worker.ps1
```

Detached (survives the console + this tool):

```powershell
Start-Process powershell -ArgumentList `
  '-NoProfile -ExecutionPolicy Bypass -File "C:\...\ai-workers\run-worker.ps1"' -WindowStyle Hidden
```

> Gotchas learned the hard way: do **not** pipe uvicorn through `Tee-Object` and do **not** use
> `Start-Process -RedirectStandardOutput` for the worker — both break the detached process.
> Console capture that *does* work: `ai-workers\scratch\launch-worker-console.bat` logs into
> `scratch\worker-console.log`.

Smoke it:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
```

## 4. Run the tests

```powershell
cd tests; npm install        # empty deps, just locks
cd ..; node --test tests\host.test.mjs     # 16 tests
```

The harness runs `extension/jsx/hostscript.jsx` in a Node VM with a mocked Premiere object
graph and asserts the envelope behaviors: statelessness (ops keep working after the active
sequence is swapped), nodeId resolution, time/ticks conversion, manual-JSON fallback, clean
error envelopes, and a self-test dry run.

Syntax checks:

```powershell
node --check extension\js\*.js     # V8 check the panel JS
```

> `node --check` on `hostscript.jsx` is expected to **fail** — it's ExtendScript (not ES2015+);
> the VM harness is the real validator for it.

## 5. Install / uninstall the extension

```powershell
installer\install-zxp.bat      # stops Premiere → system CEP folder → enables CSXS debug keys
installer\uninstall-zxp.bat
```

On Premiere 2023 the **system** folder is the one that loads:
`C:\Program Files\Common Files\Adobe\CEP\extensions\com.aimeva.cep`.

## 6. Build the `.zxp`

```powershell
installer\build-zxp.ps1        # → installer\aimeva.zxp (verifies entries + CSXS\manifest.xml)
```

There is no compile step: `extension/` **is** the install source. `install-zxp.ps1` can install
either the folder or an unzipped `.zxp`.

> Manifest rules that must stay (breaking them = extension silently skipped):
> no default `xmlns` on `<ExtensionManifest>`; no `--v=0` CEF flag; `--enable-nodejs` +
> `--mixed-context`; CSXS 11; `Host Name="PPRO"` `[23.0,99.9]`.

## 7. Write a new worker endpoint

1. Add the pydantic schema + route in `ai-workers/ai_workers/index.py`.
2. Keep JSON **snake_case**; return the standard error envelope via `_err`.
3. Restart the worker (`installer\start-worker.bat`), smoke-test with
   `Invoke-RestMethod`.
4. Add the route to `GET /`'s endpoint list and to `API.md`.
5. Wire the panel call in `extension/js/<feature>.js`; keep host work behind one `dispatch`.

## 8. Edit the stateless host

- Host ops live in `extension/jsx/hostscript.jsx` behind `__host.dispatch`.
- Keep it **stateless**: resolve `app.project` / `activeSequence` / `nodeId` inside every op.
  Never store Premiere handles between calls (that's the bug class this rebuild killed:
  "`) does not have a value`" from the old R0..Rn ref table).
- Use only version-stable APIs: `project.createInsertionAtPlayheadForProjectItem`,
  `seq.insertClip(item, time, -1, 0)`, `seq.secondsToTicks`, `seq.markers.createMarker`,
  `item.getMediaPath()`, `importFiles([path], true, rootItem, false)`.
- Every op is try/caught; errors return `{ok:false, error, line}` and are logged to
  `%TEMP%\aimeva-host.log`.
- Update `tests/host.test.mjs` with a case for any new op (marker of success: test green +
  a real **Self Test** run in Premiere).

## 9. Auto-update & model registry changes

- Version bump → edit `plugin/update.json` (`version`, `notes`), merge on `master`, attach the
  rebuilt `installer\aimeva.zxp` to the GitHub **Latest release**.
- Model registry → edit `plugin/models.json`, merge on `master`; the panel pulls it on Update.
- See [DISTRIBUTION.md](DISTRIBUTION.md) for the full release flow.

## 10. Conventions

- No code comments unless asked; plaintext everywhere (no obfuscation).
- snake_case worker JSON; envelope is `{op, params}` → `{ok, data|null, error?, line?}`.
- Scratch/temp/preview files live in `ai-workers/scratch/` (worker-created, safe to delete).
- The worker never deletes user media (only scratch files).
- Git: don't commit `.venv`, `ai-workers/bin/*.exe*`, `scratch/`, `installer/dist/`,
  `*.zxp`, `ai-meva-plugin/`.