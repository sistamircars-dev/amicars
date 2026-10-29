import { uploadMediaBlob } from "./api.js";
import { db, newId, nowIso } from "./db.js";
import { promptJustification } from "./promptJustification.js";
import { queueOfflineImage, saveLocal } from "./repository.js";
import { getTasa } from "./store.js";

export const PLACEHOLDER = "/static/img/amircars/logo.png";

const blobUrls = new Map();

export function num(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  const raw = String(value).trim().replace(/\s/g, "");
  const norm = raw.includes(",") && !raw.includes(".") ? raw.replace(",", ".") : raw.replace(/,/g, "");
  const parsed = Number(norm);
  return Number.isFinite(parsed) ? parsed : 0;
}

function moneyPlain(value) {
  return Number(value || 0)
    .toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .replace(/[\u00A0\u202F\u2009\u2007]/g, " ");
}

export function formatPair(ref, tasa) {
  const usd = num(ref);
  const usdTxt = moneyPlain(usd);
  if (!tasa || !tasa.usd_ves) {
    return `${usdTxt} REF`;
  }
  const bsTxt = moneyPlain(usd * Number(tasa.usd_ves));
  return `${usdTxt} REF / ${bsTxt} Bs`;
}

export function thumbUrl(url) {
  if (!url) {
    return PLACEHOLDER;
  }
  if (url.startsWith("blob:") || url.startsWith("/static/")) {
    return url;
  }
  if (url.includes("res.cloudinary.com") && url.includes("/upload/") && !url.includes("w_300")) {
    return url.replace("/upload/", "/upload/f_auto,q_auto,w_300/");
  }
  return url;
}

export function blobUrlFor(item) {
  const blob = item && (item.blob || item.local_blob);
  if (!blob) {
    return "";
  }
  if (!blobUrls.has(item.id)) {
    blobUrls.set(item.id, URL.createObjectURL(blob));
  }
  return blobUrls.get(item.id);
}

export function safeImg(src, alt, className) {
  const img = document.createElement("img");
  img.className = className || "";
  img.alt = alt || "AMIRCARS";
  img.src = src || PLACEHOLDER;
  img.addEventListener("error", () => {
    if (img.dataset.fallback === "1") {
      return;
    }
    img.dataset.fallback = "1";
    img.src = PLACEHOLDER;
  });
  return img;
}

export async function loadContext() {
  const [categorias, subcategorias, campos, proveedores, productos, imagenes, offline, tasa] = await Promise.all([
    db.categorias.toArray(),
    db.subcategorias.toArray(),
    db.campos_personalizados.toArray(),
    db.proveedores.toArray(),
    db.productos.toArray(),
    db.producto_imagenes.toArray(),
    db.offline_media_queue.toArray(),
    getTasa(),
  ]);
  const byId = (rows) => new Map(rows.map((row) => [row.id, row]));
  return {
    categorias: byId(categorias),
    subcategorias: byId(subcategorias),
    proveedores: byId(proveedores),
    productos: byId(productos),
    listas: { categorias, subcategorias, campos, proveedores, productos, imagenes, offline },
    tasa,
  };
}

export function productBlob(product, ctx) {
  const parts = [
    product.descripcion,
    product.codigo,
    ctx.categorias.get(product.categoria_id)?.nombre,
    ctx.subcategorias.get(product.subcategoria_id)?.nombre,
    ctx.proveedores.get(product.proveedor_id)?.razon_social,
    ctx.proveedores.get(product.proveedor_id)?.codigo_proveedor,
  ];
  Object.entries(product.atributos || {}).forEach(([key, value]) => {
    parts.push(key, value);
  });
  return parts
    .filter((part) => part !== null && part !== undefined && String(part).trim() !== "")
    .join(" ")
    .toLowerCase();
}

export function wordsOf(text) {
  return (String(text || "").toLowerCase().match(/[a-z0-9áéíóúüñ]+/gi) || []).filter((word) => word.length >= 2);
}

export function catalogWords(ctx) {
  const bag = new Set();
  ctx.listas.productos.forEach((product) => {
    wordsOf(productBlob(product, ctx)).forEach((word) => bag.add(word));
  });
  return [...bag].sort((a, b) => a.localeCompare(b, "es"));
}

export function matchesQuery(blob, query) {
  const words = String(query || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) {
    return true;
  }
  return words.every((word) => blob.includes(word));
}

export function matchesFieldFilters(attrs, filterState) {
  const active = (filterState && filterState.active) || [];
  const values = (filterState && filterState.values) || {};
  return active.every((name) => {
    const expected = String(values[name] || "").trim().toLowerCase();
    if (!expected) {
      return true;
    }
    return String((attrs || {})[name] ?? "").toLowerCase().includes(expected);
  });
}

export function galleryFor(productId, ctx) {
  const stored = ctx.listas.imagenes
    .filter((item) => item.producto_id === productId && item.is_active !== false && (item.cloudinary_url || item.local_blob))
    .sort((a, b) => Number(b.is_cover) - Number(a.is_cover) || Number(a.orden || 0) - Number(b.orden || 0));
  const photos = stored.map((item) => {
    const local = blobUrlFor(item);
    return {
      id: item.id,
      src: local || thumbUrl(item.cloudinary_url),
      full: local || item.cloudinary_url,
      alt: item.alt_text || "",
    };
  });
  ctx.listas.offline
    .filter((item) => item.producto_id === productId && item.blob)
    .sort((a, b) => Number(a.orden || 0) - Number(b.orden || 0))
    .forEach((item) => {
      const url = blobUrlFor(item);
      photos.push({ id: item.id, src: url, full: url, alt: item.alt_text || item.filename || "" });
    });
  return photos;
}

export function coverFor(productId, ctx) {
  const photos = galleryFor(productId, ctx);
  if (!photos.length) {
    return { src: PLACEHOLDER, full: PLACEHOLDER, empty: true };
  }
  return { ...photos[0], empty: false };
}

export async function assertImageFile(file) {
  if (!file) {
    throw new Error("No se recibió imagen");
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error(`${file.name} supera 5MB`);
  }
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const webp =
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50;
  if (!jpeg && !png && !webp) {
    throw new Error(`${file.name} no es JPEG, PNG ni WEBP`);
  }
}

export async function attachPhotos(productoId, files) {
  const notes = [];
  const existing = await db.producto_imagenes.where("producto_id").equals(productoId).count();
  const queued = await db.offline_media_queue.where("producto_id").equals(productoId).count();
  let orden = existing + queued;
  let needsCover = existing + queued === 0;
  for (const file of files || []) {
    try {
      await assertImageFile(file);
    } catch (err) {
      notes.push(err.message);
      continue;
    }
    const id = newId();
    let stored = false;
    if (navigator.onLine) {
      const result = await uploadMediaBlob(file, file.name, id);
      if (result.ok && result.data && result.data.ok) {
        await saveLocal("producto_imagenes", {
          id,
          producto_id: productoId,
          cloudinary_url: result.data.url,
          cloudinary_public_id: result.data.public_id,
          thumbnail_url: result.data.thumbnail_url || "",
          alt_text: file.name,
          orden,
          is_cover: needsCover,
          is_active: true,
        });
        stored = true;
        needsCover = false;
      } else if (result.status === 400 || result.status === 502 || result.status === 503) {
        notes.push((result.data && result.data.error) || `${file.name} no se pudo subir`);
        if (result.status === 400) {
          continue;
        }
      }
    }
    if (!stored) {
      await queueOfflineImage(productoId, file, file.name, {
        id,
        orden,
        is_cover: needsCover,
        alt_text: file.name,
      });
      notes.push(`${file.name} quedó en la cola offline`);
      needsCover = false;
    }
    orden += 1;
  }
  return notes;
}

async function ensureCover(productoId) {
  const active = await db.producto_imagenes
    .where("producto_id")
    .equals(productoId)
    .filter((row) => row.is_active !== false && (row.cloudinary_url || row.local_blob))
    .toArray();
  const queued = await db.offline_media_queue.where("producto_id").equals(productoId).toArray();
  const hasCover =
    active.some((row) => row.is_cover) || queued.some((row) => row.is_cover);
  if (hasCover) {
    return;
  }
  const next = active.sort((a, b) => Number(a.orden || 0) - Number(b.orden || 0))[0];
  if (next) {
    await saveLocal("producto_imagenes", { ...next, is_cover: true });
    return;
  }
  const pending = queued.sort((a, b) => Number(a.orden || 0) - Number(b.orden || 0))[0];
  if (pending) {
    await db.offline_media_queue.update(pending.id, { is_cover: true });
  }
}

export async function removeProductImage(imageId, productoId) {
  const queued = await db.offline_media_queue.get(imageId);
  if (queued) {
    await db.offline_media_queue.delete(imageId);
    await ensureCover(productoId);
    return { ok: true, queued: true };
  }
  const row = await db.producto_imagenes.get(imageId);
  if (!row || row.producto_id !== productoId) {
    return { ok: false };
  }
  await saveLocal("producto_imagenes", { ...row, is_active: false, is_cover: false });
  await ensureCover(productoId);
  return { ok: true };
}

export async function writeHistorico(productoId, refEntrada, refVenta, movimientoId) {
  const openRows = await db.historico_ref.filter((row) => row.producto_id === productoId && !row.vigente_hasta).toArray();
  const stamp = nowIso();
  for (const row of openRows) {
    await saveLocal("historico_ref", { ...row, vigente_hasta: stamp });
  }
  await saveLocal("historico_ref", {
    producto_id: productoId,
    ref_entrada: num(refEntrada),
    ref_venta: num(refVenta),
    vigente_desde: stamp,
    vigente_hasta: null,
    movimiento_id: movimientoId || null,
    is_active: true,
  });
}

export async function createProduct(input, files = []) {
  const qty = Math.max(0, num(input.stock));
  const product = await saveLocal("productos", {
    categoria_id: input.categoria_id || null,
    subcategoria_id: input.subcategoria_id || null,
    codigo: input.codigo || "",
    descripcion: input.descripcion,
    atributos: input.atributos || {},
    proveedor_id: input.proveedor_id || null,
    stock: qty,
    stock_minimo: input.stock_minimo === "" || input.stock_minimo === null || input.stock_minimo === undefined ? null : num(input.stock_minimo),
    ref_entrada: num(input.ref_entrada),
    ref_venta: num(input.ref_venta),
    solicitar_restock: false,
    is_active: true,
  });
  let movimientoId = null;
  if (qty > 0) {
    movimientoId = newId();
    const proveedor = input.proveedor_id ? await db.proveedores.get(input.proveedor_id) : null;
    await saveLocal("movimientos_inventario", {
      id: movimientoId,
      tipo: "entrada",
      fecha: new Date().toISOString().slice(0, 10),
      producto_id: product.id,
      cantidad: qty,
      proveedor_id: input.proveedor_id || null,
      codigo_proveedor: proveedor ? proveedor.codigo_proveedor : "",
      nombre_proveedor: proveedor ? proveedor.razon_social : "",
      ref_unitario: product.ref_entrada,
      monto_ref: qty * product.ref_entrada,
      descripcion: product.descripcion,
      caracteristicas: product.atributos || {},
      payload: { origen: "carga_catalogo" },
      is_active: true,
    });
  }
  await writeHistorico(product.id, product.ref_entrada, product.ref_venta, movimientoId);
  const notes = await attachPhotos(product.id, files);
  return { product, notes, created: true };
}

export async function updateProduct(existing, input, files = []) {
  const next = await saveLocal("productos", {
    ...existing,
    categoria_id: input.categoria_id || null,
    subcategoria_id: input.subcategoria_id || null,
    codigo: input.codigo || "",
    descripcion: input.descripcion,
    atributos: input.atributos || {},
    proveedor_id: input.proveedor_id || null,
    stock: existing.stock,
    stock_minimo: input.stock_minimo === "" || input.stock_minimo === null || input.stock_minimo === undefined ? null : num(input.stock_minimo),
    ref_entrada: num(input.ref_entrada),
    ref_venta: num(input.ref_venta),
  });
  const priceChanged = num(existing.ref_entrada) !== next.ref_entrada || num(existing.ref_venta) !== next.ref_venta;
  if (priceChanged) {
    await writeHistorico(next.id, next.ref_entrada, next.ref_venta, null);
  }
  const notes = await attachPhotos(next.id, files);
  return { product: next, notes, created: false };
}

export async function deleteProduct(product) {
  if (!product || !product.id) {
    return null;
  }
  const reason = await promptJustification(
    "Eliminar artículo",
    "Indique por qué se elimina este artículo. El historial de entradas y salidas se conserva."
  );
  if (!reason) {
    return null;
  }
  const current = (await db.productos.get(product.id)) || product;
  const images = await db.producto_imagenes.where("producto_id").equals(current.id).toArray();
  for (const image of images) {
    if (image.is_active !== false) {
      await saveLocal("producto_imagenes", { ...image, is_active: false, is_cover: false });
    }
  }
  const queued = await db.offline_media_queue.where("producto_id").equals(current.id).toArray();
  for (const item of queued) {
    await db.offline_media_queue.delete(item.id);
  }
  const links = await db.producto_proveedores.where("producto_id").equals(current.id).toArray();
  for (const link of links) {
    if (link.is_active !== false) {
      await saveLocal("producto_proveedores", { ...link, is_active: false });
    }
  }
  const solicitudes = await db.solicitudes_restock.where("producto_id").equals(current.id).toArray();
  for (const row of solicitudes) {
    if (row.is_active !== false) {
      await saveLocal("solicitudes_restock", {
        ...row,
        is_active: false,
        estado: row.estado === "pendiente" ? "cancelada" : row.estado,
        notas: [row.notas, `Eliminado: ${reason}`].filter(Boolean).join(" · "),
      });
    }
  }
  return saveLocal("productos", {
    ...current,
    is_active: false,
    solicitar_restock: false,
  });
}

export async function findByCodigo(codigo, subcategoriaId) {
  const wanted = String(codigo || "").trim().toLowerCase();
  if (!wanted) {
    return null;
  }
  const rows = await db.productos.filter((row) => String(row.codigo || "").trim().toLowerCase() === wanted).toArray();
  if (subcategoriaId) {
    return rows.find((row) => row.subcategoria_id === subcategoriaId) || null;
  }
  return rows[0] || null;
}

function foldHeader(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_./\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function campoNamesOf(campos) {
  return (Array.isArray(campos) ? campos : [])
    .map((item) => (typeof item === "string" ? item : item && item.nombre))
    .filter(Boolean);
}

function headerToken(cell, campoNames) {
  const folded = foldHeader(cell);
  if (!folded) {
    return null;
  }
  if (["codigo", "cod", "sku", "code", "codigo producto", "codigo de producto"].includes(folded) || folded.includes("codigo")) {
    return "codigo";
  }
  if (["descripcion", "desc", "producto", "nombre", "detalle", "repuesto"].includes(folded) || folded.includes("descrip")) {
    return "descripcion";
  }
  if (
    folded === "costo" ||
    folded.includes("costo") ||
    folded.includes("ref entrada") ||
    folded.includes("precio costo") ||
    folded.includes("precio de costo")
  ) {
    return "ref_entrada";
  }
  if (
    folded === "venta" ||
    folded === "precio" ||
    folded === "pvp" ||
    folded.startsWith("venta ") ||
    folded.endsWith(" venta") ||
    folded.includes("venta ref") ||
    folded.includes("ref venta") ||
    folded.includes("precio de venta") ||
    folded.includes("precio venta") ||
    folded.includes("pvp")
  ) {
    return "ref_venta";
  }
  if (
    ["stock", "existencia", "existencias", "cantidad", "cant", "qty", "cantidad disponible"].includes(folded) ||
    folded.includes("stock") ||
    folded.includes("existenc")
  ) {
    return "stock";
  }
  const campo = campoNames.find((name) => foldHeader(name) === folded);
  if (campo) {
    return { attr: campo };
  }
  return null;
}

function splitDelimited(line, delimiter) {
  if (!line.includes('"')) {
    return line.split(delimiter).map((part) => part.trim());
  }
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function detectDelimiter(lines) {
  const uses = (mark, minHits = 1) => lines.filter((line) => (line.split(mark).length - 1) >= minHits).length;
  const threshold = Math.max(1, Math.ceil(lines.length / 2));
  if (uses("\t") >= threshold || (lines.length === 1 && lines[0].includes("\t"))) {
    return "\t";
  }
  if (uses("|") >= threshold || (lines.length === 1 && lines[0].includes("|"))) {
    return "|";
  }
  if (uses(";", 2) >= threshold) {
    return ";";
  }
  return null;
}

function readPairs(text, attrs) {
  String(text || "")
    .split(";")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const eq = pair.indexOf("=");
      if (eq <= 0) {
        return;
      }
      attrs[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
    });
}

function numberish(value) {
  let raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  raw = raw.replace(/[$]/g, "").replace(/\b(ref|bs|usd)\b/gi, "").replace(/\s/g, "");
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw)) {
    return raw.replace(/\./g, "").replace(",", ".");
  }
  if (/^-?\d+,\d+$/.test(raw)) {
    return raw.replace(",", ".");
  }
  return raw;
}

function blankParsed(extra = {}) {
  return {
    codigo: "",
    descripcion: "",
    ref_entrada: "0",
    ref_venta: "0",
    stock: "0",
    atributos: {},
    ...extra,
  };
}

export function parseCatalogLines(text, campos = []) {
  const campoNames = campoNamesOf(campos);
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim());
  if (!lines.length) {
    return [];
  }
  const delimiter = detectDelimiter(lines);
  if (!delimiter) {
    return lines
      .map((line) => blankParsed({ descripcion: line.trim() }))
      .filter((row) => row.descripcion);
  }
  const matrix = lines.map((line) => splitDelimited(line, delimiter));
  const tokens = matrix[0].map((cell) => headerToken(cell, campoNames));
  const header = tokens.filter(Boolean).length >= 2;
  const body = header ? matrix.slice(1) : matrix;
  const rows = body.map((parts) => {
    if (!header) {
      const attrs = {};
      if (delimiter === "|" && parts[5] && parts[5].includes("=")) {
        readPairs(parts[5], attrs);
      }
      if (parts.length === 1) {
        return blankParsed({ descripcion: parts[0] || "", atributos: attrs });
      }
      return blankParsed({
        codigo: parts[0] || "",
        descripcion: parts[1] || "",
        ref_entrada: numberish(parts[2] || "0") || "0",
        ref_venta: numberish(parts[3] || "0") || "0",
        stock: numberish(parts[4] || "0") || "0",
        atributos: attrs,
      });
    }
    const row = blankParsed();
    tokens.forEach((token, index) => {
      if (!token) {
        return;
      }
      const value = parts[index] || "";
      if (typeof token === "object") {
        if (value) {
          row.atributos[token.attr] = value;
        }
        return;
      }
      if (token === "codigo" || token === "descripcion") {
        row[token] = value;
        return;
      }
      row[token] = numberish(value);
    });
    return row;
  });
  return rows.filter((row) => row.descripcion || row.codigo);
}

export async function requestRestock(product, note = "Solicitud desde el buscador") {
  const current = (await db.productos.get(product.id)) || product;
  await saveLocal("productos", { ...current, solicitar_restock: true });
  const pending = await db.solicitudes_restock
    .filter((row) => row.producto_id === current.id && row.estado === "pendiente" && row.is_active !== false)
    .first();
  if (!pending) {
    await saveLocal("solicitudes_restock", {
      producto_id: current.id,
      cantidad_sugerida: num(current.stock_minimo) || 1,
      notas: note,
      estado: "pendiente",
      is_active: true,
    });
  }
}

export async function raiseSalePrices(percent) {
  const factor = 1 + Number(percent) / 100;
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new Error("Indique un porcentaje válido.");
  }
  const products = (await db.productos.toArray()).filter((row) => row.is_active !== false);
  let count = 0;
  for (const product of products) {
    const nextSale = Math.round(num(product.ref_venta) * factor * 10000) / 10000;
    await saveLocal("productos", { ...product, ref_venta: nextSale });
    await writeHistorico(product.id, product.ref_entrada, nextSale, null);
    count += 1;
  }
  return count;
}
