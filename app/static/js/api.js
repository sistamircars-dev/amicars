import { getCsrfToken } from "./csrf.js";

async function request(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const csrf = getCsrfToken();
  if (csrf) {
    headers.set("X-CSRFToken", csrf);
  }
  if (options.json !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Accept", "application/json");
  const init = {
    method: options.method || "GET",
    credentials: "same-origin",
    headers,
    cache: "no-store",
  };
  if (options.json !== undefined) {
    init.body = JSON.stringify(options.json);
  } else if (options.body) {
    init.body = options.body;
  }
  const response = await fetch(url, init);
  let data = null;
  const text = await response.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_err) {
      data = { ok: false, error: "Respuesta no JSON" };
    }
  }
  return { ok: response.ok, status: response.status, data };
}

async function requestAuth(url, options = {}) {
  let result = await request(url, options);
  if (result.status !== 401) {
    return result;
  }
  const renewed = await refreshSession();
  if (!renewed.ok) {
    return result;
  }
  return request(url, options);
}

export async function healthCheck() {
  try {
    const result = await request("/api/health");
    return result.ok && result.data && result.data.ok === true;
  } catch (_err) {
    return false;
  }
}

export async function runtimeInfo() {
  try {
    const result = await request("/api/health");
    if (result.ok && result.data && result.data.ok === true) {
      return result.data;
    }
  } catch (_err) {
    /* Sin red se usa la revisión local. */
  }
  return null;
}

export async function refreshSession() {
  try {
    return await request("/api/auth/refresh", { method: "POST", json: {} });
  } catch (_err) {
    return { ok: false, status: 0, data: { ok: false } };
  }
}

export async function purgeArchived(items) {
  return requestAuth("/api/archive/purge", { method: "POST", json: { items } });
}

export async function pushQueue(items) {
  return requestAuth("/api/sync/push", { method: "POST", json: { items } });
}

export async function pullChanges(since) {
  const query = since ? `?since=${encodeURIComponent(since)}` : "";
  return requestAuth(`/api/sync/pull${query}`);
}

export async function uploadMediaBlob(blob, filename, imageId = null, productoId = null) {
  const form = new FormData();
  const csrf = getCsrfToken();
  if (csrf) {
    form.append("csrf_token", csrf);
  }
  form.append("file", blob, filename || "pieza.jpg");
  if (imageId) {
    form.append("image_id", imageId);
  }
  if (productoId) {
    form.append("producto_id", productoId);
  }
  return requestAuth("/api/media/upload", { method: "POST", body: form });
}

export async function restoreCloudPhotos() {
  return requestAuth("/api/media/restore-cloud", { method: "POST", json: {} });
}

export async function publishPhotoIndex(items) {
  return requestAuth("/api/media/index", { method: "POST", json: { items } });
}

export async function fetchPhotoIndex() {
  return requestAuth("/api/media/index");
}

export async function fetchBcvToday() {
  return request("/api/bcv/hoy");
}

export async function fetchBcvDate(fecha) {
  return request(`/api/bcv/fecha?fecha=${encodeURIComponent(fecha)}`);
}
