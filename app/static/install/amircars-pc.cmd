@echo off
chcp 65001 >nul
if not "%~1"=="" (set "URL=%~1") else (set "URL=https://amircars-ve.onrender.com/")
echo AMIRCARS - abriendo %URL%
echo Luego: Configuracion - Instalar en este equipo.
start "" "%URL%"
