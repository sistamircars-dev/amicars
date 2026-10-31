"""Public storefront catalog — no login required."""

from __future__ import annotations

from flask import Blueprint, current_app, jsonify, render_template

from app.extensions import limiter
from app.supabase_client import make_client, make_service_client

bp = Blueprint("catalog", __name__)


def _catalog_client():
    service = make_service_client()
    if service is not None:
        return service
    return make_client()


def _cover_map(client) -> dict[str, str]:
    try:
        result = (
            client.table("producto_imagenes")
            .select("producto_id,cloudinary_url,orden,is_cover,is_active")
            .eq("is_active", True)
            .execute()
        )
    except Exception:
        current_app.logger.exception("Public catalog: failed to load images")
        return {}
    rows = getattr(result, "data", None) or []
    covers: dict[str, str] = {}
    ranked: dict[str, tuple[int, str]] = {}
    for row in rows:
        pid = str(row.get("producto_id") or "")
        url = (row.get("cloudinary_url") or "").strip()
        if not pid or not url:
            continue
        score = 0 if row.get("is_cover") else 1
        score = score * 1000 + int(row.get("orden") or 0)
        prev = ranked.get(pid)
        if prev is None or score < prev[0]:
            ranked[pid] = (score, url)
            covers[pid] = url
    return covers


def _sanitize_product(row: dict, covers: dict[str, str]) -> dict:
    pid = str(row.get("id") or "")
    return {
        "id": pid,
        "descripcion": row.get("descripcion") or "",
        "stock": float(row.get("stock") or 0),
        "ref_venta": float(row.get("ref_venta") or 0),
        "imagen_url": covers.get(pid) or "",
        "codigo": row.get("codigo") or "",
    }


@bp.get("/")
@limiter.exempt
def storefront():
    return render_template("catalogo.html")


@bp.get("/api/catalog/products")
@limiter.limit("60 per minute")
def list_products():
    try:
        client = _catalog_client()
        result = (
            client.table("productos")
            .select("id,descripcion,stock,ref_venta,codigo,is_active,updated_at")
            .eq("is_active", True)
            .order("descripcion")
            .execute()
        )
        rows = getattr(result, "data", None) or []
        covers = _cover_map(client)
        products = [_sanitize_product(row, covers) for row in rows]
        return jsonify({"ok": True, "products": products})
    except Exception as exc:
        current_app.logger.exception("Public catalog list failed")
        detail = str(exc).strip()[:160]
        return (
            jsonify(
                {
                    "ok": False,
                    "error": "No se pudo cargar el catálogo público.",
                    "detail": detail,
                    "products": [],
                }
            ),
            503,
        )


@bp.get("/api/catalog/products/<product_id>")
@limiter.limit("60 per minute")
def product_detail(product_id: str):
    try:
        client = _catalog_client()
        result = (
            client.table("productos")
            .select("id,descripcion,stock,ref_venta,codigo,is_active")
            .eq("id", product_id)
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
        rows = getattr(result, "data", None) or []
        if not rows:
            return jsonify({"ok": False, "error": "Producto no encontrado"}), 404
        covers = _cover_map(client)
        return jsonify({"ok": True, "product": _sanitize_product(rows[0], covers)})
    except Exception:
        current_app.logger.exception("Public catalog detail failed")
        return jsonify({"ok": False, "error": "No se pudo cargar el producto"}), 503
