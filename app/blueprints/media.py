from flask import Blueprint, jsonify, request

import re

from app.cloudinary_store import cloudinary_ready, upload_image_bytes
from app.decorators import login_required
from app.extensions import limiter
from app.media import ImageValidationError, validate_image_file

bp = Blueprint("media", __name__, url_prefix="/api/media")
_UUID = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
)


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

    image_id = (request.form.get("image_id") or "").strip()
    public_id = None
    if image_id and _UUID.match(image_id):
        public_id = f"amircars/repuestos/{image_id.lower()}"

    try:
        stored = upload_image_bytes(raw, public_id=public_id)
    except Exception:
        return jsonify({"ok": False, "error": "No se pudo subir la imagen"}), 502

    return jsonify({"ok": True, **stored}), 200
