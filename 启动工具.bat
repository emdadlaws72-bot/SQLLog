@echo off
chcp 65001 >nul
title MySQL 实时SQL监控小工具
echo ========================================
echo   MySQL 实时SQL监控小工具 V2.0
echo   仓储现场开发/测试/定位问题专用
echo ========================================
echo.
echo 正在启动服务...
echo.

cd /d "%~dp0"

if exist "node_modules" (
    echo 检测到依赖已安装，直接启动...
    node app.js
) else (
    echo 首次运行，正在安装依赖...
    npm install
    echo 依赖安装完成，正在启动...
    node app.js
)

pause
