@echo off
REM Run Echo API from the echo folder. Double-click or: run-api.bat
cd /d "%~dp0api"
dotnet run
pause
