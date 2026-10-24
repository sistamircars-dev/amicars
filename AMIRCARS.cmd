@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "MODE=%~1"
if /I "%MODE%"=="nube" goto NUBE
if /I "%MODE%"=="local" goto LOCAL
if /I "%MODE%"=="instalar" goto NUBE

:MENU
echo.
echo  AMIRCARS - Acceso al sistema
echo  =============================
echo   1. App en la nube (Render, sin Python)
echo   2. Servidor local en esta PC (requiere Python)
echo.
choice /C 12 /N /M "Opcion: "
if errorlevel 2 goto LOCAL
goto NUBE

:NUBE
set "URL=https://amircars-ve.onrender.com/"
if not "%~2"=="" set "URL=%~2"
echo.
echo  Abriendo %URL%
echo  Luego: Configuracion - Instalar en este equipo (PWA offline).
echo.
start "" "%URL%"
if /I "%MODE%"=="" pause
exit /b 0

:LOCAL
title AMIRCARS - Servidor local
color 0A
echo.
echo  AMIRCARS - modo local
echo  =====================
where python >nul 2>&1
if errorlevel 1 (
  echo  No se encontro Python. Instale Python 3.11+ o use la opcion nube.
  pause
  exit /b 1
)
if not exist "venv" (
  echo  Creando entorno virtual...
  python -m venv venv
)
call venv\Scripts\activate
python -m pip install --upgrade pip --quiet
if exist "requirements.txt" pip install -r requirements.txt --quiet
echo.
echo  Servidor: http://localhost:5000
echo  Red local: http://[IP-de-esta-PC]:5000
echo  No cierre esta ventana mientras usen el sistema.
echo.
python app.py
pause
exit /b 0
