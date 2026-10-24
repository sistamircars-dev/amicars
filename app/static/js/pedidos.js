import { db } from "./db.js";
import { h } from "./dom.js";
import { effectiveMinimum } from "./movements.js";
import { saveLocal } from "./repository.js";
import { getConfig } from "./store.js";

export async function renderPedidos(root) {
  const status = h("p", { class: "muted" }, "");
  const listHost = h("div", { class: "table-wrap" });
  const globalMin = await getConfig("stock_minimo_global", { cantidad: 1 });
  const productos = (await db.productos.toArray()).filter((row) => row.is_active !== false);
  const proveedores = await db.proveedores.toArray();
  const solicitudes = await db.solicitudes_restock.filter((row) => row.estado === "pendiente" && row.is_active !== false).toArray();
  const rows = [];
  for (const product of productos) {
    const minimum = await effectiveMinimum(product);
    const pending = solicitudes.filter((row) => row.producto_id === product.id);
    const below = Number(product.stock || 0) <= minimum;
    if (!below && !product.solicitar_restock && !pending.length) {
      continue;
    }
    const gap = Math.max(minimum - Number(product.stock || 0), 0);
    const requested = pending.reduce((sum, row) => sum + Number(row.cantidad_sugerida || 0), 0);
    const suggested = Math.max(gap, requested, 1);
    const provider = proveedores.find((row) => row.id === product.proveedor_id);
    rows.push({ product, minimum, suggested, provider, pending: pending.length > 0 || product.solicitar_restock });
  }
  rows.sort((a, b) => (a.provider?.razon_social || "").localeCompare(b.provider?.razon_social || "", "es") || a.product.descripcion.localeCompare(b.product.descripcion, "es"));

  listHost.replaceChildren(
    rows.length
      ? h(
          "table",
          { class: "data-table" },
          h("thead", {}, h("tr", {}, h("th", {}, "Proveedor"), h("th", {}, "Repuesto"), h("th", {}, "Stock"), h("th", {}, "Mínimo"), h("th", {}, "Sugerido"), h("th", {}, "Origen"), h("th", {}, "Mínimo del producto"))),
          h(
            "tbody",
            {},
            ...rows.map((row) => {
              const input = h("input", { class: "app-input", type: "number", min: "0", step: "1" });
              input.value = row.product.stock_minimo === null || row.product.stock_minimo === undefined ? "" : String(row.product.stock_minimo);
              const save = h("button", { class: "btn small ghost", type: "button" }, "Guardar");
              save.addEventListener("click", async () => {
                const value = input.value.trim();
                await saveLocal("productos", { ...row.product, stock_minimo: value === "" ? null : Number(value) });
                status.textContent = `Mínimo de ${row.product.descripcion} actualizado.`;
                renderPedidos(root);
              });
              return h(
                "tr",
                { class: Number(row.product.stock || 0) <= 0 ? "stock-zero" : "" },
                h("td", {}, row.provider ? `${row.provider.codigo_proveedor} · ${row.provider.razon_social}` : "Sin proveedor"),
                h("td", {}, row.product.descripcion),
                h("td", {}, String(row.product.stock ?? 0)),
                h("td", {}, String(row.minimum)),
                h("td", {}, String(row.suggested)),
                h("td", {}, row.pending ? "Re-stock / mínimo" : "Stock mínimo"),
                h("td", {}, input, save)
              );
            })
          )
        )
      : h("div", { class: "empty glass" }, "Ningún repuesto está en el mínimo ni tiene re-stock pendiente.")
  );

  root.replaceChildren(
    h("div", { class: "view-title" }, h("h2", {}, "Sugerencia de pedido")),
    h("p", { class: "muted" }, `Mínimo global: ${globalMin?.cantidad ?? 1}. Si el producto no tiene mínimo propio, se usa el del proveedor vinculado y, si tampoco existe, el global. Se suman las solicitudes de re-stock.`),
    status,
    listHost
  );
}
