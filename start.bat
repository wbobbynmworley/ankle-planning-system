@echo off
set "ROOT=%~dp0"
cd /d "%ROOT%"
rem Use short path (8.3) to avoid "filename/dir syntax incorrect" when path has Chinese
for %%A in ("%ROOT%.") do set "R=%%~sA"
if not defined R set "R=%ROOT%"

echo ================================
echo  Start API + Algo + Web (one-click)
echo ================================
echo.

echo [0] Free port 3001 if in use (avoid EADDRINUSE)...
for /f "tokens=*" %%L in ('netstat -ano 2^>nul ^| findstr ":3001 "') do for %%P in (%%L) do set "PID3001=%%P"
if defined PID3001 taskkill /F /PID %PID3001% 2>nul & set "PID3001=" & timeout /t 2 /nobreak >nul
echo.

echo [0.5] PDF Chinese font (copy from system if missing)...
if not exist "%R%\apps\api\fonts" mkdir "%R%\apps\api\fonts"
if not exist "%R%\apps\api\fonts\simsun.ttc" if exist "C:\Windows\Fonts\simsun.ttc" copy /Y "C:\Windows\Fonts\simsun.ttc" "%R%\apps\api\fonts\simsun.ttc" >nul 2>&1
if not exist "%R%\apps\api\fonts\simsun.ttc" if not exist "%R%\apps\api\fonts\msyh.ttc" if exist "C:\Windows\Fonts\msyh.ttc" copy /Y "C:\Windows\Fonts\msyh.ttc" "%R%\apps\api\fonts\msyh.ttc" >nul 2>&1
echo.

echo [1/3] Start API (Nest, 3001)...
start "API-3001" cmd /k "cd /d "%R%\apps\api" && set DATABASE_URL=mysql://root:1234@localhost:3306/ankle_app && npm run start:dev"

echo [2/3] Start Algo (Python/Uvicorn, 8000, SAM)...
rem NOTE: change this path if your Anaconda is not on E:\anaconda3
start "Algo-8000" cmd /k "cd /d "%R%\apps\algo" && E:\anaconda3\python.exe -m uvicorn algo.main:app --host 0.0.0.0 --port 8000"

echo [3/3] Start Web (Next.js, 3000)...
start "Web-3000" cmd /k "cd /d "%R%\apps\web" && npm run dev"

echo.
echo Opened 3 windows:
echo   - API-3001  -> http://localhost:3001/api
echo   - Algo-8000 -> http://localhost:8000
echo   - Web-3000  -> http://localhost:3000
echo Wait ~30 seconds, then open http://localhost:3000 in browser.
echo ================================
pause
