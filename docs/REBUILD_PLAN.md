# AI Meva — Rebuild Plan: CEP-only, ZXP-installed, stateless host (PP 2023)

> ## Status — 2026-09-05 (implemented)
>
> The rebuild described below is **done**: CEP-only product `com.aimeva.cep`, stateless
> `__host.dispatch` host, `extension/` panel + `ai-workers/` FastAPI worker, `plugin/`
> online manifests, `installer/` scripts, `tests/host.test.mjs` 16/16. Scope decisions (§4):
> CEP-only (UXP frozen), self-signed/dev install route, **no backend or licensing** (now free &
> open-source, per product direction), markers-first silence, single repo package source
> (`extension/`). Live worker endpoints verified; the remaining acceptance gate is running the
> panel's Settings → **Self Test** inside real Premiere Pro 2023 (see `MEMORY.md` §5).

## 0. Why we rebuild (root causes of the current failures)

The current CEP host (`hostscript.jsx`) uses a **micro-RPC bridge**: `roots` captures live Premiere C++ handles into a ref table (`R0…Rn`), and every later `exec R4,getAudioTrackCount` dereferences that cached handle. Real Premiere invalidates those wrappers (sequence switches, project ops), so member calls on a stale handle throw the exact error we keep seeing: `) does not have a value`. The VM harness gives every object a permanent lifetime, so the tests could never reproduce it — 28/28 green, yet real PPRO fails.

A second, hidden blocker: **`ai-meva-plugin/` is a UXP plugin** (`manifest.json`, `.ccx` installer in `installer/`). **Premiere Pro 23.x has no UXP support** — UXP for Premiere arrived in v25.6+. Any `.ccx`/UDT install path can never load on PPRO 2023. The only surface that works on 2023 is **CEP** (`.zxp`). This repo currently ships both, which muddies what "the plugin" is.

**The rebuild kills both problems:**
1. CEP becomes the one and only product (UXP deferred to a future v25.6+ build).
2. The hand-rolled ref-holding bridge is replaced by a **stateless JSON dispatch**: one entry point, no cached handles, fresh resolution from `app.project` on every command, stable `nodeId` identifiers, full flows executed inside a single atomic host call.

---

## 1. Target architecture

```
┌──────────────────────────── CEP panel (Chromium 99, CEP 11 ────────────────┐
│  index.html  │  UI (three tabs: Auto-Edit / Sound / Reframe — keep views) │
│  services/   │  worker HTTP calls: /analyze/beats, /analyze/scene,        │
│              │  /sound/generate, /reframe  (PROVEN — unchanged)           │
│  host/       │  NEW thin relay: host.dispatch({op, params}) → evalScript  │
└──────────────────────────────────────┬────────────────────────────────────┘
                                       │  evalScript("__host.dispatch(<json>)")
┌──────────────────────────────────────▼────────────────────────────────────┐
│  hostscript.jsx — STATELESS CEP host (the core rewrite)                   │
│  • NEVER keeps object refs between calls. Every op begins with:           │
│      prj = app.project; seq = prj.activeSequence; tb = seq.timebase;      │
│      playhead = seq.getPlayerPosition().seconds                           │
│  • Identifies project items by ProjectItem.nodeId (stable GUID),          │
│    re-resolved per command by a children walk. No R0..Rn table.           │
│  • Ops: ping / env / selectedClip / mediaPath(nodeId) / importFile(path)  │
│         / addMarkers(times[]) / insertClip(nodeId,sec,audioOnly)          │
│         / autoCut(plan) / applySilencePlan(regions) / soundInsert(path,   │
│         sec) / applyReframe(nodeId, transform)                            │
│  • Whole flows (auto-cut, silence) run inside ONE dispatch — the panel    │
│    calls the worker over HTTP first, then sends the computed plan.        │
│  • Envelope: {ok:true,data} | {ok:false,error,line}; every op try/caught; │
│    writes aimeva-host.log (proof trail).                                  │
└────────────────────────────────────────────────────────────────────────────┘
   All external AI execution remains: FastAPI worker (ai-workers) + Ollama.
```

**Why this is different and removes the failure class:**
- No `roots`/ref cache → no stale-handle `does not have a value`.
- `nodeId` instead of index refs → identity survives renames/order changes, re-resolution is always fresh.
- Whole operations per call → no cross-call coordination state, no half-applied edits.
- Every error carries host file:line → any future real-PPRO issue is self-locating (and lands in the log file).

---

## 2. What stays, what goes

| Area | Decision |
|---|---|
| AI worker + Ollama (`ai-workers/`, endpoints) | **Keep as-is** — live-verified (beats 5×, silence, reframe 12×, sound 3×, scene qwen3-vl:2b) |
| UI panels + service calls to worker (`ai-meva-plugin/src/panels`, `services/`) | **Keep, re-plumb** their Premiere-access layer onto the new `host.dispatch` API |
| `cep-extension/src/js/{remote,bridge,clips-cep,premiere-access-cep,timeline-cep}.js` | **Replace** with `host/host.js` (single dispatch) + tiny adapters |
| `cep-extension/src/jsx/hostscript.jsx` | **Rewrite** (stateless, `__host.dispatch`) |
| `cep-extension/build/assemble.js`, `build-zxp.ps1`, `tools/ZXPSignCmd.exe`, dev certs | **Keep** — converge the “shared plugin sources” so `cep-extension` is the single package source |
| `ai-meva-plugin/manifest.json` (UXP) + `installer/*.ccx` | **Freeze/remove from product flow** — cannot run on PPRO 23.x; park for a future v25.6+ port |
| `backend/` (license) | Keep, unchanged |

---

## 3. Build stages (each independently shippable)

### Stage 1 — Stateless host rewrite (`hostscript.jsx`)
- Single global `var __host = (function(){…})()` exposing only `__host.dispatch(json)` (keeps the proven file-scope `var` trick already in place).
- `resolveEnv()` read fresh every call; `resolveNodeId(nodeId)` = iterative walk of `rootItem.children` (bins → clips), matching `String(item.nodeId)`.
- `jsonIn`/`jsonOut` using native `JSON` when present with the existing `manualJson` fallback (keep — proven against real PPRO).
- Ops implemented with only the **well-known, version-stable** PPRO APIs:
  - selection: `seq.getSelection()` → `.projectItem`; empty → playhead-overlap fallback (reuse logic, now guarded)
  - markers: `seq.secondsToTicks(sec)` → `seq.markers.createMarker(tickTime)`
  - insert: `project.createInsertionAtPlayheadForProjectItem(item, audioOnly, false)`; fallback `seq.insertClip(item, time, -1, 0)`
  - import: `project.importFiles([path], true, rootItem, false)` → find item by basename → return its `nodeId`
  - media path: `item.getMediaPath()`
- Docker-style try/catch per op; log every request+result+error (with line) to `%TEMP%\aimeva-host.log`.

### Stage 2 — New client relay + adapters
- `host.js`: `dispatch(op, params)` builds `{op, params}`, `JSON.stringify`, `evalScript("__host.dispatch(" + json + ")", cb)`, parses envelope, surfaces `error` + `line` verbatim in the UI.
- Adapters (`PremiereAccess`, `Clips`, `TimelineOps`) become thin wrappers over `dispatch` — the existing services/views keep their call signatures, so the UI and the whole worker plumbing don’t move.
- `autoCut(plan)` and silence: panel does worker HTTP → host does markers+inserts in one dispatch.

### Stage 3 — ZXP packaging (PP 2023)
- **Manifest** (`CSXS/manifest.xml`): keep `Host Name="PPRO"`, tighten `Version="[23.0,24.0)"`, keep `RequiredRuntime CSXS 11.0` (CEP 11 = PPRO 23.x), keep `--enable-nodejs` + `--mixed-context`, bump bundle version.
- **Build**: `build-zxp.ps1` reuse — `assemble.js` → dist → `ZXPSignCmd -sign dist dist\com.aimeva.cep.zxp aimeva-dev.p12 aimeva`. Refresh the post-build verification checks to the new markers (`__host.dispatch`, `nodeId`, host-log), keep archive-entry + archived-manifest checks, add `ZXPSignCmd -verify` output capture.
- **Installers** (this is the “zxp format installer” you asked for):
  - `install-zxp.bat` / `.ps1`: stops Premiere → extracts the `.zxp` (it’s a ZIP) into the **system** CEP extensions folder used on this machine (`C:\Program Files\Common Files\Adobe\CEP\extensions\com.aimeva.cep`) and mirrors per-user as fallback → clears stale copies → (dev mode) sets `HKCU\Software\Adobe\CSXS.11\PlayerDebugMode=1` → reports the exact Window→Extensions menu entry.
  - `uninstall-zxp.bat`/`.ps1`: removes both copies + resets the debug flag.
  - `verify-install.ps1`: runs our existing **VM harness against the installed copy** (`jsx/hostscript.jsx` + `js/client.js`) so we *prove* the installed artifact matches the tested build (this is what burned us before — stale installs).
  - Docs map double-click/ExMan to **UXP Developer Tool “Add CEP extension”** (the official modern route for `.zxp`) and note ExMan’s documented `-193` limitation on CC2023 apps.
  - **Signing reality**: self-signed dev cert (`aimeva-dev.p12`) is correct for local/internal installs; public distribution requires an Adobe cross-signed certificate — flagged as a release gate, not a dev blocker.

### Stage 4 — Proof / verification (the “proof plan”)
1. **Automated net** (extend `tests/`): every new op unit-tested against the VM host + realistic PPRO mock (`node --test`, deterministic), PLUS the live-worker suite (`AIMEVA_LIVE=1`) drives the real client bundle → real FastAPI → real host. Both must be 100% before packaging.
2. **Artifact proof**: `build-zxp.ps1` verifies entries, archived manifest, markers, and captures `ZXPSignCmd -verify` → recorded in the build output.
3. **Real-Premiere self-test** (the key innovation): a “Self Test” button in the panel runs the entire op list in sequence and writes each step’s OK/FAIL + line to `%TEMP%\aimeva-host.log`:
   `ping → env → selectedClip → mediaPath(nodeId) → addMarkers([playhead]) → importFile(probe.wav) → insertClip → autoCut(dry-run) → applySilencePlan(dry)`.
   You run it once in real PPRO 2023; I read the log and we have *proof* of every host interaction on your exact machine — no guessing.
4. **Acceptance checklist** per feature on PPRO 23.x (auto-cut markers+inserts correct at beats; silence markers at gap; reframe 720p preview file + apply; sound generate→real WAV→insert; license gates).
5. **Regression**: `tests/` kept green after every stage; installer verifies installed copy.

---

## 4. Scope decisions to confirm before building

1. **Panel stack**: keep the current HTML/CSS/JS views (recommended — least churn) vs rewrite in a framework. Recommended: keep, only re-plumb the host layer.
2. **Repo consolidation**: `cep-extension` becomes the one package source; UXP plugin + `.ccx` installer frozen (not deleted). OK?
3. **Cert**: proceed with self-signed `aimeva-dev` for the .zxp now (works locally), note Adobe-signed cert as the release gate. OK?
4. **Silence removal**: v1 = markers + optional “remove gaps & ripple” via track split, since PPRO has no native ripple API; confirm markers-first is acceptable.

## 5. Delivery order
Stage 1 (host rewrite) → tests → Stage 2 (adapters) → Stage 3 (zxp + installers + verify-install) → Stage 4 proof → hand to you for the one-button self-test in PPRO.