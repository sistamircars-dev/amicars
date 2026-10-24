from __future__ import annotations

from flask import Blueprint, jsonify, request
from pydantic import ValidationError

from app.cloudinary_store import cloudinary_ready, destroy_image
from app.decorators import login_required
from app.extensions import limiter
from app.schemas import ArchivePurgeIn
from app.supabase_client import user_client

bp = Blueprint("archive", __name__, url_prefix="/api/archive")

ALLOWED = frozenset(
    {
        "movimientos_inventario",
        "historico_ref",
        "solicitudes_restock",
        "producto_imagenes",
        "tasas_bcv",
    }
)


@bp.post("/purge")
@login_required
@limiter.limit("12 per minute")
def purge():
    try:
        body = ArchivePurgeIn.model_validate(request.get_json(silent=True) or {})
    except ValidationError as exc:
        return jsonify({"ok": False, "error": "Datos inválidos", "details": exc.errors()}), 400

    items = [item for item in body.items if item.table in ALLOWED]
    images = 0
    if cloudinary_ready():
        for item in items:
            if not item.cloudinary_public_id:
                continue
            try:
                if destroy_image(item.cloudinary_public_id):
                    images += 1
            except Exception:
                continue

    payload = [{"table": item.table, "id": item.id} for item in items]
    client = user_client()
    try:
        result = client.rpc("fn_amircars_purge_archivados", {"p_items": payload}).execute()
        data = result.data if isinstance(result.data, dict) else {"ok": True, "raw": result.data}
    except Exception:
        data = _fallback_delete(client, items)
    return jsonify({"ok": True, "purged": data, "images": images, "count": len(items)}), 200


def _fallback_delete(client, items) -> dict:
    deleted = 0
    skipped = 0
    for item in items:
        if item.table == "movimientos_inventario":
            skipped += 1
            continue
        try:
            client.table(item.table).delete().eq("id", item.id).execute()
            deleted += 1
        except Exception:
            skipped += 1
    return {"ok": True, "otros": deleted, "omitidos": skipped, "via": "fallback"}
