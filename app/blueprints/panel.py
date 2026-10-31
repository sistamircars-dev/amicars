from flask import Blueprint, render_template

from app.decorators import login_required

bp = Blueprint("panel", __name__)


@bp.get("/panel")
@login_required
def index():
    return render_template("panel.html")
