@echo off
REM Start the AIMeva AI worker (creates a venv on first run, then launches uvicorn).
set ROOT=%~dp0..
set VENV=%ROOT%\ai-workers\.venv
set PY=%VENV%\Scripts\python.exe
set BIN=%ROOT%\ai-workers\bin

REM Make the bundled ffmpeg/ffprobe available to the worker.
set "PATH=%BIN%;%PATH%"
set PYTHONPATH=%ROOT%\ai-workers

if not exist "%PY%" (
  echo Creating Python venv in %VENV% ...
  py -3 -m venv "%VENV%"
  if errorlevel 1 goto :err
  "%PY%" -m pip install --upgrade pip >nul 2>&1
  "%PY%" -m pip install -e "%ROOT%\ai-workers" || goto :err
)

echo Starting AIMeva worker on http://127.0.0.1:8000 ...
"%PY%" -m uvicorn ai_workers.index:app --host 127.0.0.1 --port 8000 --app-dir "%ROOT%\ai-workers"
goto :eof

:err
echo Failed to set up the AI worker. Is Python 3 installed (py launcher)?
pause
exit /b 1