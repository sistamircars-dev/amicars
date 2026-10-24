from flask import Blueprint, current_app, make_response, request, send_from_directory

from app.extensions import limiter

bp = Blueprint("pwa", __name__)

_INSTALL_CMD = """@echo off
chcp 65001 >nul
set "URL={origin}/"
echo.
echo  AMIRCARS - acceso en este equipo
echo  ================================
echo  1. Se abrira la app en el navegador.
echo  2. Inicie sesion y vaya a Configuracion - Instalar en este equipo.
echo  3. Para servidor local con Python use AMIRCARS.cmd opcion 2 desde el repo.
echo.
start "" "%URL%"
"""


@bp.get("/sw.js")
@limiter.exempt
def service_worker():
    response = make_response(send_from_directory(current_app.static_folder, "sw.js"))
    response.headers["Content-Type"] = "application/javascript; charset=utf-8"
    response.headers["Service-Worker-Allowed"] = "/"
    response.headers["Cache-Control"] = "no-store"
    return response


@bp.get("/manifest.json")
@limiter.exempt
def manifest():
    response = make_response(send_from_directory(current_app.static_folder, "manifest.json"))
    response.headers["Content-Type"] = "application/manifest+json; charset=utf-8"
    response.headers["Cache-Control"] = "no-cache"
    return response


@bp.get("/offline.html")
@limiter.exempt
def offline():
    return send_from_directory(current_app.static_folder, "offline.html")


@bp.get("/install/amircars-pc.cmd")
@limiter.exempt
def install_cmd():
    origin = request.url_root.rstrip("/")
    body = _INSTALL_CMD.format(origin=origin)
    response = make_response(body)
    response.headers["Content-Type"] = "application/octet-stream"
    response.headers["Content-Disposition"] = 'attachment; filename="amircars-acceso.cmd"'
    response.headers["Cache-Control"] = "no-store"
    return response
