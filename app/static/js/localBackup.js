import { db, ENTITY_TABLES } from "./db.js";

const ENTITY_BACKUP = [
  "categorias",
  "subcategorias",
  "campos_personalizados",
  "proveedores",
  "productos",
  "producto_imagenes",
  "producto_proveedores",
  "historico_ref",
  "tasas_bcv",
  "configuracion_sistema",
  "solicitudes_restock",
  "preferencias_usuario",
  "movimientos_inventario",
];

const LOCAL_STATE = ["sync_queue", "offline_media_queue", "meta"];

export const BACKUP_FORMAT = "amircars-local-backup";
export const BACKUP_VERSION = 1;
export const ARCHIVE_FORMAT = "amircars-disk-archive";
export const ARCHIVE_VERSION = 1;
export const BACKUP_TABLES = [
  ...ENTITY_BACKUP,
  ...ENTITY_TABLES.filter((name) => !ENTITY_BACKUP.includes(name)),
  ...LOCAL_STATE,
];

const BLOB_MARK = "__amircars_blob";

function bytesToBinary(bytes) {
  let binary = "";
  const chunk = 8192;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
  }
  return binary;
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return btoa(bytesToBinary(bytes));
}

function blobFromRecord(record) {
  let binary;
  try {
    binary = atob(record.data);
  } catch (_err) {
    throw new Error("El respaldo tiene un archivo local dañado.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const type = record.mime || "application/octet-stream";
  if (record.name) {
    return new File([bytes], record.name, { type });
  }
  return new Blob([bytes], { type });
}

export async function encodeValue(value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return {
      [BLOB_MARK]: true,
      mime: value.type || "application/octet-stream",
      name: typeof value.name === "string" ? value.name : "",
      data: await blobToBase64(value),
    };
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    const encoded = [];
    for (const item of value) {
      encoded.push(await encodeValue(item));
    }
    return encoded;
  }
  if (typeof value === "object") {
    const encoded = {};
    for (const [key, item] of Object.entries(value)) {
      encoded[key] = await encodeValue(item);
    }
    return encoded;
  }
  return value;
}

export function decodeValue(value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(decodeValue);
  }
  if (typeof value === "object") {
    if (value[BLOB_MARK] === true && typeof value.data === "string") {
      return blobFromRecord(value);
    }
    const decoded = {};
    for (const [key, item] of Object.entries(value)) {
      decoded[key] = decodeValue(item);
    }
    return decoded;
  }
  return value;
}

export function countBackupRows(payload) {
  return BACKUP_TABLES.reduce((sum, name) => {
    const rows = payload.tables && payload.tables[name];
    return sum + (Array.isArray(rows) ? rows.length : 0);
  }, 0);
}

export function backupFilename(payload) {
  const stamp = String((payload && payload.exported_at) || new Date().toISOString()).replace(/[:.]/g, "-");
  return `amircars-respaldo-${stamp}.json`;
}

export function readBackup(source) {
  let data = source;
  if (typeof source === "string") {
    try {
      data = JSON.parse(source);
    } catch (_err) {
      throw new Error("El archivo no es JSON válido.");
    }
  }
  if (!data || data.format !== BACKUP_FORMAT || data.version !== BACKUP_VERSION) {
    throw new Error("El archivo no es un respaldo de AMIRCARS.");
  }
  if (!data.tables || typeof data.tables !== "object") {
    throw new Error("El respaldo no contiene tablas.");
  }
  for (const name of BACKUP_TABLES) {
    if (!Array.isArray(data.tables[name])) {
      throw new Error(`El respaldo no incluye la tabla ${name}.`);
    }
  }
  return data;
}

export async function exportTables(targetDb = db) {
  const tables = {};
  for (const name of BACKUP_TABLES) {
    tables[name] = await encodeValue(await targetDb.table(name).toArray());
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    tables,
  };
}

export function exportLocalBackup() {
  return exportTables(db);
}

function triggerDownload(payload, filename) {
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadBackup(payload) {
  triggerDownload(payload, backupFilename(payload));
}

export function downloadArchiveFile(payload) {
  triggerDownload(payload, archiveFilename("historico"));
}

export async function restoreBackupInto(targetDb, source) {
  const payload = readBackup(source);
  await targetDb.transaction("rw", BACKUP_TABLES, async () => {
    for (const name of BACKUP_TABLES) {
      const table = targetDb.table(name);
      await table.clear();
      const rows = payload.tables[name].map(decodeValue);
      if (rows.length) {
        await table.bulkPut(rows);
      }
    }
  });
  return { rows: countBackupRows(payload), tables: BACKUP_TABLES.length };
}

export function restoreLocalBackup(source) {
  return restoreBackupInto(db, source);
}

export function archiveFilename(kind = "historico") {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `amircars-${kind}-${stamp}.json`;
}

export async function buildDiskArchive(tables, extra = {}) {
  const encoded = {};
  for (const [name, rows] of Object.entries(tables)) {
    encoded[name] = await encodeValue(rows);
  }
  return {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    archived_at: new Date().toISOString(),
    reason: extra.reason || "memoria-local-90",
    tables: encoded,
  };
}

export function readDiskArchive(source) {
  let data = source;
  if (typeof source === "string") {
    data = JSON.parse(source);
  }
  if (!data || data.format !== ARCHIVE_FORMAT || data.version !== ARCHIVE_VERSION) {
    throw new Error("El archivo no es un histórico de AMIRCARS.");
  }
  if (!data.tables || typeof data.tables !== "object") {
    throw new Error("El histórico no contiene tablas.");
  }
  return data;
}

export async function restoreDiskArchive(source) {
  const payload = readDiskArchive(source);
  let rows = 0;
  const names = Object.keys(payload.tables);
  await db.transaction("rw", names.filter((name) => db.tables.some((table) => table.name === name)), async () => {
    for (const name of names) {
      if (!db.tables.some((table) => table.name === name)) {
        continue;
      }
      const decoded = payload.tables[name].map(decodeValue);
      if (decoded.length) {
        await db.table(name).bulkPut(decoded);
        rows += decoded.length;
      }
    }
  });
  return { rows, tables: names.length, archived_at: payload.archived_at };
}
