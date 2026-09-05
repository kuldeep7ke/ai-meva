# Signs the staged extension (installer\dist) into installer\aimeva.zxp using a
# local self-signed DEV certificate. Self-signed is enough for third-party
# installers (Anastasiya's Extension Manager, aescripts ZXP Installer) which
# reject UNSIGNED packages with "was not installed", and for Premiere debug
# loading (PlayerDebugMode=1, set by install-zxp.ps1).
#
# One-command flow: installer\sign-zxp.ps1   (rebuilds staging, signs, verifies)
#
# The dev cert (installer\tools\aimeva-dev.p12, password "aimeva-dev") is a
# throwaway local identity - never use it to impersonate a real publisher.
# It is gitignored; the script regenerates it if missing.
$ErrorActionPreference = "Stop"

$root  = Split-Path -Parent $MyInvocation.MyCommand.Path
$tools = Join-Path $root "tools"
$sign  = Join-Path $tools "ZXPSignCmd.exe"
$dist  = Join-Path $root "dist"
$zxp   = Join-Path $root "aimeva.zxp"
$cert  = Join-Path $tools "aimeva-dev.p12"
$certPass = "aimeva-dev"

if (-not (Test-Path $sign)) {
  Write-Host "ZXPSignCmd not found - downloading from Adobe (CEP-Resources)..."
  New-Item -ItemType Directory -Path $tools -Force | Out-Null
  $url = "https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/ZXPSignCMD/4.1.3/x64/ZXPSignCmd.exe"
  try {
    Invoke-WebRequest -Uri $url -OutFile $sign -TimeoutSec 120
  } catch {
    Write-Host "Download failed: $($_.Exception.Message)"
    Write-Host "Manually place ZXPSignCmd.exe into installer\tools\ and re-run."
    exit 1
  }
  if ((Get-Item $sign).Length -ne 4542464) {
    Write-Host "Download looks corrupt (size mismatch). Delete installer\tools\ZXPSignCmd.exe and re-run."
    exit 1
  }
}

# 1. Rebuild the staging dir so the signed package always matches extension/
Write-Host "Rebuilding staging dir..."
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "build-zxp.ps1")
if (-not (Test-Path $dist)) { Write-Host "Build failed - $dist missing."; exit 1 }

# 2. Dev certificate (generate once, reuse after)
if (-not (Test-Path $cert)) {
  Write-Host "Generating self-signed dev certificate..."
  & $sign -selfSignedCert US California AIMeva "AIMeva Dev" $certPass $cert
  if ($LASTEXITCODE -ne 0) { Write-Host "Certificate generation failed."; exit 1 }
}

# 3. Sign (no timestamp server - works offline; fine for a dev cert)
Write-Host "Signing $zxp ..."
if (Test-Path $zxp) { Remove-Item $zxp -Force }
& $sign -sign $dist $zxp $cert $certPass
if ($LASTEXITCODE -ne 0) { Write-Host "Signing failed."; exit 1 }

# 4. Verify signature + archive contents
Write-Host "Verifying..."
& $sign -verify $zxp
if ($LASTEXITCODE -ne 0) { Write-Host "Verification FAILED."; exit 1 }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($zxp)
$signed = ($zip.Entries | ForEach-Object { $_.FullName }) -contains "META-INF/signatures.xml"
$count = ($zip.Entries | Measure-Object).Count
$zip.Dispose()
Write-Host "Signed: $zxp ($(((Get-Item $zxp).Length / 1024).ToString('N1')) KB, $count entries, signatures.xml=$signed)"
if (-not $signed) { Write-Host "WARNING: META-INF/signatures.xml missing from archive"; exit 1 }
Write-Host "Done - installable via ZXP/UXP Installer or aescripts ZXP Installer."
