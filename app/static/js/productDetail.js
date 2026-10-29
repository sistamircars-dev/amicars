import { formatPair, galleryFor, loadContext, PLACEHOLDER, requestRestock, safeImg } from "./catalog.js";
import { db } from "./db.js";
import { h } from "./dom.js";
import { formatDisplayDate, lastArrivalByProduct } from "./movements.js?v=52";
import { go } from "./nav.js";
import { openProductForm } from "./productForm.js?v=37";
import { getTasa } from "./store.js";
import { mountZoom } from "./zoom.js";

export async function openProduct(productId) {
  const ctx = await loadContext();
  const product = ctx.productos.get(productId);
  if (!product) {
    return;
  }
  const tasa = ctx.tasa || (await getTasa());
  const arrivals = lastArrivalByProduct(await db.movimientos_inventario.toArray());
  const llegada = arrivals.get(product.id);
  const photos = galleryFor(product.id, ctx);
  const cover = photos[0] || { src: PLACEHOLDER, full: PLACEHOLDER, empty: true };
  const proveedor = ctx.proveedores.get(product.proveedor_id);
  const sinStock = Number(product.stock || 0) <= 0;
  const back = h("div", { class: "modal-back" });
  const box = h("div", { class: sinStock ? "glass modal wide ficha-sin-stock" : "glass modal wide" });
  const img = safeImg(cover.src, product.descripcion, "zoom-base");
  img.dataset.full = cover.full || cover.src;
  img.dataset.empty = cover.empty ? "1" : "0";
  const stage = h("div", { class: "zoom-stage" }, img);
  const thumbs = h("div", { class: "thumb-row" });
  photos.forEach((photo) => {
    const thumb = safeImg(photo.src, photo.alt || product.descripcion, "detail-thumb");
    thumb.addEventListener("click", () => {
      img.src = photo.src;
      img.dataset.full = photo.full;
      img.dataset.empty = "0";
    });
    thumbs.append(thumb);
  });
  if (!photos.length) {
    thumbs.append(h("p", { class: "muted" }, "Sin fotografía. Se muestra el logo AMIRCARS."));
  }
  const attrs = Object.entries(product.atributos || {}).filter(([, value]) => String(value || "").trim());
  const close = h("button", { class: "btn ghost", type: "button" }, "Cerrar");
  const edit = h("button", { class: "btn", type: "button" }, "Editar ficha");
  const salida = h("button", { class: "btn", type: "button" }, "Generar salida");
  const restock = sinStock
    ? h("button", { class: "btn", type: "button" }, product.solicitar_restock ? "Re-stock solicitado" : "Solicitar Re-stock")
    : null;
  if (restock) {
    restock.disabled = product.solicitar_restock === true;
    restock.addEventListener("click", async () => {
      await requestRestock(product);
      restock.textContent = "Re-stock solicitado";
      restock.disabled = true;
    });
  }
  close.addEventListener("click", () => back.remove());
  salida.addEventListener("click", () => {
    back.remove();
    go("salidas", { productoId: product.id });
  });
  edit.addEventListener("click", async () => {
    back.remove();
    const saved = await openProductForm(product);
    if (saved) {
      await openProduct(saved.id);
    }
  });
  back.addEventListener("click", (event) => {
    if (event.target === back) {
      back.remove();
    }
  });
  box.append(
    h(
      "div",
      { class: "detail-layout" },
      stage,
      h(
        "div",
        {},
        h("h3", {}, product.descripcion),
        sinStock ? h("p", { class: "sin-stock-tag" }, "Sin stock") : null,
        h("p", {}, product.codigo || "Sin código"),
        h("p", {}, `Stock: ${product.stock}`),
        h("p", {}, `Llegada: ${llegada ? formatDisplayDate(llegada) : "—"}`),
        h("p", {}, `Costo: ${formatPair(product.ref_entrada, tasa)}`),
        h("p", {}, `Venta: ${formatPair(product.ref_venta, tasa)}`),
        h("p", {}, proveedor ? `Proveedor: ${proveedor.razon_social}` : "Sin proveedor"),
        attrs.length ? h("ul", { class: "attr-list" }, ...attrs.map(([key, value]) => h("li", {}, `${key}: ${value}`))) : h("p", {}, "Sin características."),
        thumbs
      )
    ),
    h("div", { class: "modal-actions" }, close, restock, salida, edit)
  );
  back.append(box);
  document.body.append(back);
  mountZoom(stage);
}

export async function openProductImage(productId, extras = []) {
  const ctx = await loadContext();
  const product = productId ? ctx.productos.get(productId) : null;
  const stored = product ? galleryFor(product.id, ctx) : [];
  const extraPhotos = (extras || [])
    .filter(Boolean)
    .map((src, index) => ({ id: `local-${index}`, src, full: src, alt: "Foto de la entrada" }));
  const photos = [...stored, ...extraPhotos];
  if (!product && !photos.length) {
    return;
  }
  const title = product?.descripcion || product?.codigo || "Producto";
  const cover = photos[0] || { src: PLACEHOLDER, full: PLACEHOLDER, empty: true };
  const back = h("div", { class: "modal-back" });
  const box = h("div", { class: "glass modal wide" });
  const img = safeImg(cover.src, title, "zoom-base");
  img.dataset.full = cover.full || cover.src;
  img.dataset.empty = cover.empty ? "1" : "0";
  const stage = h("div", { class: "zoom-stage" }, img);
  const thumbs = h("div", { class: "thumb-row" });
  photos.forEach((photo) => {
    const thumb = safeImg(photo.src, photo.alt || title, "detail-thumb");
    thumb.addEventListener("click", () => {
      img.src = photo.src;
      img.dataset.full = photo.full;
      img.dataset.empty = "0";
    });
    thumbs.append(thumb);
  });
  if (!photos.length) {
    thumbs.append(h("p", { class: "muted" }, "Sin fotografía. Se muestra el logo AMIRCARS."));
  }
  const close = h("button", { class: "btn ghost", type: "button" }, "Cerrar");
  close.addEventListener("click", () => back.remove());
  back.addEventListener("click", (event) => {
    if (event.target === back) {
      back.remove();
    }
  });
  box.append(h("h3", {}, title), stage, thumbs, h("div", { class: "modal-actions" }, close));
  back.append(box);
  document.body.append(back);
  mountZoom(stage);
}
