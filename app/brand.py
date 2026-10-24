from __future__ import annotations

import os
import shutil
from pathlib import Path

from flask import Flask

NAMES = ("fondo", "logo")
EXTS = (".png", ".jpg", ".jpeg", ".webp")


def _desktop_candidates() -> list[Path]:
    home = Path(os.environ.get("USERPROFILE") or os.environ.get("HOME") or Path.home())
    known: list[Path] = []
    try:
        import ctypes
        from ctypes import wintypes

        buf = ctypes.create_unicode_buffer(wintypes.MAX_PATH)
        ctypes.windll.shell32.SHGetFolderPathW(None, 0x0000, None, 0, buf)
        if buf.value:
            known.append(Path(buf.value))
    except Exception:
        pass
    known.extend(
        [
            home / "Desktop",
            home / "Escritorio",
            home / "OneDrive" / "Desktop",
            home / "OneDrive" / "Escritorio",
        ]
    )
    unique: list[Path] = []
    seen: set[str] = set()
    for path in known:
        key = str(path)
        if key not in seen:
            seen.add(key)
            unique.append(path)
    return unique


def find_amircars_folder() -> Path | None:
    for desktop in _desktop_candidates():
        candidate = desktop / "amircars"
        if candidate.is_dir():
            return candidate
    return None


def copy_brand_assets(dest_dir: Path) -> dict[str, str]:
    dest_dir.mkdir(parents=True, exist_ok=True)
    source = find_amircars_folder()
    copied: dict[str, str] = {}
    if source is None:
        return copied
    for name in NAMES:
        for ext in EXTS:
            src = source / f"{name}{ext}"
            if not src.is_file():
                continue
            filename = f"{name}{ext.lower().replace('.jpeg', '.jpg')}"
            target = dest_dir / filename
            shutil.copy2(src, target)
            copied[name] = str(target)
            break
    return copied


def apply_brand_assets(app: Flask) -> None:
    dest = Path(app.static_folder) / "img" / "amircars"
    try:
        copy_brand_assets(dest)
    except Exception:
        app.logger.warning("No se pudieron copiar los activos de marca AMIRCARS")
