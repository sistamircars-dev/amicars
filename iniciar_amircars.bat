@echo off
TITLE AMIRCARS - Sistema de Inventario Local
color 0A
cls
echo ========================================================
echo        INICIANDO SISTEMA AMIRCARS (MODO LOCAL)
echo ========================================================
echo.

:: 1. Verificar si el entorno virtual existe, si no, crearlo automáticamente
if not exist "venv" (
    echo [1/3] Configurando entorno por primera vez (esto tomara unos segundos)...
    python -m venv venv
) else (
    echo [1/3] Entorno virtual detectado correctamente.
)

:: 2. Activar el entorno virtual e instalar/actualizar librerias
echo [2/3] Verificando dependencias y librerias...
call venv\Scripts\activate
python -m pip install --upgrade pip --quiet
if exist "requirements.txt" (
    pip install -r requirements.txt --quiet
)

echo.
echo ========================================================
echo  SERVIDOR LISTO Y OPERATIVO EN LA RED LOCAL
echo ========================================================
echo  - Para entrar desde ESTA computadora:
    http://localhost:5000
echo.
echo  - Para entrar desde OTROS teléfonos o PCs en el mismo Wi-Fi:
    Usa la direccion IP local de esta PC seguida de :5000
echo ========================================================
echo  (NO cierres esta ventana negra mientras usen el sistema)
echo.

:: 3. Iniciar Flask escuchando en todas las interfaces de red (0.0.0.0)
python app.py

pause
