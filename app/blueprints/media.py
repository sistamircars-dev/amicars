import re
from datetime import datetime, timezone

from flask import Blueprint, current_app, jsonify, request

from app.cloudinary_store import cloudinary_ready, upload_image_bytes
from app.decorators import login_required
from app.extensions import csrf, limiter
from app.media import ImageValidationError, validate_image_file
from app.supabase_client import user_client

bp = Blueprint("media", __name__, url_prefix="/api/media")
_UUID = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
)


@bp.post("/upload")
@login_required
@csrf.exempt
@limiter.limit("60 per minute")
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
                "error": "Cloudinary no está configurada. En Render use CLOUDINARY_URL o CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET.",
            }
        ), 503

    image_id = (request.form.get("image_id") or "").strip()
    producto_id = (request.form.get("producto_id") or "").strip()
    public_id = None
    if image_id and _UUID.match(image_id):
        public_id = f"amircars/repuestos/{image_id.lower()}"
    context = None
    if producto_id and _UUID.match(producto_id):
        context = f"producto_id={producto_id.lower()}"

    try:
        stored = upload_image_bytes(raw, public_id=public_id, context=context)
    except Exception as exc:
        current_app.logger.exception("Cloudinary upload failed")
        detail = re.sub(r"\s+", " ", str(exc)).strip()[:180]
        low = detail.lower()
        if "invalid api_key" in low or "your_api_key" in low:
            message = (
                "Cloudinary rechazó la API key: en Render quedó el ejemplo <your_api_key>. "
                "Borre CLOUDINARY_URL si es de ejemplo y deje las tres variables reales "
                "(CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET), "
                "o pegue la URL completa del dashboard de Cloudinary."
            )
        elif "invalid signature" in low:
            message = (
                "Cloudinary reconoció la API key, pero el API Secret no coincide. "
                "En Render, CLOUDINARY_API_KEY debe ser el número y CLOUDINARY_API_SECRET "
                "la clave larga del mismo producto en console.cloudinary.com (API Keys). "
                "No mezcle cuentas ni deje espacios o saltos de línea."
            )
        elif "invalid signature" in low:
            message = (
                "Cloudinary reconoció la API key, pero el API Secret no coincide. "
                "En Render, CLOUDINARY_API_KEY debe ser el número y CLOUDINARY_API_SECRET "
                "la clave larga del mismo producto en console.cloudinary.com (API Keys). "
                "No mezcle cuentas ni deje espacios o saltos de línea."
            )
        else:
            message = (
                "Cloudinary no aceptó la subida. En Render use CLOUDINARY_URL "
                "(cloudinary://API_KEY:API_SECRET@CLOUD_NAME) o las tres variables "
                "CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET."
                + (f" Detalle: {detail}" if detail else "")
            )
        return jsonify({"ok": False, "error": message}), 502

    return jsonify({"ok": True, **stored}), 200


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


@bp.post("/restore-cloud")
@login_required
@csrf.exempt
@limiter.limit("12 per minute")
def restore_cloud():
    client = user_client()
    try:
        images = (
            client.table("producto_imagenes")
            .select("id,producto_id,cloudinary_url,cloudinary_public_id,is_active")
            .execute()
        )
        products = client.table("productos").select("id,is_active").execute()
    except Exception as exc:
        current_app.logger.exception("restore-cloud list failed")
        return jsonify({"ok": False, "error": str(exc)[:180]}), 502

    active = {
        str(row.get("id"))
        for row in (products.data or [])
        if row.get("is_active") is not False
    }
    restored = 0
    stamp = _now()
    for row in images.data or []:
        if str(row.get("producto_id") or "") not in active:
            continue
        if not (row.get("cloudinary_url") or row.get("cloudinary_public_id")):
            continue
        if row.get("is_active") is False:
            client.table("producto_imagenes").update({"is_active": True, "updated_at": stamp}).eq(
                "id", row["id"]
            ).execute()
            restored += 1

    return jsonify({"ok": True, "restored": restored}), 200


def _cloud_url(public_id: str, image_id: str) -> str:
    pid = (public_id or "").strip().lstrip("/")
    if pid:
        return f"https://res.cloudinary.com/mwzczz6i/image/upload/f_auto,q_auto/{pid}"
    iid = (image_id or "").strip().lower()
    if iid:
        return f"https://res.cloudinary.com/mwzczz6i/image/upload/f_auto,q_auto/amircars/repuestos/{iid}"
    return ""


@bp.get("/index")
@login_required
@limiter.limit("30 per minute")
def photo_index():
    client = user_client()
    try:
        result = (
            client.table("producto_imagenes")
            .select("id,producto_id,cloudinary_url,cloudinary_public_id,alt_text,orden,is_cover,is_active")
            .limit(2000)
            .execute()
        )
    except Exception as exc:
        current_app.logger.exception("photo index list failed")
        return jsonify({"ok": False, "error": str(exc)[:180]}), 502
    return jsonify({"ok": True, "items": result.data or []}), 200


@bp.post("/index")
@login_required
@csrf.exempt
@limiter.limit("8 per minute")
def publish_photo_index():
    body = request.get_json(silent=True) or {}
    raw_items = body.get("items") if isinstance(body, dict) else None
    if not isinstance(raw_items, list):
        return jsonify({"ok": False, "error": "Falta la lista de fotos"}), 400

    client = user_client()
    try:
        products = client.table("productos").select("id,is_active").execute()
    except Exception as exc:
        current_app.logger.exception("photo index products failed")
        return jsonify({"ok": False, "error": str(exc)[:180]}), 502

    state = {str(row.get("id")): row.get("is_active") is not False for row in products.data or []}
    stamp = _now()
    upserted = 0
    skipped = 0
    batch: list[dict] = []

    for raw in raw_items[:800]:
        if not isinstance(raw, dict):
            skipped += 1
            continue
        image_id = str(raw.get("id") or "").strip()
        producto_id = str(raw.get("producto_id") or "").strip()
        public_id = str(raw.get("cloudinary_public_id") or "").strip()
        url = str(raw.get("cloudinary_url") or "").strip() or _cloud_url(public_id, image_id)
        if not image_id or not producto_id or not url or producto_id not in state:
            skipped += 1
            continue
        if not public_id:
            public_id = f"amircars/repuestos/{image_id.lower()}"
        try:
            orden = int(raw.get("orden") or 0)
        except (TypeError, ValueError):
            orden = 0
        batch.append(
            {
                "id": image_id,
                "producto_id": producto_id,
                "cloudinary_url": url,
                "cloudinary_public_id": public_id,
                "alt_text": str(raw.get("alt_text") or "")[:240],
                "orden": orden,
                "is_cover": bool(raw.get("is_cover")),
                "is_active": state[producto_id],
                "updated_at": stamp,
            }
        )

    try:
        for start in range(0, len(batch), 80):
            chunk = batch[start : start + 80]
            client.table("producto_imagenes").upsert(chunk, on_conflict="id").execute()
            upserted += len(chunk)
    except Exception as exc:
        current_app.logger.exception("photo index upsert failed")
        return jsonify({"ok": False, "error": str(exc)[:180], "upserted": upserted, "skipped": skipped}), 502

    return jsonify({"ok": True, "upserted": upserted, "skipped": skipped}), 200
