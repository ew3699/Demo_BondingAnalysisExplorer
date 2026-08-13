@echo off
rem Launches the Bonding Analysis Explorer.
rem Requires Python (any recent version) - https://www.python.org/downloads/
cd /d "%~dp0"
start "" http://localhost:8123

where py >nul 2>nul
if %errorlevel%==0 (
  py serve.py 8123
) else (
  python serve.py 8123
)
