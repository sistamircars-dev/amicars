import { healthCheck, pullChanges, pushQueue, refreshSession, uploadMediaBlob } from "./api.js";
import { flushCloudPurge } from "./archiveVault.js";
import { db, ENTITY_TABLES, PUSH_ORDER, getMeta, pendingCount, setMeta } from "./db.js";
import { applyRemoteRevision } from "./pwa.js";
import { enqueue, saveLocal } from "./repository.js";
import { bindRetry, setSyncStatus } from "./syncStatus.js";

const BATCH = 40;
const HEARTBEAT_MS = 25000;
let running = false;
let timer = null;

function isOnline() {
  return navigator.onLine;
}

async function refreshOfflineBadge() {
  const counts = await pendingCount();
  if (!isOnline()) {
    setSyncStatus("offline", String(counts.total));
    return counts;
  }
  if (counts.total > 0) {
    setSyncStatus("retry");
  } else {
    setSyncStatus("synced");
  }
  return counts;
}

async function flushMedia() {
  const pending = await db.offline_media_queue.orderBy("created_at").toArray();
  for (const item of pending) {
    const result = await uploadMediaBlob(item.blob, item.filename);
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
    await saveLocal("producto_imagenes", imageRow, "insert");
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
    const done = new Set([...(result.data.accepted || []), ...(result.data.duplicates || [])]);
    const rejected = new Map((result.data.rejected || []).map((row) => [row.id, row.error]));
    for (const row of slice) {
      if (done.has(row.entity_id)) {
        await db.sync_queue.delete(row.id);
      } else if (rejected.has(row.entity_id)) {
        await db.sync_queue.update(row.id, {
          attempts: (row.attempts || 0) + 1,
          last_error: rejected.get(row.entity_id),
        });
      }
    }
    if ((result.data.rejected || []).length && done.size === 0) {
      throw new Error("El servidor rechazó el lote de sincronización");
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
    await refreshSession();
    await flushMedia();
    await flushQueue();
    await pullRemote();
    await flushCloudPurge();
    await applyRemoteRevision();
    const leftover = await pendingCount();
    if (leftover.total > 0) {
      setSyncStatus("retry");
    } else {
      setSyncStatus("synced");
    }
  } catch (_err) {
    const counts = await pendingCount();
    if (!isOnline()) {
      setSyncStatus("offline", String(counts.total));
    } else {
      setSyncStatus("retry");
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
