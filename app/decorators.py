from __future__ import annotations

from functools import wraps
from typing import Any, Callable, TypeVar

from flask import g, jsonify, redirect, request, url_for
from pydantic import ValidationError

from app.supabase_client import get_user_from_request

F = TypeVar("F", bound=Callable[..., Any])


def login_required(view: F) -> F:
    @wraps(view)
    def wrapped(*args: Any, **kwargs: Any):
        user = get_user_from_request()
        if user is None:
            g.current_user = None
            if _wants_json():
                return jsonify({"ok": False, "error": "No autenticado"}), 401
            return redirect(url_for("auth.login"))
        g.current_user = user
        return view(*args, **kwargs)

    return wrapped  # type: ignore[return-value]


def _wants_json() -> bool:
    if request.path.startswith("/api/"):
        return True
    accept = request.headers.get("Accept", "")
    return "application/json" in accept and "text/html" not in accept


def validate_payload(model):
    def decorator(view: F) -> F:
        @wraps(view)
        def wrapped(*args: Any, **kwargs: Any):
            raw = request.get_json(silent=True)
            if raw is None:
                raw = request.form.to_dict()
            try:
                payload = model.model_validate(raw)
            except ValidationError as exc:
                return jsonify({"ok": False, "error": "Datos inválidos", "details": exc.errors()}), 400
            return view(*args, payload=payload, **kwargs)

        return wrapped  # type: ignore[return-value]

    return decorator
