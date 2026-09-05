# Removes the AIMeva extension (system + per-user copies) and resets CEP debug flag.
$ErrorActionPreference = "SilentlyContinue"
Get-Process -Name "Adobe Premiere Pro","PrPro","CEPHtmlEngine*" -ErrorAction SilentlyContinue |
  Stop-Process -Force -ErrorAction SilentlyContinue

$targets = @(
  "C:\Program Files\Common Files\Adobe\CEP\extensions\com.aimeva.cep",
  (Join-Path $env:APPDATA "Adobe\CEP\extensions\com.aimeva.cep")
)
foreach ($t in $targets) { if (Test-Path $t) { Remove-Item $t -Recurse -Force; Write-Host "Removed: $t" } }
"9","10","11","12","13","14" | ForEach-Object {
  $k = "HKCU:\Software\Adobe\CSXS.$_"
  if (Test-Path $k) { Remove-ItemProperty -Path $k -Name "PlayerDebugMode" -ErrorAction SilentlyContinue }
}
Write-Host "AIMeva uninstalled. Restart Premiere Pro if it was running."