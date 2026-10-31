import { getMeta, setMeta } from "./db.js";

const META_DIR = "archive_dir";

async function queryPermission(handle, mode = "readwrite") {
  if (!handle || typeof handle.queryPermission !== "function") {
    return false;
  }
  const current = await handle.queryPermission({ mode });
  if (current === "granted") {
    return true;
  }
  if (typeof handle.requestPermission === "function") {
    return (await handle.requestPermission({ mode })) === "granted";
  }
  return false;
}

export function canUseDiskFolder() {
  return typeof window.showDirectoryPicker === "function";
}

export async function getArchiveDir(requestIfNeeded = false) {
  const handle = await getMeta(META_DIR, null);
  if (!handle) {
    return null;
  }
  if (await queryPermission(handle, "readwrite")) {
    return handle;
  }
  if (requestIfNeeded && (await queryPermission(handle, "readwrite"))) {
    return handle;
  }
  return null;
}

export async function pickArchiveDir() {
  if (!canUseDiskFolder()) {
    throw new Error("Este navegador no permite elegir una carpeta de archivo.");
  }
  const handle = await window.showDirectoryPicker({
    id: "jdparfum-archivo",
    mode: "readwrite",
    startIn: "documents",
  });
  if (!(await queryPermission(handle, "readwrite"))) {
    throw new Error("Sin permiso para escribir en la carpeta.");
  }
  await setMeta(META_DIR, handle);
  return handle;
}

export async function ensureArchiveDir(interactive = false) {
  const existing = await getArchiveDir(true);
  if (existing) {
    return existing;
  }
  if (!interactive) {
    return null;
  }
  return pickArchiveDir();
}

export async function writeJsonToDir(dir, filename, payload) {
  const file = await dir.getFileHandle(filename, { create: true });
  const writable = await file.createWritable();
  await writable.write(JSON.stringify(payload));
  await writable.close();
  return filename;
}

export async function readJsonFromFile(file) {
  return JSON.parse(await file.text());
}
