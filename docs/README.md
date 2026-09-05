# Aimeva — Documentation

> Repo root: [`../README.md`](../README.md) — this folder is the full documentation site.

Aimeva is a free, open-source (MIT) CEP extension for Adobe Premiere Pro 2023+ with a
local-first AI worker. No backend, no accounts, no license server, no encrypted files.

## Repository layout

```
.
├── extension/          CEP 11 panel + stateless ExtendScript host — installed as com.aimeva.cep
│   ├── CSXS/           manifest.xml (Premiere Pro 23.0 – 99.9, CEP 11)
│   ├── jsx/            hostscript.jsx — __host.dispatch(json), no cached handles
│   └── js/             panel logic, worker client, model registry, updater, UI
├── ai-workers/         Python FastAPI worker (beats/silence/scene/sound/reframe/chat/agents/MCP)
│   ├── ai_workers/     the importable package
│   └── bin/            vendored ffmpeg/ffprobe (gitignored)
├── plugin/             online manifests: models.json (registry) + update.json (auto-update)
├── installer/          build-zxp.ps1, install-zxp(.bat|.ps1), uninstall-zxp, start-worker.bat
├── tests/              host.test.mjs — VM harness, node --test (16 tests)
└── docs/               ← this folder
```

## Guides

| Document | Audience | Contents |
|----------|----------|----------|
| **[Installation Guide](INSTALLATION.md)** | Users / developers | Install the extension + worker, prerequisites, troubleshooting |
| **[Usage Guide](USAGE.md)** | End users | Auto-Edit, Sound, Reframe, AI Lab tabs |
| **[Models](MODELS.md)** | Users / maintainers | Curated registry, Ollama, opencode free models, offline/online rules |
| **[API Reference](API.md)** | Developers | Every worker HTTP endpoint + the host `dispatch` envelope |
| **[Development](DEVELOPMENT.md)** | Developers | Architecture, dev loop, testing, build, conventions |
| **[Distribution Guide](DISTRIBUTION.md)** | Maintainers | Building/signing `.zxp`, GitHub releases, auto-update mechanics |
| **[Rebuild Plan](REBUILD_PLAN.md)** | Developers | Historical: why the stateless CEP rebuild exists (root causes + stages) |
| **[Memory Capsule](MEMORY.md)** | Developers | Session memory: decisions, status, conventions, next steps |

## Reading order

1. **Install it** — `INSTALLATION.md`
2. **Use it** — `USAGE.md`
3. **Choose models** — `MODELS.md`
4. **Extend it** — `API.md` → `DEVELOPMENT.md` → `DISTRIBUTION.md`

## Quick reference

```powershell
installer\install-zxp.bat     # install into the system CEP folder (Premiere stopped, UAC prompt)
installer\start-worker.bat    # AI worker on 127.0.0.1:8000 (creates ai-workers\.venv on first run)
# Premiere Pro 2023+ → Window → Extensions → Aimeva
```

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
# {"ok":true,"name":"Aimeva Worker","version":"0.1.0","ffmpeg":true,"ollama":...}
```