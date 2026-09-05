# AIMeva — Installation Guide

Install and run **AIMeva** for Premiere Pro. Two pieces:

1. **AI worker** (Python + optional Ollama) — does the heavy lifting
2. **CEP extension** (`com.aimeva.cep`) — the panel inside Premiere Pro

> Time: ~10 minutes. No backend, no database, no license server.

---

## 1. Prerequisites

| Tool | Notes |
|------|-------|
| Premiere Pro | **2023 (v23.0) or newer** (CEP 11) |
| Python | 3.11+ (64-bit). A real install, not the Microsoft Store alias. |
| Ollama | Optional but recommended. `ollama --version` |
| FFmpeg / FFprobe | Optional — vendored copies ship in `ai-workers/bin/` |

> **Premiere 2023 note:** this machine's Premiere loads CEP extensions only from the **system**
> folder `C:\Program Files\Common Files\Adobe\CEP\extensions\`. `install-zxp.bat` targets that
> folder automatically (accept the UAC prompt). If you copy manually, use the system path —
> `%APPDATA%\Adobe\CEP\extensions\` is used only as a fallback.

---

## 2. Install the extension

```powershell
installer\install-zxp.bat
```

What it does:

1. Stops Premiere (so installed files aren't locked).
2. Copies `extension/` into the system CEP extensions folder (UAC prompt).
3. Enables CEP debug mode for CSXS 9–14 (`PlayerDebugMode`, `LogLevel`).

To install from a built `.zxp` instead of a bare folder:

```powershell
installer\build-zxp.ps1          # packages extension/ → installer\dist\aimeva.zxp
installer\install-zxp.ps1        # extract + install
```

Uninstall:

```powershell
installer\uninstall-zxp.bat      # removes system + per-user copies, clears debug keys
```

---

## 3. Start the AI worker

```powershell
installer\start-worker.bat
```

or manually:

```powershell
powershell -ExecutionPolicy Bypass -File ai-workers\run-worker.ps1
```

The script creates `ai-workers\.venv` on first run (installing the package + deps), wires the
vendored `bin\ffmpeg` onto PATH, and serves `http://127.0.0.1:8000`. Verify:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
# {"ok":true,...,"ffmpeg":true,"ollama":...}
```

If you want the worker to survive closing the terminal, right-click `installer\start-worker.bat`
→ *Run as administrator* is not required; instead pin/start it, or install it as a scheduled task.

---

## 4. Install Ollama models (recommended)

See **[MODELS.md](MODELS.md)** for the full model strategy (curated registry, opencode free
models, offline/online rules). Minimum to get value:

```powershell
ollama pull qwen3:4b        # chat / titles / autocut plans
ollama pull qwen3-vl:2b     # vision: describe clips, scene summaries
```

The panel's **Settings** tab lists installed models, Ollama-installed models, and opencode free
models (`GET /models` + `GET /opencode/models` on the worker) — no config files to edit.

> **Vision speed:** on CPU-only machines, qwen3-vl:2b can take many minutes per clip. Scene
> *highlight* detection doesn't need a vision model at all (it uses ffmpeg scene-change
> detection and returns instantly); use the model only when you want a natural-language
> summary/captions.

---

## 5. Use it in Premiere

1. Start Premiere Pro 2023+.
2. **Window → Extensions → AIMeva.**
3. Open a project with an active sequence.

Every operation prints a proof trail to `%TEMP%\aimeva-host.log` (Premiere-side) and the panel
shows live status. The **Self Test** button on the Settings tab runs the full host op list
(ping, selection, markers, import, insert) inside real Premiere and reports pass/fail per step.

---

## 6. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| No "AIMeva" under Window → Extensions | Installed to `%APPDATA%` (Premiere 2023 scans system folder only) | Re-run `install-zxp.bat`, accept UAC, fully quit Premiere + Creative Cloud (`kill CEPHtmlEngine`), relaunch |
| Panel opens but host ops fail | Stale `hostscript.jsx` or debug flag off | Reinstall; check `%TEMP%\aimeva-host.log`; verify `PlayerDebugMode=1` under `HKCU\Software\Adobe\CSXS.11` |
| Worker `ffmpeg:false` in `/health` | Vendored binaries missing | Re-check `ai-workers/bin/`; ensure PATH resolves |
| `ollama` not reachable | Ollama not running / not installed | Start Ollama, `ollama pull qwen3:4b`, refresh panel |
| Vision takes forever / read timeout | CPU-only inference of qwen3-vl:2b | Use smaller images (panel caps at 256px), fewer frames, or a GPU; highlight detection itself is instant |
| Auto-cut "malformed host response ... EvalScript error" | Old cached CEP build | `uninstall-zxp.bat` then `install-zxp.bat`, fully quit Premiere + `CEPHtmlEngine` processes |

---

## 7. What you get out of the box

- Beat detection + beat-synced auto-cut (numpy-only, 16 kHz, no external audio deps)
- Silence marking (bottom-up noise floor, gap-aware)
- Scene/highlight candidates (ffmpeg, instant) + optional vision summary
- Sound generation (local synth bed on the detected grid; replaceable engine)
- Reframe preview + apply (cover-crop with correct Motion-scale math)
- Chat / describe / agents / MCP against Ollama + opencode free models
- Auto-update of both the extension and the model registry from GitHub