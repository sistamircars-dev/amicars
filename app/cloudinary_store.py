from __future__ import annotations

import io
from typing import Any

import cloudinary
import cloudinary.uploader
from cloudinary.utils import cloudinary_url
from flask import current_app

FOLDER = "amircars/repuestos"


def _clean(value: str | None) -> str:
    return (value or "").strip().strip('"').strip("'")


def cloudinary_settings() -> dict[str, str]:
    url = _clean(current_app.config.get("CLOUDINARY_URL"))
    name = _clean(current_app.config.get("CLOUDINARY_CLOUD_NAME"))
    key = _clean(current_app.config.get("CLOUDINARY_API_KEY"))
    secret = _clean(current_app.config.get("CLOUDINARY_API_SECRET"))
    if url.startswith("cloudinary://") and "@" in url:
        return {"cloudinary_url": url}
    if name and key and secret:
        return {"cloud_name": name, "api_key": key, "api_secret": secret}
    return {}


def cloudinary_ready() -> bool:
    return bool(cloudinary_settings())


def _configure() -> None:
    settings = cloudinary_settings()
    if not settings:
        raise RuntimeError("Cloudinary no está configurada en el servidor")
    cloudinary.config(secure=True, **settings)


def upload_image_bytes(raw: bytes, public_id: str | None = None) -> dict[str, Any]:
    _configure()
    options: dict[str, Any] = {
        "resource_type": "image",
        "unique_filename": True,
        "use_filename": False,
        "overwrite": False,
        "invalidate": False,
        "folder": FOLDER,
    }
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
    result = cloudinary.uploader.upload(io.BytesIO(raw), **options)
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
