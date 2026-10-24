from flask import Blueprint, jsonify

from app.extensions import limiter
from app.schemas import HealthOut

bp = Blueprint("health", __name__)


@bp.get("/api/health")
@limiter.exempt
def health():
    body = HealthOut(ok=True, status="online", service="amircars")
    return jsonify(body.model_dump()), 200
