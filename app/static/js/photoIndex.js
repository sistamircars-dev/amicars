import { db, nowIso } from "./db.js";
import { decodeValue } from "./localBackup.js";
import { enqueue } from "./repository.js";

export const PHOTO_INDEX_FORMAT = "amircars-fotos";
export const PHOTO_INDEX_VERSION = 1;
const CLOUD = "mwzczz6i";

export function cloudUrlFor(publicId, imageId) {
  const pid = String(publicId || "").trim().replace(/^\/+/, "");
  if (pid) {
    return `https://res.cloudinary.com/${CLOUD}/image/upload/f_auto,q_auto/${pid}`;
  }
  const id = String(imageId || "").trim().toLowerCase();
  if (id) {
    return `https://res.cloudinary.com/${CLOUD}/image/upload/f_auto,q_auto/amircars/repuestos/${id}`;
  }
  return "";
}

export function normalizePhotoRow(row) {
  if (!row || !row.id || !row.producto_id) {
    return null;
  }
  let pid = String(row.cloudinary_public_id || "").trim();
  let url = String(row.cloudinary_url || "").trim();
  if (!pid && row.id) {
    pid = `amircars/repuestos/${String(row.id).toLowerCase()}`;
  }
  if (!url) {
    url = cloudUrlFor(pid, row.id);
  }
  if (!url && !pid) {
    return null;
  }
  return {
    id: row.id,
    producto_id: row.producto_id,
    cloudinary_url: url,
    cloudinary_public_id: pid,
    alt_text: row.alt_text || row.filename || "",
    orden: Number(row.orden || 0),
    is_cover: Boolean(row.is_cover),
    is_active: row.is_active !== false,
  };
}

export async function collectPhotoIndex() {
  const map = new Map();
  const images = await db.producto_imagenes.toArray();
  for (const row of images) {
    const rec = normalizePhotoRow(row);
    if (rec) {
      map.set(rec.id, rec);
    }
  }
  const queued = await db.offline_media_queue.toArray();
  for (const item of queued) {
    const rec = normalizePhotoRow({
      id: item.id,
      producto_id: item.producto_id,
      alt_text: item.alt_text || item.filename || "",
      orden: item.orden,
      is_cover: item.is_cover,
      is_active: true,
    });
    if (rec && !map.has(rec.id)) {
      map.set(rec.id, rec);
    }
  }
  return [...map.values()];
}

export async function applyPhotoIndex(items, options = {}) {
  const products = await db.productos.toArray();
  const byProduct = new Map(products.map((row) => [row.id, row]));
  let applied = 0;
  for (const raw of items || []) {
    const rec = normalizePhotoRow(raw);
    if (!rec) {
      continue;
    }
    const product = byProduct.get(rec.producto_id);
    const existing = await db.producto_imagenes.get(rec.id);
    const next = {
      ...(existing || {}),
      ...rec,
      is_active: product ? product.is_active !== false : rec.is_active !== false,
      updated_at: nowIso(),
      created_at: (existing && existing.created_at) || nowIso(),
    };
    if (existing && existing.local_blob) {
      next.local_blob = existing.local_blob;
    }
    await db.producto_imagenes.put(next);
    if (options.enqueue) {
      await enqueue("producto_imagenes", existing ? "update" : "insert", next);
    }
    applied += 1;
  }
  return applied;
}

export function photoIndexPayload(items) {
  return {
    format: PHOTO_INDEX_FORMAT,
    version: PHOTO_INDEX_VERSION,
    exported_at: new Date().toISOString(),
    items: items || [],
  };
}

export function parsePhotoSource(source) {
  let data = source;
  if (typeof source === "string") {
    try {
      data = JSON.parse(source);
    } catch (_err) {
      throw new Error("El archivo no es JSON válido.");
    }
  }
  if (data && data.format === PHOTO_INDEX_FORMAT) {
    if (!Array.isArray(data.items)) {
      throw new Error("El índice de fotos no tiene ítems.");
    }
    return { kind: "index", items: data.items, queued: [] };
  }
  if (data && data.format === "amircars-local-backup" && data.tables) {
    const images = Array.isArray(data.tables.producto_imagenes) ? data.tables.producto_imagenes.map(decodeValue) : [];
    const queued = Array.isArray(data.tables.offline_media_queue)
      ? data.tables.offline_media_queue.map(decodeValue)
      : [];
    return { kind: "backup", items: images, queued };
  }
  throw new Error("El archivo no es un índice de fotos ni un respaldo AMIRCARS.");
}

export async function importPhotoSource(source) {
  const parsed = parsePhotoSource(source);
  const applied = await applyPhotoIndex(parsed.items, { enqueue: true });
  let queued = 0;
  for (const item of parsed.queued || []) {
    if (!item || !item.id || !item.producto_id) {
      continue;
    }
    await db.offline_media_queue.put(item);
    queued += 1;
  }
  return { applied, queued, kind: parsed.kind };
}

export function downloadPhotoIndex(items) {
  const payload = photoIndexPayload(items);
  const stamp = payload.exported_at.replace(/[:.]/g, "-");
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `amircars-fotos-${stamp}.json`;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
