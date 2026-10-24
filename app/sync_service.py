from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from flask import g
from pydantic import ValidationError

from app.schemas import SyncPushIn, SyncPushItem
from app.supabase_client import user_client
from app.sync_tables import COLUMNS, IMMUTABLE_TABLES, STRIP_ON_PUSH, TABLE_ORDER

_PULL_LIMIT = 1000


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _user_id() -> str:
    return str(g.current_user["id"])


def sanitize_row(table: str, payload: dict[str, Any], entity_id: str) -> dict[str, Any]:
    allowed = COLUMNS[table]
    row = {key: payload[key] for key in payload if key in allowed}
    row["id"] = entity_id
    row["updated_at"] = payload.get("updated_at") or utc_now()
    if "is_active" not in row:
        row["is_active"] = True
    if "created_by" in allowed:
        row["created_by"] = _user_id()
    if table == "preferencias_usuario":
        row["user_id"] = _user_id()
    for dropped in STRIP_ON_PUSH.get(table, ()):
        row.pop(dropped, None)
    return row


def _sort_items(items: list[SyncPushItem]) -> list[SyncPushItem]:
    rank = {name: index for index, name in enumerate(TABLE_ORDER)}
    return sorted(items, key=lambda item: (rank.get(item.table, 99), item.updated_at))


def apply_push(raw: dict[str, Any]) -> dict[str, Any]:
    try:
        body = SyncPushIn.model_validate(raw)
    except ValidationError as exc:
        return {"ok": False, "error": "Datos inválidos", "details": exc.errors()}, 400

    client = user_client()
    accepted: list[str] = []
    duplicates: list[str] = []
    rejected: list[dict[str, str]] = []

    for item in _sort_items(body.items):
        if item.table not in COLUMNS:
            rejected.append({"id": item.id, "error": "Tabla no permitida"})
            continue
        if item.table in IMMUTABLE_TABLES and item.op in {"update", "delete"}:
            rejected.append({"id": item.id, "error": "Bitácora inmutable"})
            continue
        try:
            row = sanitize_row(item.table, item.payload, item.id)
            if item.op == "delete":
                if item.table in IMMUTABLE_TABLES:
                    rejected.append({"id": item.id, "error": "Bitácora inmutable"})
                    continue
                client.table(item.table).delete().eq("id", item.id).execute()
                accepted.append(item.id)
                continue
            if item.table in IMMUTABLE_TABLES:
                existing = (
                    client.table(item.table).select("id").eq("id", item.id).limit(1).execute()
                )
                if existing.data:
                    duplicates.append(item.id)
                    continue
                try:
                    client.table(item.table).insert(row).execute()
                    accepted.append(item.id)
                except Exception as exc:
                    message = str(exc).lower()
                    if "duplicate" in message or "unique" in message or "23505" in message:
                        duplicates.append(item.id)
                    else:
                        raise
                continue
            client.table(item.table).upsert(row, on_conflict="id").execute()
            accepted.append(item.id)
        except Exception as exc:
            rejected.append({"id": item.id, "error": str(exc)[:280]})

    progressed = len(accepted) + len(duplicates)
    return {
        "ok": progressed > 0 or not body.items,
        "accepted": accepted,
        "duplicates": duplicates,
        "rejected": rejected,
        "server_time": utc_now(),
    }, 200


def apply_pull(since: str | None) -> dict[str, Any]:
    client = user_client()
    tables: dict[str, list[dict[str, Any]]] = {}
    truncated: list[str] = []
    for name in TABLE_ORDER:
        query = client.table(name).select("*")
        if since:
            query = query.gte("updated_at", since)
        query = query.order("updated_at").limit(_PULL_LIMIT)
        result = query.execute()
        rows = result.data or []
        tables[name] = rows
        if len(rows) >= _PULL_LIMIT:
            truncated.append(name)
    return {
        "ok": True,
        "tables": tables,
        "truncated": truncated,
        "server_time": utc_now(),
        "since": since,
    }
