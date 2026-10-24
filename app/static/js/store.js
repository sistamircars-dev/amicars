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

export async function upsertTasa(data) {
  const existing = await db.tasas_bcv.where("fecha").equals(data.fecha).first();
  return saveLocal(
    "tasas_bcv",
    {
      id: existing ? existing.id : newId(),
      fecha: data.fecha,
      usd_ves: Number(data.usd_ves),
      fuente: data.fuente || "BCV",
      is_active: true,
    },
    existing ? "update" : "insert"
  );
}

export async function getTasa(fecha) {
  if (fecha) {
    return db.tasas_bcv.where("fecha").equals(fecha).first();
  }
  const all = await db.tasas_bcv.orderBy("fecha").reverse().toArray();
  return all[0] || null;
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
