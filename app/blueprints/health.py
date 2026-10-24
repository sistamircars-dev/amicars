from flask import Blueprint, jsonify

from app.extensions import limiter
from app.revision import APP_REVISION, APP_SERVICE
from app.schemas import HealthOut

bp = Blueprint("health", __name__)


@bp.get("/api/health")
@limiter.exempt
def health():
    body = HealthOut(ok=True, status="online", service=APP_SERVICE, revision=APP_REVISION)
    return jsonify(body.model_dump()), 200
