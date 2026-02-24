@echo off
chcp 65001 > nul
title AIGC 平台 - 一键启动
echo ==========================================
echo    AIGC 数字内容指纹嵌入与侵权监测平台
echo ==========================================

if exist venv\Scripts\activate (
    call venv\Scripts\activate
)

echo.
echo [1/2] 启动后端 (端口 8000)...
start "AIGC-Backend" cmd /k "cd /d "%~dp0" && venv\Scripts\python.exe -m uvicorn app.main:app --reload --reload-dir app --host 0.0.0.0 --port 8000"

timeout /t 2 /nobreak > nul

echo [2/2] 启动前端 (端口 5173)...
start "AIGC-Frontend" cmd /k "cd /d "%~dp0web_app" && npm run dev -- --host 127.0.0.1 --port 5173"

echo.
echo ==========================================
echo 启动完成！请等待几秒后访问：
echo   前端: http://127.0.0.1:5173
echo   后端: http://127.0.0.1:8000/health
echo ==========================================
pause
