from __future__ import annotations

import io
from typing import BinaryIO

import filetype
from PIL import Image, UnidentifiedImageError
from werkzeug.datastructures import FileStorage

ALLOWED_MIMES = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_EXTS = {"jpg", "jpeg", "png", "webp"}
MAX_IMAGE_BYTES = 5 * 1024 * 1024

_MAGIC_PREFIXES = (
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"RIFF", "image/webp"),
)


class ImageValidationError(ValueError):
    pass


def _sniff_magic(header: bytes) -> str | None:
    for prefix, mime in _MAGIC_PREFIXES:
        if header.startswith(prefix):
            if mime == "image/webp" and (len(header) < 12 or header[8:12] != b"WEBP"):
                return None
            return mime
    kind = filetype.guess(header)
    if kind and kind.mime in ALLOWED_MIMES:
        return kind.mime
    return None


def validate_image_file(file: FileStorage, max_bytes: int = MAX_IMAGE_BYTES) -> bytes:
    if file is None or not file.filename:
        raise ImageValidationError("No se recibió archivo de imagen")

    filename = (file.filename or "upload.bin").lower()
    ext = filename.rsplit(".", 1)[-1] if "." in filename else ""

    raw = file.read(max_bytes + 1)
    if len(raw) > max_bytes:
        raise ImageValidationError("La imagen supera 5MB")
    if len(raw) < 24:
        raise ImageValidationError("Archivo demasiado pequeño o vacío")

    mime = _sniff_magic(raw[:16])
    if mime not in ALLOWED_MIMES:
        raise ImageValidationError("Magic bytes inválidos: solo JPEG, PNG o WEBP")
    if ext and ext not in ALLOWED_EXTS:
        raise ImageValidationError("Extensión no permitida")

    try:
        image = Image.open(io.BytesIO(raw))
        image.verify()
    except (UnidentifiedImageError, OSError) as exc:
        raise ImageValidationError("El contenido no es una imagen válida") from exc

    if image.format not in {"JPEG", "PNG", "WEBP"}:
        raise ImageValidationError("Formato de imagen no autorizado")

    return raw


def validate_image_stream(stream: BinaryIO, max_bytes: int = MAX_IMAGE_BYTES) -> bytes:
    storage = FileStorage(stream=stream, filename="upload.bin")
    return validate_image_file(storage, max_bytes=max_bytes)
