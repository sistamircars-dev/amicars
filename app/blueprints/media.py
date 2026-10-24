from flask import Blueprint, jsonify, request

from app.cloudinary_store import cloudinary_ready, upload_image_bytes
from app.decorators import login_required
from app.extensions import limiter
from app.media import ImageValidationError, validate_image_file

bp = Blueprint("media", __name__, url_prefix="/api/media")


@bp.post("/upload")
@login_required
@limiter.limit("20 per minute")
def upload():
    file = request.files.get("file") or request.files.get("image")
    try:
        raw = validate_image_file(file)
    except ImageValidationError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    if not cloudinary_ready():
        return jsonify(
            {
                "ok": False,
                "error": "CLOUDINARY_URL no está configurada en el servidor",
            }
        ), 503

    try:
        stored = upload_image_bytes(raw)
    except Exception:
        return jsonify({"ok": False, "error": "No se pudo subir la imagen"}), 502

    return jsonify({"ok": True, **stored}), 200
