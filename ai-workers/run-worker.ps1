# Aimeva worker launcher. Keeps the packaged ffmpeg on PATH and starts uvicorn.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$venv = Join-Path $root ".venv"
$py = Join-Path $venv "Scripts\python.exe"
$bin = Join-Path $root "bin"

if (-not (Test-Path $py)) {
  Write-Host "Creating venv..."
  python -m venv $venv
  & $py -m pip install --upgrade pip | Out-Null
  & $py -m pip install -e $root
}

$env:PYTHONPATH = $root
$env:PATH = "$bin;$env:PATH"
Push-Location $root
& $py -m uvicorn ai_workers.index:app --host 127.0.0.1 --port 8000 --app-dir $root
Pop-Location