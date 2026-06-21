@echo off
cd /d "%~dp0"
echo [Algo] Working dir: %CD%
echo [Algo] Checking Python...
python --version
if errorlevel 1 (
  echo [Algo] Python not found. Please install Python 3.10+ and add it to PATH.
  pause
  exit /b 1
)
echo [Algo] Installing dependencies (may take a few minutes)...
python -m pip install -r requirements.txt
if errorlevel 1 (
  echo [Algo] pip install failed. Check the error above.
  pause
  exit /b 1
)
echo [Algo] Checking SAM (torch + segment_anything) in this Python...
python check_sam.py
if errorlevel 1 (
  echo.
  echo [Algo] SAM check failed. Use the SAME terminal/env where you ran pip install.
  echo Example: open "Anaconda Prompt", cd to this folder, then run:
  echo   python -m uvicorn algo.main:app --host 0.0.0.0 --port 8000
  pause
  exit /b 1
)
echo [Algo] Starting uvicorn on http://localhost:8000 ...
python -m uvicorn algo.main:app --host 0.0.0.0 --port 8000
echo [Algo] Process exited. Press any key to close.
pause
