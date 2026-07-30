@echo off
cd /d "%~dp0"
start "Pixel Level Tool" http://localhost:8974
node serve.mjs
