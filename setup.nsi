; === Configuración principal del instalador ===

OutFile "SCMLAB-Installer.exe"
InstallDir "$PROGRAMFILES\SCMLAB"
RequestExecutionLevel admin

; === Icono del instalador ===
Icon "icon.ico"

; === Información del ejecutable ===
VIProductVersion "1.0.0.0"
VIAddVersionKey "ProductName" "SCMLAB"
VIAddVersionKey "FileDescription" "CRM local para WhatsApp"
VIAddVersionKey "CompanyName" "SCMLAB"
VIAddVersionKey "LegalCopyright" "© 2025 SCMLAB"
VIAddVersionKey "FileVersion" "1.0.0"

; === Apariencia del instalador ===
Name "SCMLAB"
Caption "Setup"
BrandingText "SCMLAB - Conectando WhatsApp con tu gestión"

; === Sección principal de instalación ===
Section "Instalar SCMLAB"

  ; Crear la carpeta destino
  SetOutPath "$INSTDIR"

  ; Copiar todos los archivos de tu proyecto
  File /r "C:\Users\luxaid\Documents\Pagina web\*.*"

  ; Crear acceso directo al launcher (SCMLAB) en el escritorio
  CreateShortcut "$DESKTOP\SCMLAB.lnk" "$INSTDIR\SCMLAB.bat" "" "$INSTDIR\icon.ico"

SectionEnd
