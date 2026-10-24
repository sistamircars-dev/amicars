from __future__ import annotations

import re
from typing import Any, Optional

from flask import current_app, request
from gotrue import SyncMemoryStorage
from supabase import Client, create_client
from supabase._sync.client import SyncClient
from supabase.lib.client_options import SyncClientOptions

# supabase-py 2.9 only accepts JWT-shaped keys. Publishable keys (sb_publishable_…)
# are valid on Auth and PostgREST; 2.16 dropped this local check.
_JWT_KEY = re.compile(r"^[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$")


def _create_supabase_client(url: str, key: str) -> Client:
    key = key.strip()
    if _JWT_KEY.fullmatch(key):
        return create_client(url, key)

    options = SyncClientOptions(storage=SyncMemoryStorage())
    client = SyncClient.__new__(SyncClient)
    client.supabase_url = url
    client.supabase_key = key
    client.options = options
    client.rest_url = f"{url}/rest/v1"
    client.realtime_url = f"{url}/realtime/v1".replace("http", "ws")
    client.auth_url = f"{url}/auth/v1"
    client.storage_url = f"{url}/storage/v1"
    client.functions_url = f"{url}/functions/v1"
    options.headers.update(
        {
            "apiKey": key,
            "Authorization": f"Bearer {key}",
        }
    )
    client.auth = SyncClient._init_supabase_auth_client(
        auth_url=client.auth_url,
        client_options=options,
    )
    client.realtime = SyncClient._init_realtime_client(
        realtime_url=client.realtime_url,
        supabase_key=key,
        options=options.realtime,
    )
    client._postgrest = None
    client._storage = None
    client._functions = None
    client.auth.on_auth_state_change(client._listen_to_auth_events)
    try:
        session = client.auth.get_session()
        access = client._create_auth_header(session.access_token) if session else None
    except Exception:
        access = None
    client.options.headers.update(client._get_auth_headers(access))
    return client


def make_client(access_token: Optional[str] = None) -> Client:
    client = _create_supabase_client(
        current_app.config["SUPABASE_URL"],
        current_app.config["SUPABASE_KEY"],
    )
    if access_token:
        client.postgrest.auth(access_token)
    return client


def read_access_token() -> Optional[str]:
    token = request.cookies.get(current_app.config["JWT_ACCESS_COOKIE_NAME"])
    if token:
        return token
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        return header[7:].strip() or None
    return None


def get_user_from_request() -> Optional[dict[str, Any]]:
    token = read_access_token()
    if not token:
        return None
    try:
        client = make_client(token)
        result = client.auth.get_user(token)
        user = getattr(result, "user", None)
        if user is None:
            return None
        return {
            "id": str(user.id),
            "email": user.email,
            "role": getattr(user, "role", None) or "authenticated",
            "access_token": token,
        }
    except Exception:
        return None


def user_client() -> Client:
    token = read_access_token()
    return make_client(token)
