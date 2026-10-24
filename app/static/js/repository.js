import { db, newId, nowIso } from "./db.js";

const SYNC_STRIP = new Set(["local_blob", "thumbnail_url", "blob"]);

function cloneRecord(record) {
  const copy = { ...record };
  SYNC_STRIP.forEach((key) => {
    delete copy[key];
  });
  return JSON.parse(JSON.stringify(copy));
}

export async function enqueue(table, op, record) {
  if (table === "producto_imagenes" && op !== "delete") {
    const url = String(record.cloudinary_url || "").trim();
    const pid = String(record.cloudinary_public_id || "").trim();
    if (!url && !pid) {
      return;
    }
  }
  const payload = cloneRecord(record);
  await db.sync_queue.add({
    id: newId(),
    table,
    op,
    entity_id: payload.id,
    payload,
    updated_at: payload.updated_at,
    created_at: nowIso(),
    attempts: 0,
    last_error: null,
  });
}

export async function saveLocal(table, data, op = "insert") {
  const record = { ...data };
  if (!record.id) {
    record.id = newId();
  }
  if (record.is_active === undefined) {
    record.is_active = true;
  }
  record.updated_at = nowIso();
  if (!record.created_at) {
    record.created_at = record.updated_at;
  }
  const existing = await db.table(table).get(record.id);
  const action = existing ? "update" : op;
  await db.table(table).put(record);
  await enqueue(table, action, record);
  return record;
}

export async function deactivateLocal(table, id) {
  const existing = await db.table(table).get(id);
  if (!existing) {
    return null;
  }
  existing.is_active = false;
  existing.updated_at = nowIso();
  await db.table(table).put(existing);
  await enqueue(table, "update", existing);
  return existing;
}

export async function hardDeleteLocal(table, id) {
  const existing = await db.table(table).get(id);
  if (!existing) {
    return null;
  }
  await db.table(table).delete(id);
  await enqueue(table, "delete", { id, updated_at: nowIso(), is_active: false });
  return existing;
}

export async function queueOfflineImage(productoId, blob, filename, extra = {}) {
  const item = {
    id: extra.id || newId(),
    producto_id: productoId,
    filename: filename || "pieza.jpg",
    mime: blob.type || "image/jpeg",
    blob,
    orden: extra.orden || 0,
    is_cover: Boolean(extra.is_cover),
    alt_text: extra.alt_text || "",
    created_at: nowIso(),
    attempts: 0,
    last_error: null,
  };
  await db.offline_media_queue.put(item);
  return item;
}
