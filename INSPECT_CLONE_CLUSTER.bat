@echo off
title Anti-Vamp Clone Resolver Terminal
chcp 65001 >nul
cd /d "%~dp0"

set "PATH=%USERPROFILE%\.bun\bin;%APPDATA%\npm;%LOCALAPPDATA%\Programs\bun;%PATH%"

where bun >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Runtime Bun tidak ditemukan di PATH!
    pause
    exit /b 1
)

cls
call bun run scripts/inspect-clone-cluster.ts %1 %2
echo.
echo -------------------------------------------------------------------------------
echo   Tekan tombol apa saja untuk keluar...
pause >nul
