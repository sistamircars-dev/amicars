const Dexie = window.Dexie;

export const ENTITY_TABLES = [
  "categorias",
  "subcategorias",
  "campos_personalizados",
  "proveedores",
  "productos",
  "producto_proveedores",
  "producto_imagenes",
  "historico_ref",
  "tasas_bcv",
  "configuracion_sistema",
  "solicitudes_restock",
  "preferencias_usuario",
  "movimientos_inventario",
];

export const PUSH_ORDER = [...ENTITY_TABLES];

export const db = new Dexie("amircars");

db.version(1).stores({
  categorias: "id, updated_at, is_active, nombre, orden",
  subcategorias: "id, categoria_id, updated_at, is_active, nombre",
  campos_personalizados: "id, subcategoria_id, updated_at, is_active, nombre",
  proveedores: "id, codigo_proveedor, updated_at, is_active, razon_social",
  productos: "id, categoria_id, subcategoria_id, proveedor_id, updated_at, is_active, stock, descripcion, solicitar_restock",
  producto_proveedores: "id, producto_id, proveedor_id, updated_at, is_active",
  producto_imagenes: "id, producto_id, updated_at, is_active, orden",
  historico_ref: "id, producto_id, updated_at, is_active, vigente_desde",
  tasas_bcv: "id, fecha, updated_at, is_active",
  configuracion_sistema: "id, clave, updated_at, is_active",
  solicitudes_restock: "id, producto_id, estado, updated_at, is_active",
  preferencias_usuario: "id, user_id, updated_at, is_active",
  movimientos_inventario: "id, tipo, fecha, producto_id, created_at, updated_at",
  sync_queue: "id, table, entity_id, created_at, attempts, op",
  offline_media_queue: "id, producto_id, created_at, attempts",
  meta: "key",
});

export function nowIso() {
  return new Date().toISOString();
}

export function newId() {
  return crypto.randomUUID();
}

export async function getMeta(key, fallback = null) {
  const row = await db.meta.get(key);
  return row ? row.value : fallback;
}

export async function setMeta(key, value) {
  await db.meta.put({ key, value, updated_at: nowIso() });
}

export async function pendingCount() {
  const ops = await db.sync_queue.count();
  const media = await db.offline_media_queue.count();
  return { ops, media, total: ops + media };
}
