@echo off
REM Chess Spiral launcher
REM Prefers the Python 3 launcher (py -3) since `python` on PATH is often Python 2.

where py >nul 2>nul
if %ERRORLEVEL%==0 (
    py -3 --version >nul 2>nul
    if %ERRORLEVEL%==0 (
        echo Starting local server on http://localhost:8765
        start "" http://localhost:8765/
        cd /d "%~dp0"
        py -3 -m http.server 8765
        goto :eof
    )
)

where python3 >nul 2>nul
if %ERRORLEVEL%==0 (
    echo Starting local server on http://localhost:8765
    start "" http://localhost:8765/
    cd /d "%~dp0"
    python3 -m http.server 8765
    goto :eof
)

echo Python 3 not found. Opening index.html directly.
start "" "%~dp0index.html"
