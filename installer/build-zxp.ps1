# Assembles extension/ into a .zxp zip.
# Signing is documented but not required for local dev-load (sideload).
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $root "dist"
$src  = Join-Path $root "..\extension"

Remove-Item $dist -Recurse -Force -ErrorAction SilentlyContinue
New-Item $dist -ItemType Directory -Force | Out-Null
Copy-Item "$src\*" $dist -Recurse -Force
Remove-Item "$dist\.gitignore" -Force -ErrorAction SilentlyContinue
Remove-Item "$dist\build" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$dist\tools" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$dist\build-icons.mjs" -Force -ErrorAction SilentlyContinue

$zxp = Join-Path $root "aimeva.zxp"
$tempZip = Join-Path $root "dist-temp.zip"
if (Test-Path $zxp) { Remove-Item $zxp -Force }
if (Test-Path $tempZip) { Remove-Item $tempZip -Force }

Compress-Archive -Path "$dist\*" -DestinationPath $tempZip -Force
Move-Item $tempZip $zxp -Force

# Verify entries
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($zxp)
$entries = $zip.Entries | ForEach-Object { $_.FullName }
$zip.Dispose()
$hasManifest = $entries -contains "CSXS\manifest.xml"
Write-Host "Created: $zxp ($(((Get-Item $zxp).Length / 1024).ToString('N1')) KB), $($entries.Count) entries, manifest=$hasManifest"
if (-not $hasManifest) { Write-Host "WARNING: CSXS\manifest.xml missing from archive" }
Write-Host "To sign (optional): ZXPSignCmd -sign dist aimeva.zxp aimeva-dev.p12 aimeva"
Write-Host "For local dev-load: use install-zxp.ps1 (no signing required)."