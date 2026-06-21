@echo off
cd /d "%~dp0"

echo ============================================
echo   Environment Setup
echo ============================================
echo.

set "ENVFILE=apps\api\.env"
if not exist "%ENVFILE%" (
    echo [1/6] Creating .env ...
    echo DATABASE_URL=mysql://root:1234@localhost:3306/1234> "%ENVFILE%"
    echo JWT_SECRET=change-me-in-production>> "%ENVFILE%"
    echo ALGO_SERVICE_URL=http://localhost:8000>> "%ENVFILE%"
    echo   Done: %ENVFILE%
) else (
    echo [1/6] .env exists, skip
)
echo.

echo [2/6] API: clean and npm install ...
cd apps\api
if exist node_modules (
    echo   Removing old node_modules ...
    rmdir /s /q node_modules 2>nul
    if exist node_modules (
        echo   Close Cursor/IDE and other terminals then run setup.bat again.
        timeout /t 2
    )
)
call npm install
if errorlevel 1 ( echo Failed. & cd /d "%~dp0" & pause & exit /b 1 )

echo [2/6] API: prisma generate ...
call npx prisma generate --schema=..\..\prisma\schema.prisma
if errorlevel 1 ( echo Failed. & cd /d "%~dp0" & pause & exit /b 1 )

echo [2/6] API: prisma db push (MySQL 1234) ...
call npx prisma db push --schema=..\..\prisma\schema.prisma
if errorlevel 1 (
    echo Ensure MySQL is running and database 1234 exists. Create with:
    echo   mysql -u root -p1234 -e "CREATE DATABASE IF NOT EXISTS \`1234\`;"
)
echo [2/6] API: prisma db seed (admin user) ...
call npx prisma db seed --schema=..\..\prisma\schema.prisma
cd /d "%~dp0"
echo.

echo [3/6] Web: npm install ...
cd apps\web
call npm install
if errorlevel 1 ( echo Failed. & cd /d "%~dp0" & pause & exit /b 1 )
cd /d "%~dp0"
echo.

echo [4/6] Algo: pip install ...
cd /d "%~dp0apps\algo"
python -m pip install -r requirements.txt
if errorlevel 1 (
    py -m pip install -r requirements.txt
)
if errorlevel 1 ( echo Failed. & cd /d "%~dp0" & pause & exit /b 1 )
cd /d "%~dp0"
echo.

echo [5/6] Root npm install ...
call npm install 2>nul
echo.

echo [6/6] Setup done.
echo.
echo --- Next: run start.bat then open http://localhost:3000 ---
pause
