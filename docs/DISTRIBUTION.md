# AIMeva — Distribution Guide

How to build, sign, install, and publish the **AIMeva** CEP extension (`.zxp`), plus how its
**auto-update** and **model auto-add** mechanics work.

## 1. Build the `.zxp`

See **[DEVELOPMENT.md](DEVELOPMENT.md)** for the run/test loop; the packaging step itself:

```powershell
installer\build-zxp.ps1
```

Produces `installer\aimeva.zxp` (a ZIP with `CSXS/manifest.xml` at the root; staged first in
`installer\dist\`). The script verifies archive entries and the archived manifest before/after.

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

`build-zxp.ps1` alone produces an **unsigned** package. Third-party installer apps
(Anastasiya's ZXP/UXP Installer, aescripts ZXP Installer) **reject unsigned packages** with a
bare "was not installed" dialog — that is a signing problem, not a manifest problem. Sign it:

```powershell
installer\sign-zxp.ps1
```

What it does:

1. Rebuilds the staging dir from `extension/` (signed package always matches source).
2. Generates a throwaway self-signed dev cert (`installer\tools\aimeva-dev.p12`, tracked
   in the repo for reproducibility; regenerated automatically if missing) — needs Adobe's
   `ZXPSignCmd.exe`, also in `installer\tools\` (tracked; auto-downloaded if missing).
3. Signs offline (no timestamp server) and runs `ZXPSignCmd -verify` + checks
   `META-INF/signatures.xml` is in the archive.

Expect installer apps to show the publisher as **unverified/unknown** for the self-signed
build — that is normal for a free, self-distributed extension; installation proceeds.
Premiere itself loads it because `install-zxp` enables `PlayerDebugMode`. For Adobe Exchange
listing you would need an Adobe-issued certificate instead; for GitHub-release distribution
the self-signed package is sufficient.

Development/local installs work **unsigned** (`install-zxp.bat` copies the folder directly,
no signing involved).

## 3. Auto-update (how it works)

`extension/js/updater.js` runs on load and on demand:

1. `GET plugin/update.json` from `raw.githubusercontent.com/kuldeep7ke/aimeva/master/plugin/update.json`
   → contains `version`, `zxp_url`, `update_url`, `models_url`.
2. If the remote `version` > local `version`, the panel shows an update prompt and points to the
   GitHub **release** artifact (`github.com/kuldeep7ke/aimeva/releases/latest/download/aimeva.zxp`).
3. The **model registry** is refreshed from `plugin/models.json` (curated defaults).

To publish a release: bump `plugin/update.json` version → run `installer\sign-zxp.ps1` → attach
`installer\aimeva.zxp` to a GitHub Release tagged so `latest` resolves (release name
`latest` or by default Latest release). Keep `plugin/*.json` merged on `master` before tagging.

## 4. Model registry & opencode free models

The full model strategy lives in **[MODELS.md](MODELS.md)**. In short:

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
| Extension doesn't appear under Window → Extensions | Reinstall to the **system** folder; kill `CEPHtmlEngine` + fully quit Premiere; check `PlayerDebugMode`; validate `CSXS/manifest.xml` parses as strict XML (`build-zxp.ps1` checks this automatically) |
| Update fetches new version but never prompts | Ensure `plugin/update.json` reachable at the raw `master` URL and `version` bumped |
| opencode models list empty | No internet (keep builtin fallback) or no providers in `~/.local/share/opencode/auth.json`; run `GET /opencode/models` on the worker to see `provider_dirs`/`catalog_models` |
| `.zxp` rejected ("was not installed") | Package is unsigned — run `installer\sign-zxp.ps1` and retry with the signed file (`install-zxp.bat` folder-copy always works unsigned)