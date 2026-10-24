from flask import Blueprint, jsonify, request

from app.decorators import login_required
from app.extensions import limiter
from app.sync_service import apply_pull, apply_push

bp = Blueprint("sync", __name__, url_prefix="/api/sync")


@bp.post("/push")
@login_required
@limiter.limit("30 per minute")
def push():
    payload = request.get_json(silent=True) or {}
    body, status = apply_push(payload)
    return jsonify(body), status


@bp.get("/pull")
@login_required
@limiter.limit("60 per minute")
def pull():
    since = (request.args.get("since") or "").strip() or None
    body = apply_pull(since)
    return jsonify(body), 200
