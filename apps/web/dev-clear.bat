@echo off
cd /d "%~dp0"
if exist .next rmdir /s /q .next
echo .next cleared. Starting dev server...
npm run dev
pause
