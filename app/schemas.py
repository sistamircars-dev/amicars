from __future__ import annotations

import re
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class LoginIn(StrictModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)

    @field_validator("password")
    @classmethod
    def password_not_blank(cls, value: str) -> str:
        if not value or value.isspace():
            raise ValueError("La contraseña es obligatoria")
        return value


class HealthOut(StrictModel):
    ok: bool
    status: Literal["online"]
    service: str
    revision: str = "43"


class ArchivePurgeItem(StrictModel):
    table: str = Field(min_length=1, max_length=64)
    id: str
    cloudinary_public_id: Optional[str] = None

    @field_validator("id")
    @classmethod
    def valid_uuid(cls, value: str) -> str:
        if not _UUID_RE.match(value):
            raise ValueError("id debe ser UUID v4")
        return value.lower()

    @field_validator("table")
    @classmethod
    def table_ident(cls, value: str) -> str:
        if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", value):
            raise ValueError("Nombre de tabla inválido")
        return value


class ArchivePurgeIn(StrictModel):
    items: list[ArchivePurgeItem] = Field(default_factory=list, max_length=400)


class SyncPushItem(StrictModel):
    id: str
    table: str = Field(min_length=1, max_length=64)
    op: Literal["insert", "update", "delete"]
    payload: dict[str, Any]
    updated_at: str

    @field_validator("id")
    @classmethod
    def valid_uuid(cls, value: str) -> str:
        if not _UUID_RE.match(value):
            raise ValueError("id debe ser UUID v4")
        return value.lower()

    @field_validator("table")
    @classmethod
    def table_ident(cls, value: str) -> str:
        if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", value):
            raise ValueError("Nombre de tabla inválido")
        return value


class SyncPushIn(StrictModel):
    items: list[SyncPushItem] = Field(default_factory=list, max_length=500)


class SyncPullIn(StrictModel):
    since: Optional[str] = None
    tables: Optional[list[str]] = None
