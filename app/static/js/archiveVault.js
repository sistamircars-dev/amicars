import { purgeArchived } from "./api.js";
import { db, getMeta, nowIso, setMeta } from "./db.js";
import { canUseDiskFolder, ensureArchiveDir, writeJsonToDir } from "./diskStore.js";
import { archiveFilename, buildDiskArchive, downloadArchiveFile, restoreDiskArchive } from "./localBackup.js";

const THRESHOLD = 0.9;
const KEEP_MOVE_DAYS = 90;
const KEEP_RECENT = 200;
const KEEP_PER_PRODUCT = 3;
const IDLE_DAYS = 180;
const CHECK_MS = 5 * 60 * 1000;

let running = false;
let timer = null;

function daysMs(days) {
  return days * 24 * 60 * 60 * 1000;
}

function stampOf(row) {
  const raw = row.fecha || row.updated_at || row.created_at;
  const value = Date.parse(raw || "");
  return Number.isFinite(value) ? value : 0;
}

function alreadyArchived(map, table, id) {
  return Boolean(map[table] && map[table].includes(id));
}

async function markArchived(table, ids) {
  const current = { ...((await getMeta("archived_ids", {})) || {}) };
  const bucket = new Set(current[table] || []);
  ids.forEach((id) => bucket.add(id));
  current[table] = [...bucket];
  await setMeta("archived_ids", current);
  return current;
}

export async function estimateMemory() {
  if (navigator.storage && navigator.storage.estimate) {
    const info = await navigator.storage.estimate();
    const quota = Number(info.quota || 0);
    const usage = Number(info.usage || 0);
    if (quota > 0) {
      return { usage, quota, ratio: usage / quota, source: "storage" };
    }
  }
  const moves = await db.movimientos_inventario.count();
  const images = await db.producto_imagenes.count();
  const media = await db.offline_media_queue.count();
  const usage = moves + images * 8 + media * 20;
  const quota = 4000;
  return { usage, quota, ratio: usage / quota, source: "rows" };
}

async function collectCold() {
  const [products, moves, images, history, solicitudes, archived] = await Promise.all([
    db.productos.toArray(),
    db.movimientos_inventario.toArray(),
    db.producto_imagenes.toArray(),
    db.historico_ref.toArray(),
    db.solicitudes_restock.toArray(),
    getMeta("archived_ids", {}),
  ]);
  const archivedMap = archived || {};
  const lastMove = new Map();
  moves.forEach((move) => {
    const stamp = stampOf(move);
    if (stamp > (lastMove.get(move.producto_id) || 0)) {
      lastMove.set(move.producto_id, stamp);
    }
  });
  const stockOf = new Map(products.map((product) => [product.id, Number(product.stock || 0)]));
  const idle = (productId) => Date.now() - (lastMove.get(productId) || 0) > daysMs(IDLE_DAYS);

  const keepMoves = new Set();
  const newest = [...moves].sort((a, b) => stampOf(b) - stampOf(a));
  newest.slice(0, KEEP_RECENT).forEach((move) => keepMoves.add(move.id));
  const byProduct = new Map();
  moves.forEach((move) => {
    if (!byProduct.has(move.producto_id)) {
      byProduct.set(move.producto_id, []);
    }
    byProduct.get(move.producto_id).push(move);
  });
  byProduct.forEach((list) => {
    list
      .sort((a, b) => stampOf(b) - stampOf(a))
      .slice(0, KEEP_PER_PRODUCT)
      .forEach((move) => keepMoves.add(move.id));
  });

  const coldMoves = moves.filter((move) => {
    if (alreadyArchived(archivedMap, "movimientos_inventario", move.id) || keepMoves.has(move.id)) {
      return false;
    }
    return Date.now() - stampOf(move) > daysMs(KEEP_MOVE_DAYS);
  });

  const coldImages = images.filter((image) => {
    if (alreadyArchived(archivedMap, "producto_imagenes", image.id)) {
      return false;
    }
    const unused = stockOf.get(image.producto_id) <= 0 && idle(image.producto_id);
    return unused || (!image.is_cover && idle(image.producto_id));
  });

  const coldHistory = history.filter((row) => {
    if (alreadyArchived(archivedMap, "historico_ref", row.id) || !row.vigente_hasta) {
      return false;
    }
    return Date.now() - stampOf(row) > daysMs(60);
  });

  const coldSols = solicitudes.filter((row) => {
    if (alreadyArchived(archivedMap, "solicitudes_restock", row.id)) {
      return false;
    }
    const closed = row.estado === "atendida" || row.estado === "cancelada" || row.is_active === false;
    return closed && Date.now() - stampOf(row) > daysMs(60);
  });

  if (!coldMoves.length && newest.length > KEEP_RECENT + 80) {
    newest.slice(KEEP_RECENT).forEach((move) => {
      if (!keepMoves.has(move.id) && !alreadyArchived(archivedMap, "movimientos_inventario", move.id)) {
        coldMoves.push(move);
      }
    });
  }

  return {
    movimientos_inventario: coldMoves,
    producto_imagenes: coldImages,
    historico_ref: coldHistory,
    solicitudes_restock: coldSols,
  };
}

async function captureImageBlob(row) {
  if (row.local_blob instanceof Blob) {
    return row.local_blob;
  }
  if (!row.cloudinary_url || !navigator.onLine) {
    return null;
  }
  try {
    const response = await fetch(row.cloudinary_url);
    if (!response.ok) {
      return null;
    }
    return await response.blob();
  } catch (_err) {
    return null;
  }
}

async function persistArchive(payload, interactive) {
  const name = archiveFilename("historico");
  try {
    const dir = await ensureArchiveDir(interactive);
    if (dir) {
      await writeJsonToDir(dir, name, payload);
      await setMeta("last_archive_file", name);
      return { mode: "folder", name };
    }
  } catch (_err) {
    /* Si no hay carpeta, se descarga el archivo. */
  }
  downloadArchiveFile(payload);
  return { mode: "download", name };
}

async function dropLocal(tables) {
  const pending = [];
  for (const [table, rows] of Object.entries(tables)) {
    const ids = rows.map((row) => row.id).filter(Boolean);
    if (!ids.length) {
      continue;
    }
    await db.table(table).bulkDelete(ids);
    await markArchived(table, ids);
    rows.forEach((row) => {
      pending.push({
        table,
        id: row.id,
        cloudinary_public_id: row.cloudinary_public_id || null,
      });
    });
  }
  const queued = [...((await getMeta("pending_cloud_purge", [])) || []), ...pending];
  await setMeta("pending_cloud_purge", queued);
  return queued;
}

export async function flushCloudPurge() {
  if (!navigator.onLine) {
    return { ok: false, offline: true };
  }
  const pending = (await getMeta("pending_cloud_purge", [])) || [];
  if (!pending.length) {
    return { ok: true, count: 0 };
  }
  const batch = pending.slice(0, 200);
  const result = await purgeArchived(batch);
  if (!result.ok || !result.data || result.data.ok !== true) {
    return { ok: false, error: (result.data && result.data.error) || `HTTP ${result.status}` };
  }
  const done = new Set(batch.map((item) => `${item.table}:${item.id}`));
  await setMeta(
    "pending_cloud_purge",
    pending.filter((item) => !done.has(`${item.table}:${item.id}`))
  );
  await setMeta("last_cloud_purge_at", nowIso());
  return { ok: true, count: batch.length };
}

export async function runArchiveIfNeeded(options = {}) {
  if (running) {
    return null;
  }
  const memory = await estimateMemory();
  await setMeta("last_quota", { ...memory, checked_at: nowIso() });
  if (memory.ratio < THRESHOLD && !options.force) {
    return { skipped: true, memory };
  }
  running = true;
  try {
    const cold = await collectCold();
    const images = [];
    for (const row of cold.producto_imagenes) {
      const blob = await captureImageBlob(row);
      images.push(blob ? { ...row, local_blob: blob, cloudinary_url: row.cloudinary_url || "" } : row);
    }
    const tables = {
      movimientos_inventario: cold.movimientos_inventario,
      producto_imagenes: images,
      historico_ref: cold.historico_ref,
      solicitudes_restock: cold.solicitudes_restock,
    };
    const total = Object.values(tables).reduce((sum, rows) => sum + rows.length, 0);
    if (!total) {
      return { skipped: true, empty: true, memory };
    }
    const payload = await buildDiskArchive(tables, { reason: "memoria-local-90" });
    const saved = await persistArchive(payload, options.interactive !== false);
    await dropLocal(tables);
    const purged = await flushCloudPurge();
    return { ok: true, saved, total, purged, memory };
  } finally {
    running = false;
  }
}

export async function restoreHistoryFromFile(file) {
  const summary = await restoreDiskArchive(await file.text());
  return summary;
}

export async function archiveStatus() {
  const memory = await estimateMemory();
  const pending = (await getMeta("pending_cloud_purge", [])) || [];
  const last = await getMeta("last_archive_file", "");
  const folder = await getMeta("archive_dir", null);
  return {
    memory,
    pending: pending.length,
    lastFile: last,
    hasFolder: Boolean(folder) && canUseDiskFolder(),
  };
}

export function startArchiveVault() {
  const tick = () => {
    runArchiveIfNeeded({ interactive: false }).catch(() => {});
    flushCloudPurge().catch(() => {});
  };
  window.addEventListener("online", tick);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      tick();
    }
  });
  if (timer) {
    clearInterval(timer);
  }
  timer = setInterval(tick, CHECK_MS);
  tick();
}
