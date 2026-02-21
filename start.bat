@echo off
title Local Media Browser
echo Starting server...
start "" http://localhost:3000
node "%~dp0server\server.js"
pause
