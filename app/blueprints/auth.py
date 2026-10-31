from __future__ import annotations

from datetime import datetime, timedelta, timezone

from flask import Blueprint, current_app, flash, jsonify, redirect, render_template, request, url_for
from flask_wtf import FlaskForm
from wtforms import PasswordField, StringField
from wtforms.validators import DataRequired, Email, Length

from app.decorators import login_required
from app.extensions import csrf, limiter
from app.schemas import LoginIn
from app.supabase_client import make_client

bp = Blueprint("auth", __name__)


class LoginForm(FlaskForm):
    email = StringField("Correo", validators=[DataRequired(), Email(), Length(max=254)])
    password = PasswordField("Contraseña", validators=[DataRequired(), Length(min=8, max=128)])


def _set_auth_cookies(response, session) -> None:
    access = getattr(session, "access_token", None)
    refresh = getattr(session, "refresh_token", None)
    expires_in = int(getattr(session, "expires_in", None) or 3600)
    cfg = current_app.config
    cookie_kw = {
        "httponly": True,
        "secure": cfg["JWT_COOKIE_SECURE"],
        "samesite": "Strict",
        "path": cfg["JWT_COOKIE_PATH"],
    }
    if access:
        response.set_cookie(
            cfg["JWT_ACCESS_COOKIE_NAME"],
            access,
            max_age=expires_in,
            **cookie_kw,
        )
    if refresh:
        response.set_cookie(
            cfg["JWT_REFRESH_COOKIE_NAME"],
            refresh,
            max_age=int(timedelta(days=90).total_seconds()),
            **cookie_kw,
        )
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
    response.set_cookie(
        "jdparfum_session_exp",
        expires_at.isoformat(),
        max_age=expires_in,
        httponly=False,
        secure=cfg["JWT_COOKIE_SECURE"],
        samesite="Strict",
        path=cfg["JWT_COOKIE_PATH"],
    )


def _clear_auth_cookies(response) -> None:
    cfg = current_app.config
    for name in (
        cfg["JWT_ACCESS_COOKIE_NAME"],
        cfg["JWT_REFRESH_COOKIE_NAME"],
        "jdparfum_session_exp",
        "amircars_session_exp",
        cfg["SESSION_COOKIE_NAME"],
    ):
        response.delete_cookie(name, path=cfg["JWT_COOKIE_PATH"], samesite="Strict")


@bp.route("/login", methods=["GET", "POST"])
@limiter.limit("5 per minute", methods=["POST"])
def login():
    form = LoginForm()
    if request.method == "GET":
        return render_template("login.html", form=form)

    if not form.validate_on_submit():
        flash("Credenciales inválidas o token CSRF ausente.", "error")
        return render_template("login.html", form=form), 400

    try:
        payload = LoginIn(email=form.email.data, password=form.password.data)
    except Exception:
        flash("Datos de acceso inválidos.", "error")
        return render_template("login.html", form=form), 400

    try:
        client = make_client()
        result = client.auth.sign_in_with_password(
            {"email": payload.email, "password": payload.password}
        )
    except Exception:
        flash("No se pudo iniciar sesión. Verifique correo y contraseña.", "error")
        return render_template("login.html", form=form), 401

    session = getattr(result, "session", None)
    user = getattr(result, "user", None)
    if session is None or user is None:
        flash("Supabase no devolvió una sesión válida.", "error")
        return render_template("login.html", form=form), 401

    response = redirect(url_for("panel.index"))
    _set_auth_cookies(response, session)
    return response


@bp.post("/api/auth/refresh")
@csrf.exempt
@limiter.limit("20 per minute")
def refresh_session():
    cfg = current_app.config
    token = request.cookies.get(cfg["JWT_REFRESH_COOKIE_NAME"])
    if not token:
        return jsonify({"ok": False, "error": "Sin sesión local"}), 401
    try:
        result = make_client().auth.refresh_session(token)
    except Exception:
        return jsonify({"ok": False, "error": "No se pudo renovar la sesión"}), 401
    session = getattr(result, "session", None)
    if session is None:
        return jsonify({"ok": False, "error": "Sesión inválida"}), 401
    response = jsonify({"ok": True})
    _set_auth_cookies(response, session)
    return response


@bp.post("/logout")
@login_required
def logout():
    try:
        make_client().auth.sign_out()
    except Exception:
        pass
    response = redirect(url_for("auth.login"))
    _clear_auth_cookies(response)
    return response
