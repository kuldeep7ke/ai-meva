@echo off
REM Aimeva installer launcher (auto-raises to admin when needed).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-zxp.ps1"
pause