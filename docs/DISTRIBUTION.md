# Aimeva — Distribution Guide

How to build, sign, install, and publish the **Aimeva** CEP extension (`.zxp`), plus how its
**auto-update** and **model auto-add** mechanics work.

## 1. Build the `.zxp`

```powershell
installer\build-zxp.ps1
```

Produces `installer\dist\aimeva.zxp` (a ZIP with `CSXS/manifest.xml` at the root). The script
verifies archive entries and the archived manifest before/after.

> The CEP manifest targets **Premiere Pro 23.0 – 99.9**, CEP 11, bundle id `com.aimeva.cep`,
> with `--enable-nodejs` + `--mixed-context`. Do **not** re-add a default `xmlns` to the
> manifest root or a `--v=0` CEF flag — both make Premiere silently skip the extension.

## 2. Install / uninstall

- `installer\install-zxp.bat` — stops Premiere, copies `extension/` into the **system** CEP
  folder (`C:\Program Files\Common Files\Adobe\CEP\extensions\com.aimeva.cep`) with per-user
  fallback, enables CSXS debug mode, verifies the manifest is present.
- `installer\uninstall-zxp.bat` — removes system + per-user copies, clears debug keys.
- From a built `.zxp`: unzip it into that same system folder (the `.zxp` is a plain ZIP).

### Signing

Development/local installs work **unsigned** or with the self-signed `aimeva-dev` cert flow
described in the old plan. For public distribution, sign with an **Adobe cross-signed
certificate** (or keep shipping the raw folder) — see `docs/REBUILD_PLAN.md` Stage 3 for the
release-gate note.

## 3. Auto-update (how it works)

`extension/js/updater.js` runs on load and on demand:

1. `GET plugin/update.json` from `raw.githubusercontent.com/kuldeep7ke/aimeva/master/plugin/update.json`
   → contains `version`, `zxp_url`, `update_url`, `models_url`.
2. If the remote `version` > local `version`, the panel shows an update prompt and points to the
   GitHub **release** artifact (`github.com/kuldeep7ke/aimeva/releases/latest/download/aimeva.zxp`).
3. The **model registry** is refreshed from `plugin/models.json` (curated defaults).

To publish a release: bump `plugin/update.json` version → run `installer\build-zxp.ps1` → attach
`installer\dist\aimeva.zxp` to a GitHub Release tagged so `latest` resolves (release name
`latest` or by default Latest release). Keep `plugin/*.json` merged on `master` before tagging.

## 4. Model registry & opencode free models

- `plugin/models.json` — curated list (Ollama families by task + opencode free candidates with
  a `opencode_media_task_keywords` block the worker uses to decide what's "useful for media").
- The worker merges curated + live `ollama` tags + `GET /opencode/models` results. opencode
  discovery reads `models.dev` catalog when reachable, falls back to the builtin candidate list
  (marked `catalog_source: builtin-fallback`), and unions your opencode `auth.json` provider
  keys so only providers you actually have are surfaced.
- The panel **auto-adds** surfaced opencode models to its dropdown the moment they appear — no
  reinstall needed, just **Settings → refresh/Update**.

## 5. Repo hygiene

- Build artifacts are gitignored (`extension` is the *source*; the installed copy is copied
  straight from `extension/` by the installer, no compile step).
- `plugin/update.json` and `plugin/models.json` are the *only* online-state files the panel
  reads — they must stay in sync with `master` and the release tag.
- Add `ai-workers/bin/` to `.gitignore` (large FFmpeg binaries) or distribute the worker via
  `pip install -e ai-workers` on the user's machine (the launcher auto-creates the venv).

## 6. Troubleshooting

| Symptom | Fix |
|---------|-----|
| Extension doesn't appear under Window → Extensions | Reinstall to the **system** folder; kill `CEPHtmlEngine` + fully quit Premiere; check `PlayerDebugMode` |
| Update fetches new version but never prompts | Ensure `plugin/update.json` reachable at the raw `master` URL and `version` bumped |
| opencode models list empty | No internet (keep builtin fallback) or no providers in `~/.local/share/opencode/auth.json`; run `GET /opencode/models` on the worker to see `provider_dirs`/`catalog_models` |
| `.zxp` rejected by installer | Use `installer\install-zxp.bat` (folder copy) instead; ExMan-based routes are broken on Premiere 2023 on some machines