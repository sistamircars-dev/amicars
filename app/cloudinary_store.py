from __future__ import annotations

import io
from typing import Any

import cloudinary
import cloudinary.uploader
from cloudinary.utils import cloudinary_url
from flask import current_app


def cloudinary_ready() -> bool:
    return bool(current_app.config.get("CLOUDINARY_URL"))


def _configure() -> None:
    url = current_app.config.get("CLOUDINARY_URL") or ""
    if not url:
        raise RuntimeError("CLOUDINARY_URL no está configurada")
    cloudinary.config(cloudinary_url=url, secure=True)


def upload_image_bytes(raw: bytes, public_id: str | None = None) -> dict[str, Any]:
    _configure()
    options: dict[str, Any] = {
        "folder": "amircars/repuestos",
        "resource_type": "image",
        "unique_filename": True,
        "use_filename": False,
        "overwrite": False,
        "invalidate": False,
    }
    if public_id:
        options["public_id"] = public_id
        options["unique_filename"] = False
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
