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
    if table == "tasas_bcv" and row.get("fecha"):
        row["fecha"] = str(row["fecha"])[:10]
    if table == "proveedores" and row.get("codigo_proveedor"):
        row["codigo_proveedor"] = str(row["codigo_proveedor"]).strip()
    return row


def _sort_items(items: list[SyncPushItem]) -> list[SyncPushItem]:
    rank = {name: index for index, name in enumerate(TABLE_ORDER)}
    return sorted(items, key=lambda item: (rank.get(item.table, 99), item.updated_at))


_UNIQUE_FALLBACK = {
    "tasas_bcv": "fecha",
    "proveedores": "codigo_proveedor",
    "preferencias_usuario": "user_id",
    "configuracion_sistema": "clave",
}


def _is_unique_conflict(exc: Exception) -> bool:
    message = str(exc).lower()
    return "duplicate" in message or "unique" in message or "23505" in message


def _is_fk_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return "foreign key" in message or "23503" in message


_NULLABLE_FKS = {
    "productos": ("categoria_id", "subcategoria_id", "proveedor_id"),
    "movimientos_inventario": ("proveedor_id",),
    "historico_ref": ("movimiento_id",),
}

_FK_COLS = ("categoria_id", "subcategoria_id", "proveedor_id", "producto_id")


def _can_soft_delete(table: str) -> bool:
    return table not in IMMUTABLE_TABLES and "is_active" in COLUMNS.get(table, ())


def _soft_delete(client, table: str, entity_id: str, row: dict[str, Any]) -> None:
    patch = {"is_active": False, "updated_at": row.get("updated_at") or utc_now()}
    client.table(table).update(patch).eq("id", entity_id).execute()


def _apply_delete(client, table: str, entity_id: str, row: dict[str, Any]) -> None:
    if _can_soft_delete(table):
        _soft_delete(client, table, entity_id, row)
        return
    try:
        client.table(table).delete().eq("id", entity_id).execute()
    except Exception as exc:
        if not _is_fk_error(exc):
            raise
        if not _can_soft_delete(table):
            raise
        _soft_delete(client, table, entity_id, row)


def _null_broken_fks(table: str, row: dict[str, Any], exc: Exception) -> bool:
    message = str(exc).lower()
    cols = _NULLABLE_FKS.get(table, ())
    changed = False
    for column in cols:
        if row.get(column) in (None, ""):
            continue
        if column in message or f"{table}_{column}" in message:
            row[column] = None
            changed = True
    if changed:
        return True
    for column in cols:
        if row.get(column) in (None, ""):
            continue
        row[column] = None
        changed = True
    return changed


def _rewrite_with_remaps(payload: dict[str, Any], remaps: list[dict[str, str]]) -> dict[str, Any]:
    row = dict(payload)
    for remap in remaps:
        frm = str(remap.get("from") or "").lower()
        to = str(remap.get("to") or "")
        if not frm or not to:
            continue
        for column in _FK_COLS:
            if str(row.get(column) or "").lower() == frm:
                row[column] = to
    return row


def _merge_on_unique(client, table: str, row: dict[str, Any]) -> str | None:
    column = _UNIQUE_FALLBACK.get(table)
    if not column or row.get(column) in (None, ""):
        return None
    existing = client.table(table).select("id").eq(column, row[column]).limit(1).execute()
    if not existing.data:
        return None
    target_id = existing.data[0]["id"]
    patch = {key: value for key, value in row.items() if key != "id"}
    client.table(table).update(patch).eq("id", target_id).execute()
    return str(target_id)


def apply_push(raw: dict[str, Any]) -> dict[str, Any]:
    try:
        body = SyncPushIn.model_validate(raw)
    except ValidationError as exc:
        return {"ok": False, "error": "Datos inválidos", "details": exc.errors()}, 400

    client = user_client()
    accepted: list[str] = []
    duplicates: list[str] = []
    rejected: list[dict[str, str]] = []
    remaps: list[dict[str, str]] = []

    for item in _sort_items(body.items):
        if item.table not in COLUMNS:
            rejected.append({"id": item.id, "error": "Tabla no permitida"})
            continue
        if any(remap["table"] == item.table and remap["from"] == item.id for remap in remaps):
            accepted.append(item.id)
            continue
        if item.table in IMMUTABLE_TABLES and item.op in {"update", "delete"}:
            duplicates.append(item.id)
            continue
        try:
            payload = _rewrite_with_remaps(item.payload, remaps)
            op = item.op
            if op == "delete" and _can_soft_delete(item.table):
                payload = {**payload, "is_active": False}
                op = "update"
            row = sanitize_row(item.table, payload, item.id)
            if op == "delete":
                _apply_delete(client, item.table, item.id, row)
                accepted.append(item.id)
                continue
            if item.table == "tasas_bcv" and row.get("fecha"):
                row["fecha"] = str(row["fecha"])[:10]
                target_id = _merge_on_unique(client, "tasas_bcv", row)
                if target_id:
                    accepted.append(item.id)
                    if target_id != item.id:
                        remaps.append({"table": "tasas_bcv", "from": item.id, "to": target_id})
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
                    if _is_fk_error(exc) and _null_broken_fks(item.table, row, exc):
                        client.table(item.table).insert(row).execute()
                        accepted.append(item.id)
                    elif _is_unique_conflict(exc):
                        duplicates.append(item.id)
                    else:
                        raise
                continue
            try:
                client.table(item.table).upsert(row, on_conflict="id").execute()
                accepted.append(item.id)
            except Exception as exc:
                if _is_fk_error(exc) and _null_broken_fks(item.table, row, exc):
                    client.table(item.table).upsert(row, on_conflict="id").execute()
                    accepted.append(item.id)
                    continue
                if not _is_unique_conflict(exc):
                    raise
                target_id = _merge_on_unique(client, item.table, row)
                if not target_id:
                    raise
                accepted.append(item.id)
                if target_id != item.id:
                    remaps.append({"table": item.table, "from": item.id, "to": target_id})
        except Exception as exc:
            rejected.append({"id": item.id, "error": str(exc)[:280]})

    return {
        "ok": True,
        "accepted": accepted,
        "duplicates": duplicates,
        "rejected": rejected,
        "remaps": remaps,
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
