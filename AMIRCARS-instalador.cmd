@echo off
chcp 65001 >nul
set "URL=https://amircars-ve.onrender.com/"

echo.
echo  AMIRCARS - Instalacion en este equipo
echo  =====================================
echo  No necesita Node, Python ni base de datos local.
echo.
echo  1. Se abrira la app en el navegador.
echo  2. Inicie sesion con su usuario.
echo  3. En el menu Configuracion: pulse "Instalar en este equipo".
echo  4. Acepte guardar datos en este PC (funciona sin internet).
echo.
echo  URL del servicio: %URL%
echo.

start "" "%URL%"

echo.
echo  Atajo creado: puede copiar este archivo .cmd al Escritorio.
pause
