import { db, newId, nowIso } from "./db.js";
import { saveLocal } from "./repository.js";

export async function getConfig(clave, fallback = null) {
  const row = await db.configuracion_sistema.where("clave").equals(clave).first();
  if (!row) {
    return fallback;
  }
  return row.valor;
}

export async function setConfig(clave, valor) {
  const existing = await db.configuracion_sistema.where("clave").equals(clave).first();
  return saveLocal(
    "configuracion_sistema",
    {
      id: existing ? existing.id : newId(),
      clave,
      valor,
      is_active: true,
    },
    existing ? "update" : "insert"
  );
}

function isoDate(value) {
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

export async function upsertTasa(data) {
  const fecha = isoDate(data.fecha);
  if (!fecha) {
    throw new Error("La tasa no tiene fecha.");
  }
  const rate = Number(data.usd_ves);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("La tasa del día no es válida.");
  }
  const twins = (await db.tasas_bcv.toArray())
    .filter((row) => isoDate(row.fecha) === fecha)
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  const existing = twins[0] || null;
  for (const extra of twins.slice(1)) {
    await db.tasas_bcv.delete(extra.id);
    const queued = await db.sync_queue.where("entity_id").equals(extra.id).toArray();
    for (const item of queued) {
      await db.sync_queue.delete(item.id);
    }
  }
  if (existing && Number(existing.usd_ves) === rate && isoDate(existing.fecha) === fecha) {
    return existing;
  }
  return saveLocal(
    "tasas_bcv",
    {
      ...(existing || {}),
      id: existing ? existing.id : newId(),
      fecha,
      usd_ves: rate,
      fuente: data.fuente || "BCV",
      is_active: true,
    },
    existing ? "update" : "insert"
  );
}

export async function getTasa(fecha) {
  const wanted = isoDate(fecha);
  const all = await db.tasas_bcv.toArray();
  if (wanted) {
    return all.find((row) => isoDate(row.fecha) === wanted) || null;
  }
  return all.sort((a, b) => isoDate(b.fecha).localeCompare(isoDate(a.fecha)))[0] || null;
}

export async function getPrefs() {
  const row = await db.preferencias_usuario.toCollection().first();
  return (
    row || {
      vista_inventario: "mosaico",
      columnas_tabla: [],
      campos_mosaico: [],
      filtros: {},
      sidebar_collapsed: false,
    }
  );
}

export async function savePrefs(patch) {
  const current = (await db.preferencias_usuario.toCollection().first()) || {
    id: newId(),
    user_id: "local",
    created_at: nowIso(),
  };
  return saveLocal("preferencias_usuario", { ...current, ...patch });
}
