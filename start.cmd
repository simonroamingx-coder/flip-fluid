@echo off
rem Starts the server for the development entry point (dev.html) and opens it.
rem To just look at the simulation, double-click index.html - no server needed.
cd /d "%~dp0"
start "flip server" /min cmd /c "node tools\serve.mjs 8080"
timeout /t 1 /nobreak >nul
start "" http://localhost:8080/dev.html
