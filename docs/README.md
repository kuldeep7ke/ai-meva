# Aimeva

**Aimeva** is a free, open-source (MIT) **CEP extension for Adobe Premiere Pro 2023+** that
brings local and open AI-assisted editing right into your timeline:

- **Auto-Edit** — beat-synced cutting, silence detection/marking, and scene/highlight discovery
- **Sound** — generate a music bed / riser that snaps to your detected beat grid
- **Reframe** — smart aspect-ratio conversion (9:16, 1:1, 16:9, 21:9) with preview → apply
- **AI Lab** — chat with local LLMs (Ollama), describe clips with a vision model, run agents,
  and call media tools over **MCP**

Everything runs on your machine. There is **no backend, no license server, no sign-up, no
account** — and no encrypted code, files, or data. Every file in this repo is plain, readable,
and yours to fork.

**Model strategy:** local-first. The panel talks to a small FastAPI worker over
`127.0.0.1:8000`. Ollama powers chat + vision offline; **opencode free models** are
auto-discovered and listed (and auto-added to the panel) whenever they become usable for media
tasks.

---

## Repository layout

```
.
├── extension/          CEP 11 panel (HTML/JS/ExtendScript) — installed as com.aimeva.cep
│   ├── CSXS/           manifest.xml (Premiere Pro 23.0 – 99.9)
│   ├── jsx/            stateless ExtendScript host (__host.dispatch)
│   └── js/             panel logic, worker client, model registry, updater, UI
├── ai-workers/         Python FastAPI worker (beat/silence/scene/sound/reframe/chat/agents/MCP)
│   ├── ai_workers/     the importable package
│   └── bin/            vendored ffmpeg/ffprobe
├── plugin/             online manifests: models.json (model registry) + update.json (auto-update)
├── installer/          build-zxp.ps1, install-zxp, uninstall-zxp, start-worker
├── tests/              VM harness for the ExtendScript host (node --test)
└── docs/               README, INSTALLATION, USAGE, DISTRIBUTION, MEMORY
```

## Documentation

| Document | Audience | Contents |
|----------|----------|----------|
| **[Installation Guide](docs/INSTALLATION.md)** | Users / developers | Worker + extension install, prerequisites, troubleshooting |
| **[Usage Guide](docs/USAGE.md)** | End users | Auto-Edit, Sound, Reframe, AI Lab, models & auto-update |
| **[Distribution Guide](docs/DISTRIBUTION.md)** | Maintainers | Building/signing the `.zxp`, releases, auto-update mechanics |
| **[Memory Capsule](docs/MEMORY.md)** | Developers | Decisions, endpoints, status, conventions, next steps |
| **[Rebuild Plan](docs/REBUILD_PLAN.md)** | Developers | Why the stateless CEP rebuild exists (root causes + stages) |

## Quick start (Windows)

```powershell
# 1. Install the Premier Pro extension (stops Premiere, copies to the system CEP folder)
installer\install-zxp.bat            # or: installer\build-zxp.ps1 then install-zxp.ps1

# 2. Start the AI worker (creates the venv on first run)
installer\start-worker.bat

# 3. Open Premiere Pro 2023+ → Window → Extensions → Aimeva
```

Optional but recommended: install [Ollama](https://ollama.com) and pull a small model:

```powershell
ollama pull qwen3:4b        # chat / titles / summaries
ollama pull qwen3-vl:2b     # vision (clip descriptions) — slow on CPU-only machines
```

The panel's **Settings** tab shows an **Update** button that pulls `plugin/update.json` and
`plugin/models.json` from GitHub, so the extension and its model list self-update.

## Feature → worker endpoint

| Feature | Endpoint |
|---------|----------|
| Beat detection & silence | `POST /analyze/beats` (mode beats/mode silence) |
| Scene / highlight analysis | `POST /analyze/scene` (fast ffmpeg detection + optional vision) |
| Sound generation | `POST /sound/generate` |
| Reframe preview + transform | `POST /reframe` |
| Model registry (curated + Ollama + opencode) | `GET /models` |
| Chat / describe clips | `POST /chat` |
| Agents | `GET /agents` / `POST /agents/run` |
| MCP tools | `GET /mcp/list` / `POST /mcp/call` |
| opencode free-model discovery | `GET /opencode/models` |
| Liveness | `GET /health` |

## Why open source + local-first?

- **Zero account friction** — install, open, work.
- **Privacy** — footage and prompts stay on your disk.
- **Auditability** — no obfuscation; every behavior is in the repo.
- **Auto-updatable** — version + model manifests are plain JSON served from this repo's
  `master` branch; the panel fetches them at runtime.

## License

MIT — see [LICENSE](LICENSE).