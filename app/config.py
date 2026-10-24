from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")


def _bool(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "on"}


class Config:
    SECRET_KEY = os.getenv("FLASK_SECRET_KEY")
    if not SECRET_KEY:
        raise RuntimeError("FLASK_SECRET_KEY is required")

    DEBUG = False
    TESTING = False
    PROPAGATE_EXCEPTIONS = False
    TEMPLATES_AUTO_RELOAD = False
    EXPLAIN_TEMPLATE_LOADING = False

    SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
    SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
    CLOUDINARY_URL = os.getenv("CLOUDINARY_URL", "")

    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError("SUPABASE_URL and SUPABASE_KEY are required")

    FORCE_HTTPS = _bool("FORCE_HTTPS", "true")
    COOKIE_SECURE = _bool("COOKIE_SECURE", "true")

    SESSION_COOKIE_NAME = "amircars_session"
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SECURE = COOKIE_SECURE
    SESSION_COOKIE_SAMESITE = "Strict"
    SESSION_COOKIE_PATH = "/"
    PERMANENT_SESSION_LIFETIME = 60 * 60 * 12

    JWT_ACCESS_COOKIE_NAME = "amircars_access"
    JWT_REFRESH_COOKIE_NAME = "amircars_refresh"
    JWT_COOKIE_HTTPONLY = True
    JWT_COOKIE_SECURE = COOKIE_SECURE
    JWT_COOKIE_SAMESITE = "Strict"
    JWT_COOKIE_PATH = "/"

    WTF_CSRF_ENABLED = True
    WTF_CSRF_TIME_LIMIT = 60 * 60 * 8
    WTF_CSRF_SSL_STRICT = COOKIE_SECURE
    WTF_CSRF_CHECK_DEFAULT = True
    WTF_CSRF_HEADERS = ["X-CSRFToken", "X-CSRF-Token"]
    WTF_CSRF_COOKIE_HTTPONLY = False
    WTF_CSRF_COOKIE_SECURE = COOKIE_SECURE
    WTF_CSRF_COOKIE_SAMESITE = "Strict"
    WTF_CSRF_COOKIE_NAME = "csrf_token"

    RATELIMIT_ENABLED = True
    RATELIMIT_STORAGE_URI = "memory://"
    RATELIMIT_HEADERS_ENABLED = True
    RATELIMIT_DEFAULT = "200 per minute"

    MAX_CONTENT_LENGTH = 6 * 1024 * 1024
    MAX_IMAGE_BYTES = 5 * 1024 * 1024
    ALLOWED_IMAGE_MIMES = ("image/jpeg", "image/png", "image/webp")

    SUPABASE_HOST = "lqhtbbkmkjoqyfzrofhh.supabase.co"
    CLOUDINARY_HOST = "res.cloudinary.com"
