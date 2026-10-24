import { healthCheck, pullChanges, pushQueue, refreshSession, uploadMediaBlob } from "./api.js";
import { flushCloudPurge } from "./archiveVault.js";
import { db, ENTITY_TABLES, PUSH_ORDER, getMeta, pendingCount, setMeta } from "./db.js";
import { applyRemoteRevision } from "./pwa.js";
import { enqueue, saveLocal } from "./repository.js";
import { bindRetry, setSyncStatus } from "./syncStatus.js";

const BATCH = 40;
const HEARTBEAT_MS = 25000;
const REFRESH_LEAD_MS = 5 * 60 * 1000;
let running = false;
let timer = null;

function isOnline() {
  return navigator.onLine;
}

function sessionNeedsRefresh() {
  const raw = document.cookie
    .split("; ")
    .find((part) => part.startsWith("amircars_session_exp="));
  if (!raw) {
    return true;
  }
  const value = decodeURIComponent(raw.slice("amircars_session_exp=".length));
  const expires = Date.parse(value);
  if (!Number.isFinite(expires)) {
    return true;
  }
  return expires - Date.now() < REFRESH_LEAD_MS;
}

async function ensureSession() {
  if (!sessionNeedsRefresh()) {
    return true;
  }
  const session = await refreshSession();
  return Boolean(session && session.ok);
}

async function applyRemaps(remaps) {
  for (const remap of remaps || []) {
    if (!remap || !remap.table || !remap.from || !remap.to || remap.from === remap.to) {
      continue;
    }
    if (!ENTITY_TABLES.includes(remap.table)) {
      continue;
    }
    const table = db.table(remap.table);
    const local = await table.get(remap.from);
    const remote = await table.get(remap.to);
    if (local && !remote) {
      await table.put({ ...local, id: remap.to });
    }
    if (local) {
      await table.delete(remap.from);
    }
    const queued = await db.sync_queue.where("entity_id").equals(remap.from).toArray();
    for (const row of queued) {
      await db.sync_queue.delete(row.id);
    }
  }
}

async function dropDuplicateTasas() {
  const rows = await db.tasas_bcv.toArray();
  const seen = new Map();
  for (const row of rows) {
    const fecha = String(row.fecha || "").slice(0, 10);
    if (!fecha) {
      continue;
    }
    const prev = seen.get(fecha);
    if (!prev) {
      seen.set(fecha, row);
      continue;
    }
    const keep = String(prev.updated_at || "") >= String(row.updated_at || "") ? prev : row;
    const drop = keep === prev ? row : prev;
    seen.set(fecha, keep);
    const queued = await db.sync_queue.where("entity_id").equals(drop.id).toArray();
    for (const item of queued) {
      await db.sync_queue.delete(item.id);
    }
    await db.tasas_bcv.delete(drop.id);
  }
}

async function refreshOfflineBadge() {
  const counts = await pendingCount();
  if (!isOnline()) {
    setSyncStatus("offline", counts.total > 0 ? String(counts.total) : "");
    return counts;
  }
  if (counts.total > 0) {
    setSyncStatus("pending", String(counts.total));
  } else {
    setSyncStatus("connected");
  }
  return counts;
}

async function flushMedia() {
  const pending = await db.offline_media_queue.orderBy("created_at").toArray();
  for (const item of pending) {
    const result = await uploadMediaBlob(item.blob, item.filename, item.id);
    if (!result.ok || !result.data || !result.data.ok) {
      await db.offline_media_queue.update(item.id, {
        attempts: (item.attempts || 0) + 1,
        last_error: (result.data && result.data.error) || `HTTP ${result.status}`,
      });
      if (result.status === 0 || result.status >= 500 || result.status === 503) {
        throw new Error(item.last_error || "Fallo subiendo imagen");
      }
      continue;
    }
    const imageRow = {
      id: item.id,
      producto_id: item.producto_id,
      cloudinary_url: result.data.url,
      cloudinary_public_id: result.data.public_id,
      alt_text: item.alt_text || "",
      orden: item.orden || 0,
      is_cover: Boolean(item.is_cover),
      is_active: true,
      thumbnail_url: result.data.thumbnail_url,
    };
    const exists = await db.producto_imagenes.get(item.id);
    await saveLocal("producto_imagenes", imageRow, exists ? "update" : "insert");
    await db.offline_media_queue.delete(item.id);
  }
}

function rank(table) {
  const index = PUSH_ORDER.indexOf(table);
  return index < 0 ? 99 : index;
}

async function flushQueue() {
  const all = await db.sync_queue.orderBy("created_at").toArray();
  all.sort((a, b) => rank(a.table) - rank(b.table));
  for (let offset = 0; offset < all.length; offset += BATCH) {
    const slice = all.slice(offset, offset + BATCH);
    const items = slice.map((row) => ({
      id: row.entity_id,
      table: row.table,
      op: row.op,
      payload: row.payload,
      updated_at: row.updated_at,
    }));
    const result = await pushQueue(items);
    if (!result.ok || !result.data) {
      throw new Error((result.data && result.data.error) || `Push HTTP ${result.status}`);
    }
    await applyRemaps(result.data.remaps || []);
    const done = new Set([...(result.data.accepted || []), ...(result.data.duplicates || [])]);
    const rejected = new Map((result.data.rejected || []).map((row) => [row.id, row.error]));
    for (const row of slice) {
      if (done.has(row.entity_id)) {
        await db.sync_queue.delete(row.id);
      } else if (rejected.has(row.entity_id)) {
        const err = String(rejected.get(row.entity_id) || "");
        if (/23505|duplicate|unique/i.test(err) && row.table === "tasas_bcv") {
          await db.sync_queue.delete(row.id);
          continue;
        }
        await db.sync_queue.update(row.id, {
          attempts: (row.attempts || 0) + 1,
          last_error: err,
        });
      }
    }
    if ((result.data.rejected || []).length && done.size === 0) {
      const detail = (result.data.rejected[0] && result.data.rejected[0].error) || "";
      throw new Error(detail || "El servidor rechazó el lote de sincronización");
    }
  }
}

async function mergePull(tables) {
  const queued = await db.sync_queue.toArray();
  const blocked = new Set(queued.map((row) => `${row.table}:${row.entity_id}`));
  const archived = (await getMeta("archived_ids", {})) || {};
  for (const table of ENTITY_TABLES) {
    const rows = (tables && tables[table]) || [];
    const gone = new Set(archived[table] || []);
    for (const row of rows) {
      if (!row || !row.id) {
        continue;
      }
      if (gone.has(row.id) || blocked.has(`${table}:${row.id}`)) {
        continue;
      }
      const local = await db.table(table).get(row.id);
      if (local && local.updated_at && row.updated_at && local.updated_at > row.updated_at) {
        continue;
      }
      await db.table(table).put(row);
    }
  }
}

async function pullRemote() {
  const since = await getMeta("last_pull_at", null);
  const result = await pullChanges(since);
  if (!result.ok || !result.data || !result.data.ok) {
    throw new Error((result.data && result.data.error) || `Pull HTTP ${result.status}`);
  }
  await mergePull(result.data.tables);
  await dropDuplicateTasas();
  if (result.data.server_time) {
    await setMeta("last_pull_at", result.data.server_time);
  }
}

export async function runSync(force = false) {
  if (running) {
    return;
  }
  if (!isOnline() && !force) {
    await refreshOfflineBadge();
    return;
  }
  running = true;
  setSyncStatus("syncing");
  try {
    const alive = await healthCheck();
    if (!alive) {
      throw new Error("Sin heartbeat");
    }
    const sessionOk = await ensureSession();
    if (!sessionOk) {
      throw new Error("Sesión expirada; vuelva a entrar.");
    }
    await flushMedia();
    await flushQueue();
    await pullRemote();
    await flushCloudPurge();
    await applyRemoteRevision();
    const leftover = await pendingCount();
    if (leftover.total > 0) {
      setSyncStatus("pending", String(leftover.total));
    } else {
      setSyncStatus("connected");
    }
  } catch (_err) {
    const counts = await pendingCount();
    if (!isOnline()) {
      setSyncStatus("offline", counts.total > 0 ? String(counts.total) : "");
    } else if (counts.total > 0) {
      setSyncStatus("retry");
    } else {
      setSyncStatus("connected");
    }
  } finally {
    running = false;
  }
}

export function startSyncEngine() {
  bindRetry(() => {
    runSync(true);
  });
  window.addEventListener("online", () => {
    runSync(true);
  });
  window.addEventListener("offline", () => {
    refreshOfflineBadge();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      runSync(true);
    }
  });
  if (timer) {
    clearInterval(timer);
  }
  timer = setInterval(() => {
    runSync(false);
  }, HEARTBEAT_MS);
  refreshOfflineBadge().then(() => runSync(true));
}

export { enqueue };
