# Aimeva

A **free, open-source (MIT)** AI editing assistant for **Adobe Premiere Pro 2023+**, shipped as a
CEP extension (`com.aimeva.cep`). Everything runs locally — no accounts, no backend, no license
server, and no encrypted code, files, or data.

- **Auto-Edit** — beat-synced cuts, silence marking, scene/highlight detection
- **Sound** — grid-synced music bed / riser generation
- **Reframe** — smart 9:16 / 1:1 / 16:9 / 21:9 conversion with preview → apply
- **AI Lab** — chat + clip descriptions with local Ollama models, agents, and MCP media tools;
  opencode free models are auto-discovered and auto-added when available
- **Auto-update** — the panel pulls `version` + model manifests from this repo at runtime

## Quick start

```powershell
installer\install-zxp.bat     # install the CEP extension (stops Premiere, prompts for admin)
installer\start-worker.bat    # launch the local AI worker on 127.0.0.1:8000
# open Premiere Pro → Window → Extensions → Aimeva
```

Requirements: Premiere Pro 2023+, Python 3.11+. Optional: [Ollama](https://ollama.com) + `ollama pull qwen3:4b` for chat.

## Documentation

| Where | What |
|-------|------|
| [docs/README.md](docs/README.md) | Documentation home & navigation |
| [docs/INSTALLATION.md](docs/INSTALLATION.md) | Install the worker + extension, prerequisites, troubleshooting |
| [docs/USAGE.md](docs/USAGE.md) | Using the panel (Auto-Edit / Sound / Reframe / AI Lab) |
| [docs/MODELS.md](docs/MODELS.md) | Model strategy: curated registry, Ollama, opencode free models |
| [docs/API.md](docs/API.md) | Worker HTTP API + host dispatch reference |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Architecture, dev loop, testing, conventions |
| [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md) | Building/signing `.zxp`, releases, auto-update mechanics |
| [docs/REBUILD_PLAN.md](docs/REBUILD_PLAN.md) | Why the stateless CEP rebuild exists (historical) |
| [docs/MEMORY.md](docs/MEMORY.md) | Developer memory capsule (decisions, status, next steps) |

## Repo layout

```
extension/        CEP panel + stateless ExtendScript host (installed as com.aimeva.cep)
ai-workers/       FastAPI worker (beats, scene, sound, reframe, chat, agents, MCP)
plugin/           Online manifests: models.json (registry) + update.json (auto-update)
installer/        build-zxp.ps1, install/uninstall, start-worker
tests/            host.test.mjs (16 VM tests for the ExtendScript host)
docs/             All guides
```

## License

MIT — see [LICENSE](LICENSE).