from __future__ import annotations

from datetime import date, datetime
from typing import Any

import httpx

TODAY_URL = "https://bcv.today/api/v1/rate.json"
HISTORY_URL = "https://bcv.today/api/v1/history/{fecha}.json"
TIMEOUT = 12.0
HEADERS = {
    "Accept": "application/json",
    "Cache-Control": "no-cache",
    "User-Agent": "amircars",
}


class BcvError(RuntimeError):
    pass


def _usd(payload: dict[str, Any]) -> float:
    value = payload.get("USD")
    if value is None:
        value = payload.get("usd")
    try:
        rate = float(value)
    except (TypeError, ValueError) as exc:
        raise BcvError("La respuesta de tasa no contiene el dólar oficial") from exc
    if rate <= 0:
        raise BcvError("La respuesta de tasa no contiene un monto válido")
    return rate


def _fecha(payload: dict[str, Any], fallback: str) -> str:
    raw = str(payload.get("effective_date") or payload.get("date") or fallback)
    return raw[:10]


def _normalize(payload: dict[str, Any], fallback_fecha: str) -> dict[str, Any]:
    fecha = _fecha(payload, fallback_fecha)
    rate = _usd(payload)
    return {
        "fecha": fecha,
        "usd_ves": rate,
        "fuente": "BCV",
        "raw": {
            "USD": payload.get("USD"),
            "EUR": payload.get("EUR"),
            "effective_date": payload.get("effective_date"),
            "date": payload.get("date"),
        },
    }


def _fetch_json(url: str) -> Any:
    try:
        response = httpx.get(url, timeout=TIMEOUT, headers=HEADERS, follow_redirects=True)
    except Exception as exc:
        raise BcvError("No se pudo obtener la tasa BCV") from exc
    if response.status_code == 404:
        return None
    try:
        response.raise_for_status()
        return response.json()
    except Exception as exc:
        raise BcvError("No se pudo obtener la tasa BCV") from exc


def fetch_bcv_today() -> dict[str, Any]:
    data = _fetch_json(TODAY_URL)
    if not isinstance(data, dict):
        raise BcvError("Formato inesperado de tasa BCV")
    today = date.today().isoformat()
    return _normalize(data, today)


def fetch_bcv_by_date(value: date) -> dict[str, Any]:
    data = _fetch_json(HISTORY_URL.format(fecha=value.isoformat()))
    if data is None:
        raise BcvError(f"No se encontró tasa BCV para {value.isoformat()}")
    if not isinstance(data, dict):
        raise BcvError(f"Sin cotización oficial para {value.isoformat()}")
    return _normalize(data, value.isoformat())


def parse_iso_date(raw: str) -> date:
    try:
        return datetime.strptime(raw.strip(), "%Y-%m-%d").date()
    except ValueError as exc:
        raise BcvError("Fecha inválida. Use YYYY-MM-DD") from exc
