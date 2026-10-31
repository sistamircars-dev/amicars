"""CLI: copia logo y fondo desde el Escritorio hacia static/img/jdparfum/."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.brand import copy_brand_assets  # noqa: E402

if __name__ == "__main__":
    dest = ROOT / "app" / "static" / "img" / "jdparfum"
    result = copy_brand_assets(dest)
    if not result:
        print("No se encontró la carpeta jdparfum en el Escritorio.")
    else:
        for key, path in result.items():
            print(f"{key} -> {path}")
