# Aimeva — Usage Guide

Open the panel via **Window → Extensions → Aimeva**. Tabs: **Auto-Edit**, **Sound**,
**Reframe**, **AI Lab**, **Settings**.

Before anything: a **project must be open** with an **active sequence**, and the **AI worker**
must be running (`installer\start-worker.bat`, port 8000). The panel shows a red banner if the
worker is offline.

---

## 1. Auto-Edit

### 1.1 Beat-synced auto-cut

1. Put footage on the timeline (video + music tracks).
2. Set **Intensity** (1–5; higher cuts more of the grid) and optional **Offset (ms)**.
3. Press **Detect Beats & Cut**.

The worker computes BPM + a beat grid from the selected audio (`POST /analyze/beats`); the host
adds a marker and an insert at each cut in a **single atomic call**. Status reports
`Done — N cuts applied (BPM ~x)`.

> Tip: start with Intensity 2–3. Offsets push cuts early/late relative to the beat.
> Cut markers are standard timeline markers (Sequence → Edit Timeline → Markers).

### 1.2 Silence marking

Switch mode to **Silence** and press **Analyze**. The worker finds energy dips below a noise
floor for ≥ `min_gap` seconds and the host **marks** each region. Current build marks for review
rather than ripple-deleting (no native ripple API for this in CEP); trim manually or use the
markers as a guide.

### 1.3 Scene / highlights

Press **Detect Highlights**. Two layers:

- **Instant:** ffmpeg scene-change detection returns highlight candidates immediately (no model).
- **Optional vision:** if an Ollama vision model is installed, the worker samples frames and
  asks the model for captions + a summary. CPU-only machines: expect minutes; the instant layer
  already works without it.

---

## 2. Sound

1. (Optional) type a prompt, e.g. `dark riser`.
2. Set **Duration (s)** and, if known, **BPM** — the generator snaps to your beat grid.
3. Press **Generate** → worker writes a `.wav` into its scratch dir (`POST /sound/generate`).
4. Press **Insert to Timeline** → host places it as a clip.

> Current engine is a **local synth** (pad + sub on the beat grid) so the whole pipeline is
> verifiable offline. The cloud/Foley engines are a documented next step (see MEMORY.md).

---

## 3. Reframe

1. Pick **Ratio** (9:16, 1:1, 16:9, 21:9) and **Method** (smart-crop / edge-extension /
   subject-tracking stub).
2. Press **Preview** → worker renders a low-res preview (`POST /reframe`).
3. Review, then **Apply** → host sets Motion **Scale** on the selected clip using the exact
   cover-zoom factor the preview computed (e.g. 16:9 → 9:16 ≈ 177.8%). Position stays centered.

---

## 4. AI Lab

- **Chat** — pick a task (title, captions, rewrite, script) or free prompt; runs any Ollama model.
- **Describe** — vision model summarizes the selected clip and suggests captions.
- **Agents** — assistant / autocut / sound / title / editor agents (`GET /agents`, run via
  `POST /agents/run`).
- **MCP** — built-in `local-media` tools (`probe_media`, `extract_audio`) callable from any
  MCP-capable host (`GET /mcp/list`, `POST /mcp/call`).

### Models

The **Settings** tab merges three sources: the curated registry (`plugin/models.json`), your
live Ollama install, and opencode free models — see **[MODELS.md](MODELS.md)** for the full
strategy, pull commands, and what's offline vs. online. Check **Tools → reset/refresh** or the
panel Update button to re-scan.

---

## 5. Settings & auto-update

- **Update** — fetches `plugin/update.json` + `plugin/models.json` from GitHub (`raw`,
  `master`). If the remote version differs from the local, it tells you how to install (the ZXP
  binary comes from the GitHub **release** `latest/download/aimeva.zxp`).
- **Self Test** — runs every host op inside live Premiere and writes OK/FAIL + file:line to
  `%TEMP%\aimeva-host.log`.

---

## 6. Status messages

| Message | Meaning |
|---------|---------|
| `Analyzing audio for beats...` | Worker computing BPM/grid |
| `No beats detected in audio` | Too quiet/ambient; lower intensity or pick clearer music |
| `Done — N cuts applied (BPM ~x)` | Success |
| `Worker offline (port 8000)` | Start `installer\start-worker.bat` |
| `Premiere Pro API unavailable` | Not running inside Premiere / debug flag off |
| `vision model unavailable (...)` | No usable vision model; instant scene detection still returned |
| `(host) error at line N` | Any host op failure — includes the exact hostscript line |

---

## 7. Notes

- No global hotkeys — everything is panel-driven.
- All marker ops are destructive-capable but reversible with **Undo (Ctrl+Z)**.
- Preview-before-apply applies to Reframe; Auto-Edit & Sound are `run → review → undo-ish` flows
  today.