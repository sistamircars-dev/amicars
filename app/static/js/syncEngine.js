import { healthCheck, pullChanges, pushQueue, refreshSession, uploadMediaBlob } from "./api.js";
import { flushCloudPurge } from "./archiveVault.js";
import { db, ENTITY_TABLES, PUSH_ORDER, getMeta, nowIso, pendingCount, setMeta } from "./db.js";
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

const ID_REFS = {
  categorias: [
    ["subcategorias", "categoria_id"],
    ["productos", "categoria_id"],
  ],
  subcategorias: [
    ["campos_personalizados", "subcategoria_id"],
    ["productos", "subcategoria_id"],
  ],
  proveedores: [
    ["productos", "proveedor_id"],
    ["producto_proveedores", "proveedor_id"],
    ["movimientos_inventario", "proveedor_id"],
  ],
  productos: [
    ["producto_proveedores", "producto_id"],
    ["producto_imagenes", "producto_id"],
    ["historico_ref", "producto_id"],
    ["solicitudes_restock", "producto_id"],
    ["movimientos_inventario", "producto_id"],
  ],
};

const FK_COLUMNS = ["categoria_id", "subcategoria_id", "proveedor_id", "producto_id"];

async function rewriteRefs(table, fromId, toId) {
  const refs = ID_REFS[table] || [];
  for (const [other, column] of refs) {
    const rows = await db.table(other).filter((row) => row[column] === fromId).toArray();
    for (const row of rows) {
      const next = { ...row, [column]: toId, updated_at: nowIso() };
      await db.table(other).put(next);
      if (other !== "movimientos_inventario") {
        await enqueue(other, "update", next);
      }
    }
  }
  const queued = await db.sync_queue.toArray();
  for (const item of queued) {
    const payload = item.payload || {};
    let changed = false;
    const next = { ...payload };
    if (item.table === table && item.entity_id === fromId) {
      await db.sync_queue.delete(item.id);
      continue;
    }
    for (const column of FK_COLUMNS) {
      if (next[column] === fromId) {
        next[column] = toId;
        changed = true;
      }
    }
    if (changed) {
      await db.sync_queue.update(item.id, { payload: next });
    }
  }
}

async function applyRemaps(remaps) {
  for (const remap of remaps || []) {
    if (!remap || !remap.table || !remap.from || !remap.to || remap.from === remap.to) {
      continue;
    }
    if (!ENTITY_TABLES.includes(remap.table)) {
      continue;
    }
    await rewriteRefs(remap.table, remap.from, remap.to);
    const table = db.table(remap.table);
    const local = await table.get(remap.from);
    const remote = await table.get(remap.to);
    if (local && !remote) {
      await table.put({ ...local, id: remap.to });
    } else if (local && remote) {
      await table.put({ ...remote, ...local, id: remap.to });
    }
    if (local) {
      await table.delete(remap.from);
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

async function latestQueue() {
  const all = await db.sync_queue.toArray();
  const best = new Map();
  for (const row of all) {
    const key = `${row.table}:${row.entity_id}`;
    const prev = best.get(key);
    if (!prev || String(row.updated_at || row.created_at || "") >= String(prev.updated_at || prev.created_at || "")) {
      best.set(key, row);
    }
  }
  const keep = new Set([...best.values()].map((row) => row.id));
  for (const row of all) {
    if (!keep.has(row.id)) {
      await db.sync_queue.delete(row.id);
    }
  }
  return [...best.values()].sort((a, b) => rank(a.table) - rank(b.table) || String(a.created_at || "").localeCompare(String(b.created_at || "")));
}

function isFkError(err) {
  return /23503|foreign key/i.test(err || "");
}

async function canonicalProveedor(row) {
  const codigo = String((row && row.codigo_proveedor) || "").trim().toLowerCase();
  if (!codigo) {
    return row;
  }
  const same = (await db.proveedores.toArray())
    .filter((item) => String(item.codigo_proveedor || "").trim().toLowerCase() === codigo)
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  return same[0] || row;
}

async function collapseDuplicateProveedores() {
  const rows = await db.proveedores.toArray();
  const groups = new Map();
  for (const row of rows) {
    const codigo = String(row.codigo_proveedor || "").trim().toLowerCase();
    if (!codigo) {
      continue;
    }
    const list = groups.get(codigo) || [];
    list.push(row);
    groups.set(codigo, list);
  }
  for (const list of groups.values()) {
    if (list.length < 2) {
      continue;
    }
    list.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
    const keep = list[0];
    for (const drop of list.slice(1)) {
      await rewriteRefs("proveedores", drop.id, keep.id);
      await db.proveedores.delete(drop.id);
    }
  }
}

async function ensureParents() {
  const queued = await db.sync_queue.toArray();
  const seen = new Set(queued.map((row) => `${row.table}:${row.entity_id}`));
  const wanted = [];
  for (const row of queued) {
    const payload = row.payload || {};
    if (payload.proveedor_id) {
      wanted.push(["proveedores", payload.proveedor_id]);
    }
    if (payload.producto_id) {
      wanted.push(["productos", payload.producto_id]);
    }
    if (payload.categoria_id) {
      wanted.push(["categorias", payload.categoria_id]);
    }
    if (payload.subcategoria_id) {
      wanted.push(["subcategorias", payload.subcategoria_id]);
    }
  }
  for (const [table, id] of wanted) {
    const key = `${table}:${id}`;
    if (seen.has(key)) {
      continue;
    }
    const rec = await db.table(table).get(id);
    if (!rec) {
      continue;
    }
    await enqueue(table, "update", rec);
    seen.add(key);
  }
}

async function softenPayload(row, err) {
  if (!isFkError(err)) {
    return false;
  }
  const attempts = row.attempts || 0;
  const payload = { ...(row.payload || {}) };
  if (payload.proveedor_id) {
    const parent = await db.proveedores.get(payload.proveedor_id);
    if (parent && attempts < 1) {
      const canon = await canonicalProveedor(parent);
      if (canon.id !== parent.id) {
        payload.proveedor_id = canon.id;
        payload.updated_at = nowIso();
        const local = await db.table(row.table).get(row.entity_id);
        if (local) {
          await db.table(row.table).put({ ...local, proveedor_id: canon.id, updated_at: payload.updated_at });
        }
        await db.sync_queue.update(row.id, { payload, updated_at: payload.updated_at, attempts: attempts + 1, last_error: err });
        return true;
      }
      await enqueue("proveedores", "update", parent);
      await db.sync_queue.update(row.id, { attempts: attempts + 1, last_error: err });
      return true;
    }
  }
  const optional = {
    productos: ["proveedor_id", "categoria_id", "subcategoria_id"],
    movimientos_inventario: ["proveedor_id"],
  };
  const cols = optional[row.table] || [];
  let changed = false;
  for (const col of cols) {
    if (payload[col]) {
      payload[col] = null;
      changed = true;
    }
  }
  if (changed) {
    payload.updated_at = nowIso();
    const local = await db.table(row.table).get(row.entity_id);
    if (local) {
      await db.table(row.table).put({ ...local, ...payload });
    }
    await db.sync_queue.update(row.id, { payload, updated_at: payload.updated_at, attempts: attempts + 1, last_error: err });
    return true;
  }
  if (row.table === "producto_proveedores" && attempts >= 2) {
    await db.sync_queue.delete(row.id);
    return true;
  }
  await db.sync_queue.update(row.id, { attempts: attempts + 1, last_error: err });
  return attempts < 3;
}

async function flushQueue() {
  await collapseDuplicateProveedores();
  for (let round = 0; round < 12; round += 1) {
    await ensureParents();
    const all = await latestQueue();
    if (!all.length) {
      return;
    }
    const slice = all.slice(0, BATCH);
    const items = slice.map((row) => {
      const updated = (row.payload && row.payload.updated_at) || row.updated_at || nowIso();
      return {
        id: row.entity_id,
        table: row.table,
        op: row.op,
        payload: { ...(row.payload || {}), id: row.entity_id, updated_at: updated },
        updated_at: updated,
      };
    });
    const result = await pushQueue(items);
    if (result.status === 401) {
      throw new Error("Sesión expirada; vuelva a entrar.");
    }
    if (!result.data || result.status >= 500) {
      throw new Error((result.data && result.data.error) || `Push HTTP ${result.status}`);
    }
    await applyRemaps(result.data.remaps || []);
    const done = new Set([...(result.data.accepted || []), ...(result.data.duplicates || [])]);
    const rejected = new Map((result.data.rejected || []).map((row) => [row.id, row.error]));
    let progressed = false;
    for (const row of slice) {
      if (done.has(row.entity_id)) {
        await db.sync_queue.delete(row.id);
        progressed = true;
        continue;
      }
      const err = String(rejected.get(row.entity_id) || result.data.error || "");
      if (/23505|duplicate|unique/i.test(err) && (row.table === "tasas_bcv" || row.table === "preferencias_usuario" || row.table === "configuracion_sistema")) {
        await db.sync_queue.delete(row.id);
        progressed = true;
        continue;
      }
      if (await softenPayload(row, err)) {
        progressed = true;
        continue;
      }
      await db.sync_queue.update(row.id, {
        attempts: (row.attempts || 0) + 1,
        last_error: err || "Rechazado",
      });
    }
    if (!progressed) {
      return;
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

async function pullRemote(full = false) {
  const since = full ? null : await getMeta("last_pull_at", null);
  const result = await pullChanges(since);
  if (result.status === 401) {
    throw new Error("Sesión expirada; vuelva a entrar.");
  }
  if (!result.ok || !result.data || !result.data.ok) {
    throw new Error((result.data && result.data.error) || `Pull HTTP ${result.status}`);
  }
  await mergePull(result.data.tables);
  await dropDuplicateTasas();
  if (result.data.server_time) {
    await setMeta("last_pull_at", result.data.server_time);
  }
}

async function pendingHint() {
  const ops = await db.sync_queue.toArray();
  const media = await db.offline_media_queue.toArray();
  const labels = {
    productos: "artículos",
    proveedores: "proveedores",
    producto_proveedores: "vínculos de proveedor",
    movimientos_inventario: "movimientos",
    historico_ref: "histórico",
    producto_imagenes: "fotos",
    tasas_bcv: "tasas",
  };
  const parts = [];
  const byTable = {};
  for (const row of ops) {
    byTable[row.table] = (byTable[row.table] || 0) + 1;
  }
  Object.entries(byTable).forEach(([table, count]) => {
    parts.push(`${count} ${labels[table] || table}`);
  });
  if (media.length) {
    parts.push(`${media.length} foto${media.length === 1 ? "" : "s"}`);
  }
  const err =
    (ops.find((row) => row.last_error) || {}).last_error ||
    (media.find((row) => row.last_error) || {}).last_error ||
    "";
  const detail = String(err).slice(0, 160);
  if (!parts.length) {
    return detail;
  }
  return detail ? `${parts.join(", ")} — ${detail}` : parts.join(", ");
}

async function statusFromCounts(counts, hint = "") {
  const title = hint || (counts.total > 0 ? await pendingHint() : "");
  if (!isOnline()) {
    setSyncStatus("offline", counts.total > 0 ? String(counts.total) : "", title);
    return;
  }
  if (counts.total > 0) {
    setSyncStatus("pending", String(counts.total), title);
    return;
  }
  setSyncStatus("connected");
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
    await flushQueue();
    try {
      await pullRemote(force);
    } catch (err) {
      if (/sesión|401|autentic/i.test(String(err && err.message))) {
        throw err;
      }
    }
    await flushMedia();
    await flushCloudPurge();
    await applyRemoteRevision();
    const leftover = await pendingCount();
    await statusFromCounts(leftover);
  } catch (err) {
    const counts = await pendingCount();
    const detail = String(err && err.message ? err.message : err);
    if (!isOnline()) {
      setSyncStatus("offline", counts.total > 0 ? String(counts.total) : "");
    } else if (/sesión|401|autentic|heartbeat|HTTP|network|Failed to fetch/i.test(detail)) {
      setSyncStatus("retry", "", detail);
    } else if (counts.total > 0) {
      setSyncStatus("pending", String(counts.total), detail);
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
