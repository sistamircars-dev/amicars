from __future__ import annotations

from pathlib import PurePosixPath

from flask import Flask, Response

_BLOCKED_NAMES = {
    ".env",
    ".env.example",
    ".flaskenv",
    ".git",
    ".gitignore",
    ".gitattributes",
    "procfile",
    "runtime.txt",
    "requirements.txt",
    "gunicorn.conf.py",
    "wsgi.py",
    "dockerfile",
}

_BLOCKED_SUFFIXES = (
    ".py",
    ".pyc",
    ".pyo",
    ".pyd",
    ".env",
    ".git",
    ".map",
    ".sql",
    ".toml",
    ".ini",
    ".cfg",
)

_BLOCKED_PARTS = {
    ".git",
    ".github",
    "__pycache__",
    "app",
    "sql",
    "venv",
    ".venv",
}


def is_blocked_path(path: str) -> bool:
    normalized = path.replace("\\", "/")
    posix = PurePosixPath(normalized.lower())
    parts = [p for p in posix.parts if p not in ("/", "")]
    if not parts:
        return False
    if any(part in _BLOCKED_PARTS or part.startswith(".") for part in parts):
        if parts[0] == "static" and not any(
            p in {".git", "__pycache__", ".venv", "venv"} or p.startswith(".")
            for p in parts[1:]
        ):
            return posix.suffix in _BLOCKED_SUFFIXES
        if parts[0] != "static":
            if any(
                p in {".git", "__pycache__", ".venv", "venv"} or p.endswith(".py")
                for p in parts
            ):
                return True
    name = posix.name.lower()
    if name in _BLOCKED_NAMES:
        return True
    if posix.suffix.lower() in _BLOCKED_SUFFIXES:
        if not normalized.startswith("/static/"):
            return True
        if posix.suffix.lower() in {".py", ".map", ".env", ".sql", ".pyc"}:
            return True
    return False


def register_csp(app: Flask) -> dict:
    supabase = f"https://{app.config['SUPABASE_HOST']}"
    cloudinary = f"https://{app.config['CLOUDINARY_HOST']}"
    policy = {
        "default-src": "'self'",
        "base-uri": "'self'",
        "object-src": "'none'",
        "frame-ancestors": "'none'",
        "form-action": "'self'",
        "script-src": "'self'",
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:", "blob:", cloudinary],
        "font-src": "'self'",
        "connect-src": ["'self'", supabase, cloudinary],
        "media-src": ["'self'", "blob:", cloudinary],
        "worker-src": ["'self'", "blob:"],
        "manifest-src": "'self'",
    }
    if app.config["FORCE_HTTPS"]:
        policy["upgrade-insecure-requests"] = ""
    return policy


def apply_security_headers(app: Flask, response: Response) -> Response:
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Permitted-Cross-Domain-Policies"] = "none"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = (
        "accelerometer=(), camera=(), geolocation=(), gyroscope=(), "
        "magnetometer=(), microphone=(), payment=(), usb=()"
    )
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
    if app.config["FORCE_HTTPS"]:
        response.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains; preload"
        )
    response.headers.pop("X-Powered-By", None)
    response.headers.pop("Server", None)
    if "text/html" in (response.mimetype or ""):
        response.headers["Cache-Control"] = "no-store, max-age=0"
        response.headers["Pragma"] = "no-cache"
    return response
