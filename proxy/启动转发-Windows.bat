@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动转发代理...
py proxy.py 2>nul
if errorlevel 1 python proxy.py
pause
