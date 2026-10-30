from __future__ import annotations

import io
from typing import Any
from urllib.parse import unquote, urlparse

import cloudinary
import cloudinary.uploader
from cloudinary.utils import cloudinary_url
from flask import current_app

FOLDER = "amircars/repuestos"


_PLACEHOLDERS = {
    "",
    "api_key",
    "api_secret",
    "cloud_name",
    "your_api_key",
    "your_api_secret",
    "your_cloud_name",
    "<your_api_key>",
    "<your_api_secret>",
    "<your_cloud_name>",
    "<cloud_name>",
}


def _clean(value: str | None) -> str:
    text = (value or "").strip().strip('"').strip("'")
    upper = text.upper()
    for prefix in (
        "CLOUDINARY_URL=",
        "CLOUDINARY_API_KEY=",
        "CLOUDINARY_API_SECRET=",
        "CLOUDINARY_CLOUD_NAME=",
        "CLOUD_NAME=",
        "API_KEY=",
        "API_SECRET=",
    ):
        if upper.startswith(prefix):
            text = text.split("=", 1)[1].strip().strip('"').strip("'")
            break
    text = text.replace("\n", "").replace("\r", "").strip()
    folded = text.lower().strip("<>").strip()
    if folded in _PLACEHOLDERS or folded.startswith("your_") or folded.startswith("<your_"):
        return ""
    return text


def _parse_url(url: str) -> dict[str, str]:
    raw = _clean(url)
    if not raw.startswith("cloudinary://"):
        return {}
    parsed = urlparse(raw)
    name = (parsed.hostname or "").strip()
    key = unquote(parsed.username or "").strip()
    secret = unquote(parsed.password or "").strip()
    if name and key and secret:
        return {"cloud_name": name, "api_key": key, "api_secret": secret}
    return {}


def cloudinary_settings() -> dict[str, str]:
    url = _clean(current_app.config.get("CLOUDINARY_URL"))
    name = _clean(current_app.config.get("CLOUDINARY_CLOUD_NAME"))
    key = _clean(current_app.config.get("CLOUDINARY_API_KEY"))
    secret = _clean(current_app.config.get("CLOUDINARY_API_SECRET"))
    from_url = _parse_url(url)
    if from_url:
        name = from_url["cloud_name"]
        key = from_url["api_key"]
        secret = from_url["api_secret"]
    elif url and not url.startswith("cloudinary://") and "://" not in url and len(url) >= 16 and not secret:
        secret = url
    if key and secret and (not key.isdigit()) and secret.isdigit() and len(secret) >= 10:
        key, secret = secret, key
    if name and key and secret:
        return {"cloud_name": name, "api_key": key, "api_secret": secret}
    return {}


def cloudinary_ready() -> bool:
    cfg = cloudinary_settings()
    return bool(cfg.get("cloud_name") and cfg.get("api_key") and cfg.get("api_secret"))


def _configure() -> dict[str, str]:
    settings = cloudinary_settings()
    if not settings:
        raise RuntimeError("Cloudinary no está configurada en el servidor")
    cloudinary.config(
        cloud_name=settings["cloud_name"],
        api_key=settings["api_key"],
        api_secret=settings["api_secret"],
        secure=True,
    )
    return settings


def list_folder_images(max_results: int = 500) -> list[dict[str, Any]]:
    _configure()
    import cloudinary.api

    out: list[dict[str, Any]] = []
    next_cursor = None
    while len(out) < max_results:
        kwargs: dict[str, Any] = {
            "type": "upload",
            "prefix": FOLDER,
            "max_results": min(100, max_results - len(out)),
            "resource_type": "image",
        }
        if next_cursor:
            kwargs["next_cursor"] = next_cursor
        result = cloudinary.api.resources(**kwargs)
        for row in result.get("resources") or []:
            ctx = row.get("context") or {}
            if isinstance(ctx, dict):
                ctx = ctx.get("custom") or ctx
            out.append(
                {
                    "public_id": row.get("public_id"),
                    "url": row.get("secure_url") or row.get("url"),
                    "bytes": row.get("bytes"),
                    "created_at": row.get("created_at"),
                    "context": ctx,
                }
            )
        next_cursor = result.get("next_cursor")
        if not next_cursor:
            break
    return out


def upload_image_bytes(
    raw: bytes, public_id: str | None = None, context: str | None = None
) -> dict[str, Any]:
    _configure()
    options: dict[str, Any] = {
        "resource_type": "image",
        "unique_filename": True,
        "use_filename": False,
        "overwrite": False,
        "invalidate": False,
        "folder": FOLDER,
    }
    if context:
        options["context"] = context
    if public_id:
        cleaned = public_id.strip().lstrip("/")
        if cleaned.startswith(f"{FOLDER}/"):
            options.pop("folder", None)
            options["public_id"] = cleaned
        else:
            options["public_id"] = cleaned.split("/")[-1]
        options["unique_filename"] = False
        options["overwrite"] = True
        options["invalidate"] = True
    stream = io.BytesIO(raw)
    stream.name = "pieza.jpg"
    result = cloudinary.uploader.upload(stream, **options)
    pid = result["public_id"]
    thumb, _ = cloudinary_url(
        pid,
        secure=True,
        fetch_format="auto",
        quality="auto",
        width=300,
        crop="limit",
    )
    full, _ = cloudinary_url(pid, secure=True, fetch_format="auto", quality="auto")
    return {
        "public_id": pid,
        "url": full,
        "thumbnail_url": thumb,
        "bytes": result.get("bytes"),
        "format": result.get("format"),
        "width": result.get("width"),
        "height": result.get("height"),
    }


def destroy_image(public_id: str) -> bool:
    if not public_id:
        return False
    _configure()
    result = cloudinary.uploader.destroy(public_id, invalidate=True, resource_type="image")
    return str(result.get("result") or "").lower() in {"ok", "not found"}
