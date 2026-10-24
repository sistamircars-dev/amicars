import { num, writeHistorico } from "./catalog.js";
import { db, getMeta, newId, setMeta } from "./db.js";
import { saveLocal } from "./repository.js";
import { getConfig, getTasa } from "./store.js";

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

export async function registerEntrada({ fecha, proveedor, items, tasa, numeroFactura = "", fechaLlegada = "" }) {
  if (!items.length) {
    throw new Error("Agregue al menos un ítem.");
  }
  const rate = tasa ? num(tasa.usd_ves) : 0;
  for (const item of items) {
    const product = await db.productos.get(item.producto_id);
    if (!product || product.is_active === false) {
      throw new Error("Hay un repuesto que ya no está activo.");
    }
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
        numero_factura: String(numeroFactura || "").trim(),
        fecha_llegada: fechaLlegada || fecha,
      },
      is_active: true,
    });
    const next = await saveLocal("productos", {
      ...product,
      stock: num(product.stock) + qty,
      ref_entrada: refEntrada,
      ref_venta: refVenta,
      proveedor_id: proveedor ? proveedor.id : product.proveedor_id,
      atributos,
    });
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
    const refUnit = num(product.ref_venta);
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
    await saveLocal("productos", { ...product, stock: num(product.stock) - qty });
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
