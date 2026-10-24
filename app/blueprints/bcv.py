from flask import Blueprint, jsonify, request

from app.bcv import BcvError, fetch_bcv_by_date, fetch_bcv_today, parse_iso_date
from app.decorators import login_required
from app.extensions import limiter

bp = Blueprint("bcv", __name__, url_prefix="/api/bcv")


@bp.get("/hoy")
@login_required
@limiter.limit("20 per minute")
def today():
    try:
        data = fetch_bcv_today()
    except BcvError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 502
    return jsonify({"ok": True, **data}), 200


@bp.get("/fecha")
@login_required
@limiter.limit("20 per minute")
def by_date():
    raw = (request.args.get("fecha") or "").strip()
    if not raw:
        return jsonify({"ok": False, "error": "Indique una fecha"}), 400
    try:
        parsed = parse_iso_date(raw)
        data = fetch_bcv_by_date(parsed)
    except BcvError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 502
    return jsonify({"ok": True, **data}), 200
