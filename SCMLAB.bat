@echo off
:: ================= Verificar si es administrador =================
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if %errorlevel% NEQ 0 (
    echo Ejecutando como administrador...
    powershell -Command "Start-Process '%~f0' -Verb runAs"
    exit /b
)

setlocal

:: Verificar si Node.js está instalado
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo Node.js no está instalado. Iniciando la instalación...
    call "%~dp0node_install.bat"
    pause
    exit
)

:: Navegar al directorio donde está el proyecto Node.js
cd /d "%~dp0"

:: Iniciar el servidor Node.js en segundo plano y minimizar CMD
start /min npm start >nul 2>&1

:: Abrir localhost:3000 en el navegador
start http://localhost:3000

exit
