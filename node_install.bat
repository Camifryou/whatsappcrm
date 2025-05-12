@echo off
setlocal

:: Definir la ruta donde se encuentra el archivo .msi
set MSI_PATH=%~dp0node.msi

:: Verificar si el archivo node.msi existe
if not exist "%MSI_PATH%" (
    echo Error: El archivo node.msi no se encuentra en la carpeta actual.
    exit /b
)

:: Mensaje de inicio de instalación
echo Iniciando la instalación de Node.js...

:: Ejecutar la instalación de Node.js sin /quiet para que no se quede abierto
start /wait msiexec /i "%MSI_PATH%" /norestart /passive

:: Verificar si la instalación fue exitosa, pero no pausar
where node >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo Node.js se ha instalado correctamente.
) else (
    echo Hubo un problema durante la instalación de Node.js.
)

:: Ejecutar el MessageBox desde el archivo VBS en segundo plano
start "" "%~dp0dist\messagebox.vbs"

:: Eliminar el archivo .bat actual (node_install.bat)
del "%~dp0%~nx0" /f /q

:: Cerrar la ventana de CMD sin que quede en pausa
exit
