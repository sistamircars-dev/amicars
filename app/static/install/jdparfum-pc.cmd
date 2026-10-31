@echo off
chcp 65001 >nul
if not "%~1"=="" (set "URL=%~1") else (set "URL=https://jdparfum-ve.onrender.com/")
echo JD Parfum - abriendo %URL%
echo Luego: Configuracion - Instalar en este equipo.
start "" "%URL%"
