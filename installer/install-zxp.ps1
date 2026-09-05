# Installs the Aimeva CEP extension for Premiere Pro 2023+.
# Stops Premiere, copies the extension folder into the system CEP extensions
# directory (and the per-user copy as a fallback), and enables dev mode so the
# extension shows under Window > Extensions.
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$src  = Join-Path $root "..\extension"
$systemTarget = "C:\Program Files\Common Files\Adobe\CEP\extensions\com.aimeva.cep"
$userTarget   = Join-Path $env:APPDATA "Adobe\CEP\extensions\com.aimeva.cep"

Write-Host "Aimeva installer"
Write-Host "---------------"

# 1. Stop Premiere so installed files aren't locked
Get-Process -Name "Adobe Premiere Pro","PrPro","CEPHtmlEngine*" -ErrorAction SilentlyContinue |
  Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "Premiere processes stopped (if any)."

# 2. Copy into system folder (auto-elevate if needed)
function Install-Copy {
  param($target)
  New-Item -ItemType Directory -Path $target -Force | Out-Null
  Copy-Item "$src\*" $target -Recurse -Force
  Write-Host "Installed to: $target"
}

$copied = $false
try {
  Install-Copy $systemTarget
  $copied = $true
} catch {
  Write-Host " System install blocked ($($_.Exception.Message)). Try per-user instead:"
  try {
    Install-Copy $userTarget
    $copied = $true
  } catch {
    Write-Host " Per-user install also failed: $($_.Exception.Message)"
  }
}

if (-not $copied) { Write-Host "Install failed - nothing was copied."; exit 1 }

# 3. Enable CEP debug mode (CSXS.11 = Premiere 2023+)
New-Item -Path "HKCU:\Software\Adobe\CSXS.11" -Force | Out-Null
Set-ItemProperty -Path "HKCU:\Software\Adobe\CSXS.11" -Name "PlayerDebugMode" -Value "1" -Force
Set-ItemProperty -Path "HKCU:\Software\Adobe\CSXS.11" -Name "LogLevel" -Value "6" -Force
# Also set for 2024/2025 as a fallback
"9","10","12","13","14" | ForEach-Object {
  $k = "HKCU:\Software\Adobe\CSXS.$_"
  New-Item -Path $k -Force | Out-Null
  Set-ItemProperty -Path $k -Name "PlayerDebugMode" -Value "1" -Force
}
Write-Host "CEP debug mode enabled (CSXS.9-14)."

# 4. Verify
$installed = Test-Path "$systemTarget\CSXS\manifest.xml" -or (Test-Path "$userTarget\CSXS\manifest.xml")
if (-not $installed) { Write-Host "Verification failed - manifest not found."; exit 1 }
Write-Host "Verified manifest present."
Write-Host ""
Write-Host "Done! Restart Premiere Pro, then: Window > Extensions > Aimeva"
Write-Host "To also start the AI worker, run: .\installer\start-worker.bat"