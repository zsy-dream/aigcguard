@echo off
chcp 65001 > nul
title AIGC Fingerprint Platform - Launcher
echo ==========================================
echo    AIGC 数字内容指纹嵌入与侵权监测平台
echo ==========================================
echo === 正在检测运行环境 ===
set PYTHONIOENCODING=utf-8

if exist venv\Scripts\activate (
    echo [OK] 检测到虚拟环境，正在激活...
    call venv\Scripts\activate
) else (
    echo [!] 未检测到 venv 虚拟环境，将尝试使用系统 Python。
)

echo === 启动后端服务 (端口 8000) ===
echo 提示：仅监听 app 目录，防止数据变动引发重启
start "AIGC Backend" cmd /k "python -m uvicorn app.main:app --reload --reload-dir app --host 0.0.0.0 --port 8000"

echo === 启动前端服务 (端口 5173) ===
start "AIGC Frontend" cmd /k "cd /d web_app && npm run dev -- --host 127.0.0.1 --port 5173"

if %ERRORLEVEL% neq 0 (
    echo.
    echo [错误] 后端启动失败！
    echo 可能原因：
    echo 1. 端口 8000 已被占用 (请关闭其它正在运行的后端窗口)
    echo 2. 依赖包未安装 (请运行 pip install -r requirements.txt)
    echo.
)

pause