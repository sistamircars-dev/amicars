@echo off
echo AMIRCARS
echo Esta PC no necesita Node ni Python.
echo Instale la aplicacion desde el navegador (icono Instalar).
echo Sin internet la copia local se abre y guarda en este equipo.
if not "%~1"=="" (
  start "" "%~1"
) else (
  echo Pase la URL del servicio como argumento o abra AMIRCARS desde el navegador.
)
