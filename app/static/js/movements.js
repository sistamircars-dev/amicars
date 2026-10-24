import { num, writeHistorico } from "./catalog.js";
import { db, getMeta, newId, nowIso, setMeta } from "./db.js";
import { patchMovementLocal, saveLocal } from "./repository.js";
import { getConfig, getTasa } from "./store.js";

export function movePayload(move) {
  return move.payload && typeof move.payload === "object" ? move.payload : {};
}

export function isMoveVoided(move, allMoves) {
  const payload = movePayload(move);
  if (payload.anulado) {
    return true;
  }
  if (!allMoves || !allMoves.length) {
    return false;
  }
  return allMoves.some((row) => movePayload(row).anula_movimiento_id === move.id);
}

export function entradaLoteKey(move) {
  const payload = movePayload(move);
  if (payload.lote_id) {
    return payload.lote_id;
  }
  return `${move.proveedor_id || ""}|${payload.numero_factura || ""}|${payload.fecha_llegada || move.fecha}|${move.fecha}`;
}

export function groupEntradaFacturas(moves, proveedorId, allMoves = moves) {
  const groups = new Map();
  for (const move of moves) {
    if (move.tipo !== "entrada" || move.proveedor_id !== proveedorId) {
      continue;
    }
    if (isMoveVoided(move, allMoves)) {
      continue;
    }
    const key = entradaLoteKey(move);
    if (!groups.has(key)) {
      const payload = movePayload(move);
      groups.set(key, {
        key,
        lote_id: payload.lote_id || key,
        numero_factura: payload.numero_factura || "",
        fecha_llegada: payload.fecha_llegada || move.fecha,
        fecha: move.fecha,
        lineas: [],
      });
    }
    groups.get(key).lineas.push(move);
  }
  return [...groups.values()].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
}

async function reverseEntradaLine(move, justification) {
  const product = await db.productos.get(move.producto_id);
  if (!product) {
    throw new Error("Producto no encontrado para anular la entrada.");
  }
  const qty = num(move.cantidad);
  if (num(product.stock) < qty) {
    throw new Error(`No hay stock suficiente para anular ${move.descripcion || product.descripcion}.`);
  }
  const voidId = newId();
  await saveLocal("movimientos_inventario", {
    id: voidId,
    tipo: "salida",
    fecha: todayLocal(),
    producto_id: product.id,
    cantidad: qty,
    cliente_nombre: "Anulación de entrada",
    cliente_documento: "",
    motivo: justification,
    ref_unitario: num(move.ref_unitario),
    tasa_bcv: move.tasa_bcv ?? null,
    monto_ref: move.monto_ref ?? qty * num(move.ref_unitario),
    monto_bs: move.monto_bs ?? null,
    descripcion: product.descripcion,
    caracteristicas: product.atributos || {},
    payload: {
      origen: "anulacion",
      anula_movimiento_id: move.id,
      anula_tipo: "entrada",
      justificacion: justification,
    },
    is_active: true,
  });
  await saveLocal("productos", { ...product, stock: num(product.stock) - qty });
  await patchMovementLocal(move.id, {
    payload: {
      anulado: true,
      justificacion_anulacion: justification,
      anulado_at: nowIso(),
      anula_movimiento_id: voidId,
    },
  });
}

async function reverseSalidaLine(move, justification, correlativo) {
  const product = await db.productos.get(move.producto_id);
  if (!product) {
    throw new Error("Producto no encontrado para anular la salida.");
  }
  const qty = num(move.cantidad);
  const voidId = newId();
  await saveLocal("movimientos_inventario", {
    id: voidId,
    tipo: "entrada",
    fecha: todayLocal(),
    producto_id: product.id,
    cantidad: qty,
    proveedor_id: move.proveedor_id || null,
    codigo_proveedor: move.codigo_proveedor || "",
    nombre_proveedor: move.nombre_proveedor || "",
    ref_unitario: num(move.ref_unitario),
    tasa_bcv: move.tasa_bcv ?? null,
    monto_ref: move.monto_ref ?? qty * num(move.ref_unitario),
    monto_bs: move.monto_bs ?? null,
    descripcion: product.descripcion,
    caracteristicas: product.atributos || {},
    payload: {
      origen: "anulacion",
      anula_movimiento_id: move.id,
      anula_tipo: "salida",
      justificacion: justification,
      correlativo_anulado: correlativo || move.correlativo_salida || "",
    },
    is_active: true,
  });
  await saveLocal("productos", { ...product, stock: num(product.stock) + qty });
  await patchMovementLocal(move.id, {
    payload: {
      anulado: true,
      justificacion_anulacion: justification,
      anulado_at: nowIso(),
      anula_movimiento_id: voidId,
    },
  });
}

export async function voidEntradaFactura(loteKey, justification) {
  const all = await db.movimientos_inventario.toArray();
  const lines = all.filter((move) => move.tipo === "entrada" && entradaLoteKey(move) === loteKey);
  if (!lines.length) {
    throw new Error("No se encontró la factura de entrada.");
  }
  const active = lines.filter((move) => !isMoveVoided(move, all));
  if (!active.length) {
    throw new Error("Esa factura ya está anulada.");
  }
  for (const move of active) {
    await reverseEntradaLine(move, justification);
  }
  return active.length;
}

export async function voidSalidaTicket(correlativo, justification) {
  const wanted = String(correlativo || "").trim();
  if (!wanted) {
    throw new Error("Indique el número de salida.");
  }
  const all = await db.movimientos_inventario.toArray();
  const lines = all.filter((move) => move.tipo === "salida" && String(move.correlativo_salida || "").trim() === wanted);
  if (!lines.length) {
    throw new Error("No se encontró ese ticket de salida.");
  }
  const active = lines.filter((move) => !isMoveVoided(move, all));
  if (!active.length) {
    throw new Error("Esa salida ya está anulada.");
  }
  for (const move of active) {
    await reverseSalidaLine(move, justification, wanted);
  }
  return active.length;
}

export async function editEntradaFactura(loteKey, { numeroFactura, fechaLlegada, justification }) {
  const just = String(justification || "").trim();
  if (just.length < 3) {
    throw new Error("Indique la justificación de la edición.");
  }
  const all = await db.movimientos_inventario.toArray();
  const lines = all.filter((move) => move.tipo === "entrada" && entradaLoteKey(move) === loteKey);
  if (!lines.length) {
    throw new Error("No se encontró la factura.");
  }
  if (lines.some((move) => isMoveVoided(move, all))) {
    throw new Error("No se puede editar una factura anulada.");
  }
  const numero = String(numeroFactura ?? "").trim();
  const llegada = String(fechaLlegada ?? "").trim();
  if (!numero) {
    throw new Error("Indique el número de factura.");
  }
  if (!llegada) {
    throw new Error("Indique la fecha de llegada.");
  }
  const stamp = nowIso();
  for (const move of lines) {
    const payload = movePayload(move);
    const historial = Array.isArray(payload.historial_ediciones) ? payload.historial_ediciones.slice() : [];
    historial.push({
      at: stamp,
      justificacion: just,
      antes: {
        numero_factura: payload.numero_factura || "",
        fecha_llegada: payload.fecha_llegada || move.fecha,
      },
      despues: { numero_factura: numero, fecha_llegada: llegada },
    });
    await patchMovementLocal(move.id, {
      payload: {
        numero_factura: numero,
        fecha_llegada: llegada,
        historial_ediciones: historial,
        ultima_edicion: stamp,
        ultima_justificacion_edicion: just,
      },
    });
  }
  return lines.length;
}

export async function buildSalidaTicket(correlativo) {
  const wanted = String(correlativo || "").trim();
  const all = await db.movimientos_inventario.toArray();
  const lines = all
    .filter((move) => move.tipo === "salida" && String(move.correlativo_salida || "").trim() === wanted)
    .filter((move) => !isMoveVoided(move, all));
  if (!lines.length) {
    throw new Error("No hay líneas activas para ese ticket.");
  }
  const head = lines[0];
  const ticketLines = lines.map((move) => ({
    descripcion: move.descripcion || "",
    cantidad: num(move.cantidad),
    refUnit: num(move.ref_unitario),
    montoRef: num(move.monto_ref),
    montoBs: move.monto_bs === null || move.monto_bs === undefined ? null : num(move.monto_bs),
  }));
  return {
    correlativo: wanted,
    fecha: head.fecha,
    cliente: head.cliente_nombre || "",
    documento: head.cliente_documento || "",
    tasa: head.tasa_bcv ? num(head.tasa_bcv) : 0,
    lines: ticketLines,
    reimpresion: true,
  };
}

export async function listSalidaCorrelativos(limit = 80) {
  const all = await db.movimientos_inventario.filter((row) => row.tipo === "salida").toArray();
  const seen = new Map();
  for (const move of all) {
    const key = String(move.correlativo_salida || "").trim();
    if (!key || isMoveVoided(move, all)) {
      continue;
    }
    if (!seen.has(key)) {
      seen.set(key, { correlativo: key, fecha: move.fecha, cliente: move.cliente_nombre || "" });
    }
  }
  return [...seen.values()].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, limit);
}

export async function effectiveMinimum(product) {
  if (product.stock_minimo !== null && product.stock_minimo !== undefined && product.stock_minimo !== "") {
    return num(product.stock_minimo);
  }
  const links = await db.producto_proveedores.where("producto_id").equals(product.id).toArray();
  const link = links.find((row) => row.is_active !== false && row.stock_minimo !== null && row.stock_minimo !== undefined && row.stock_minimo !== "");
  if (link) {
    return num(link.stock_minimo);
  }
  const globalMin = await getConfig("stock_minimo_global", { cantidad: 1 });
  return num(globalMin && globalMin.cantidad !== undefined ? globalMin.cantidad : 1);
}

export function todayLocal() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function formatDisplayDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    return String(value || "");
  }
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function parseDisplayDate(value) {
  const raw = String(value || "").trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  const dmy = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (!dmy) {
    return "";
  }
  const day = Number(dmy[1]);
  const month = Number(dmy[2]);
  const year = Number(dmy[3]);
  const stamp = new Date(year, month - 1, day);
  if (stamp.getFullYear() !== year || stamp.getMonth() !== month - 1 || stamp.getDate() !== day) {
    return "";
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function formatRate(value) {
  return Number(value || 0).toLocaleString("es-VE", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

export async function tasaFor(fecha) {
  return (await getTasa(fecha)) || (await getTasa());
}

async function clearRestockIfRecovered(product) {
  const minimum = await effectiveMinimum(product);
  if (num(product.stock) <= minimum) {
    return;
  }
  if (product.solicitar_restock) {
    await saveLocal("productos", { ...product, solicitar_restock: false });
  }
  const pending = await db.solicitudes_restock.filter((row) => row.producto_id === product.id && row.estado === "pendiente" && row.is_active !== false).toArray();
  for (const row of pending) {
    await saveLocal("solicitudes_restock", { ...row, estado: "atendida" });
  }
}

export async function backfillSupplierLinks() {
  const [moves, links] = await Promise.all([db.movimientos_inventario.toArray(), db.producto_proveedores.toArray()]);
  const have = new Set(links.map((row) => `${row.proveedor_id}:${row.producto_id}`));
  for (const move of moves) {
    if (move.tipo !== "entrada" || !move.proveedor_id || !move.producto_id) {
      continue;
    }
    const key = `${move.proveedor_id}:${move.producto_id}`;
    if (have.has(key)) {
      continue;
    }
    have.add(key);
    await ensureSupplierLink(move.producto_id, { id: move.proveedor_id });
  }
}

async function ensureSupplierLink(productId, proveedor) {
  if (!proveedor || !productId) {
    return;
  }
  const existing = await db.producto_proveedores
    .filter((item) => item.proveedor_id === proveedor.id && item.producto_id === productId)
    .first();
  await saveLocal("producto_proveedores", {
    ...(existing || {}),
    producto_id: productId,
    proveedor_id: proveedor.id,
    stock_minimo: existing && existing.stock_minimo !== undefined ? existing.stock_minimo : null,
    is_active: true,
  });
}

async function resolveEntradaProduct(item, proveedor) {
  let product = item.producto_id ? await db.productos.get(item.producto_id) : null;
  const codigo = String(item.codigo || product?.codigo || "").trim();
  const descripcion = String(item.descripcion || product?.descripcion || "").trim();
  if (!codigo) {
    throw new Error("Indique el código de cada producto.");
  }
  if (!descripcion) {
    throw new Error(`Indique el producto del código ${codigo}.`);
  }
  if (!product) {
    const wanted = codigo.toLowerCase();
    product = (await db.productos.filter((row) => String(row.codigo || "").trim().toLowerCase() === wanted && row.is_active !== false).first()) || null;
  }
  if (!product) {
    product = await saveLocal("productos", {
      codigo,
      descripcion,
      atributos: item.atributos || {},
      proveedor_id: proveedor ? proveedor.id : null,
      stock: 0,
      stock_minimo: null,
      ref_entrada: num(item.ref_entrada),
      ref_venta: num(item.ref_venta),
      solicitar_restock: false,
      is_active: true,
    });
  }
  if (product.is_active === false) {
    throw new Error(`El repuesto ${descripcion} ya no está activo.`);
  }
  return product;
}

export async function registerEntrada({ fecha, proveedor, items, tasa, numeroFactura = "", fechaLlegada = "" }) {
  if (!items.length) {
    throw new Error("Agregue al menos un ítem.");
  }
  const rate = tasa ? num(tasa.usd_ves) : 0;
  const loteId = newId();
  for (const item of items) {
    const product = await resolveEntradaProduct(item, proveedor);
    item.producto_id = product.id;
    const qty = num(item.cantidad);
    if (qty <= 0) {
      throw new Error(`La cantidad de ${product.descripcion} debe ser mayor que cero.`);
    }
    const refEntrada = num(item.ref_entrada);
    const refVenta = num(item.ref_venta);
    const atributos = { ...(product.atributos || {}) };
    Object.entries(item.atributos || {}).forEach(([key, value]) => {
      const text = String(value ?? "").trim();
      if (text) {
        atributos[key] = text;
      }
    });
    const movId = newId();
    await saveLocal("movimientos_inventario", {
      id: movId,
      tipo: "entrada",
      fecha,
      producto_id: product.id,
      cantidad: qty,
      proveedor_id: proveedor ? proveedor.id : null,
      codigo_proveedor: proveedor ? proveedor.codigo_proveedor : "",
      nombre_proveedor: proveedor ? proveedor.razon_social : "",
      ref_unitario: refEntrada,
      tasa_bcv: rate || null,
      monto_ref: qty * refEntrada,
      monto_bs: rate ? qty * refEntrada * rate : null,
      descripcion: item.descripcion || product.descripcion,
      caracteristicas: atributos,
      payload: {
        origen: "entrada",
        lote_id: loteId,
        numero_factura: String(numeroFactura || "").trim(),
        fecha_llegada: fechaLlegada || fecha,
      },
      is_active: true,
    });
    const next = await saveLocal("productos", {
      ...product,
      codigo: String(item.codigo || product.codigo || "").trim() || product.codigo,
      descripcion: item.descripcion || product.descripcion,
      stock: num(product.stock) + qty,
      ref_entrada: refEntrada,
      ref_venta: refVenta,
      proveedor_id: product.proveedor_id || (proveedor ? proveedor.id : null),
      atributos,
    });
    await ensureSupplierLink(next.id, proveedor);
    await writeHistorico(next.id, refEntrada, refVenta, movId);
    await clearRestockIfRecovered(next);
  }
}

export async function nextCorrelativo() {
  const moves = await db.movimientos_inventario.filter((row) => row.tipo === "salida").toArray();
  let max = num(await getMeta("correlativo_salida", 0));
  moves.forEach((row) => {
    const value = num(String(row.correlativo_salida || "").replace(/\D/g, ""));
    if (value > max) {
      max = value;
    }
  });
  const next = max + 1;
  await setMeta("correlativo_salida", next);
  return `S-${String(next).padStart(6, "0")}`;
}

export async function registerSalida({ fecha, cliente, documento, items, tasa }) {
  if (!cliente) {
    throw new Error("Indique el cliente.");
  }
  if (!items.length) {
    throw new Error("Agregue al menos un ítem.");
  }
  const totals = new Map();
  items.forEach((item) => totals.set(item.producto_id, (totals.get(item.producto_id) || 0) + num(item.cantidad)));
  for (const [productId, qty] of totals) {
    const product = await db.productos.get(productId);
    if (!product || product.is_active === false) {
      throw new Error("Hay un repuesto que ya no está activo.");
    }
    if (qty <= 0) {
      throw new Error(`La cantidad de ${product.descripcion} debe ser mayor que cero.`);
    }
    if (num(product.stock) < qty) {
      throw new Error(`Stock insuficiente de ${product.descripcion}. Disponible: ${product.stock}.`);
    }
  }
  const correlativo = await nextCorrelativo();
  const rate = tasa ? num(tasa.usd_ves) : 0;
  const ticketLines = [];
  for (const item of items) {
    const product = await db.productos.get(item.producto_id);
    const qty = num(item.cantidad);
    const refUnit = item.ref_venta === undefined || item.ref_venta === "" ? num(product.ref_venta) : num(item.ref_venta);
    const montoRef = qty * refUnit;
    const montoBs = rate ? montoRef * rate : null;
    await saveLocal("movimientos_inventario", {
      id: newId(),
      tipo: "salida",
      fecha,
      producto_id: product.id,
      cantidad: qty,
      correlativo_salida: correlativo,
      cliente_nombre: cliente,
      cliente_documento: documento || "",
      ref_unitario: refUnit,
      tasa_bcv: rate || null,
      monto_ref: montoRef,
      monto_bs: montoBs,
      descripcion: product.descripcion,
      caracteristicas: product.atributos || {},
      payload: { origen: "salida" },
      is_active: true,
    });
    const next = { ...product, stock: num(product.stock) - qty };
    if (num(product.ref_venta) !== refUnit) {
      next.ref_venta = refUnit;
      await saveLocal("productos", next);
      await writeHistorico(next.id, next.ref_entrada, refUnit, null);
    } else {
      await saveLocal("productos", next);
    }
    ticketLines.push({ descripcion: product.descripcion, cantidad: qty, refUnit, montoRef, montoBs });
  }
  return { correlativo, fecha, cliente, documento, tasa: rate, lines: ticketLines };
}

export async function registerFalla({ fecha, items }) {
  if (!items.length) {
    throw new Error("Agregue al menos una pieza.");
  }
  const totals = new Map();
  items.forEach((item) => totals.set(item.producto_id, (totals.get(item.producto_id) || 0) + num(item.cantidad)));
  for (const item of items) {
    const product = await db.productos.get(item.producto_id);
    if (!product || product.is_active === false) {
      throw new Error("Hay un repuesto que ya no está activo.");
    }
    const qty = num(item.cantidad);
    if (qty <= 0) {
      throw new Error(`La cantidad de ${product.descripcion} debe ser mayor que cero.`);
    }
    if (!String(item.motivo || "").trim()) {
      throw new Error(`Indique el motivo de ${product.descripcion}.`);
    }
    if (num(product.stock) < (totals.get(product.id) || qty)) {
      throw new Error(`Stock insuficiente de ${product.descripcion}. Disponible: ${product.stock}.`);
    }
  }
  for (const item of items) {
    const product = await db.productos.get(item.producto_id);
    const qty = num(item.cantidad);
    await saveLocal("movimientos_inventario", {
      id: newId(),
      tipo: "falla",
      fecha,
      producto_id: product.id,
      cantidad: qty,
      motivo: item.motivo.trim(),
      ref_unitario: num(product.ref_entrada),
      monto_ref: qty * num(product.ref_entrada),
      descripcion: product.descripcion,
      caracteristicas: product.atributos || {},
      payload: { origen: "falla" },
      is_active: true,
    });
    await saveLocal("productos", { ...product, stock: num(product.stock) - qty });
  }
}
