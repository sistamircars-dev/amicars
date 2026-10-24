import { matchesQuery, num, wordsOf } from "./catalog.js";
import { db } from "./db.js";
import { h } from "./dom.js";
import { downloadTablePdf } from "./exportDocs.js?v=40";
import { backfillSupplierLinks, formatDisplayDate, todayLocal } from "./movements.js?v=36";
import { saveLocal } from "./repository.js";
import { getConfig } from "./store.js";

function productLabel(product) {
  if (!product) {
    return "Repuesto";
  }
  return `${product.codigo ? `${product.codigo} · ` : ""}${product.descripcion}`;
}

function providerLabel(provider) {
  if (!provider) {
    return "Sin proveedor";
  }
  return `${provider.codigo_proveedor} · ${provider.razon_social}`;
}

function providerBlob(provider) {
  if (!provider) {
    return "sin proveedor";
  }
  return [provider.codigo_proveedor, provider.razon_social, provider.contacto, provider.telefono, provider.email]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function productSearchBlob(product) {
  return [product.codigo, product.descripcion].filter(Boolean).join(" ").toLowerCase();
}

function minimumOf(product, links, globalMin) {
  if (product.stock_minimo !== null && product.stock_minimo !== undefined && product.stock_minimo !== "") {
    return num(product.stock_minimo);
  }
  const link = links.find(
    (row) =>
      row.producto_id === product.id &&
      row.is_active !== false &&
      row.stock_minimo !== null &&
      row.stock_minimo !== undefined &&
      row.stock_minimo !== ""
  );
  if (link) {
    return num(link.stock_minimo);
  }
  return num(globalMin && globalMin.cantidad !== undefined ? globalMin.cantidad : 1);
}

function providersOf(product, proveedores, links) {
  const ids = new Set();
  if (product.proveedor_id) {
    ids.add(product.proveedor_id);
  }
  links
    .filter((row) => row.producto_id === product.id && row.is_active !== false)
    .forEach((row) => ids.add(row.proveedor_id));
  const found = [...ids].map((id) => proveedores.find((row) => row.id === id)).filter(Boolean);
  return found.length ? found : [null];
}

function qtyKey(groupId, productId) {
  return `${groupId}:${productId}`;
}

export async function renderPedidos(root) {
  const status = h("p", { class: "muted" }, "");
  const summary = h("p", { class: "muted order-summary" }, "");
  const chips = h("div", { class: "word-chips" });
  const listHost = h("div", { class: "table-wrap" });
  const searchInput = h("input", {
    class: "app-input",
    type: "search",
    placeholder: "Buscar proveedor o repuesto…",
    autocomplete: "off",
    "aria-label": "Buscar proveedores y productos",
  });
  const qtyByProduct = new Map();
  const persistTimers = new Map();
  const totalEls = new Map();
  const askButtons = [];
  let query = "";
  let expandedId = null;
  let groups = [];
  let solicitudes = [];
  let refreshToken = 0;

  function paintChips(dictionary) {
    const last = query.split(/\s+/).pop()?.toLowerCase() || "";
    const completions = last.length >= 2 ? dictionary.filter((word) => word.startsWith(last) && word !== last).slice(0, 8) : [];
    chips.replaceChildren(
      ...completions.map((word) => {
        const chip = h("button", { class: "word-chip", type: "button" }, word);
        chip.addEventListener("click", () => {
          const bits = query.split(/\s+/).filter(Boolean);
          if (last) {
            bits.pop();
          }
          bits.push(word);
          query = `${bits.join(" ")} `;
          searchInput.value = query;
          paint();
        });
        return chip;
      })
    );
  }

  function qtyOf(groupId, productId) {
    return Math.max(0, num(qtyByProduct.get(qtyKey(groupId, productId)) || 0));
  }

  function productQtyEverywhere(productId) {
    let total = 0;
    qtyByProduct.forEach((value, key) => {
      if (key.endsWith(`:${productId}`)) {
        total += num(value);
      }
    });
    return total;
  }

  function groupTotal(group) {
    return group.items.reduce((sum, item) => sum + qtyOf(group.id, item.product.id), 0);
  }

  function orderedLines() {
    return groups.reduce((sum, group) => sum + group.items.filter((item) => qtyOf(group.id, item.product.id) > 0).length, 0);
  }

  function grandTotal() {
    return groups.reduce((sum, group) => sum + groupTotal(group), 0);
  }

  function updateTotals() {
    groups.forEach((group) => {
      const el = totalEls.get(group.id);
      if (el) {
        el.textContent = String(groupTotal(group));
      }
    });
    const units = grandTotal();
    const lines = orderedLines();
    summary.textContent = units
      ? `Pedido: ${units} unidad${units === 1 ? "" : "es"} en ${lines} línea${lines === 1 ? "" : "s"}. Cero no se pide.`
      : "Coloque una cantidad para totalizar el pedido. Deje 0 si no se pide.";
    askButtons.forEach((button) => {
      const group = groups.find((item) => item.id === button.dataset.group);
      button.disabled = !group || groupTotal(group) < 1;
    });
  }

  function visibleGroups() {
    return groups
      .map((group) => {
        const providerHit = matchesQuery(group.blob, query);
        const items = providerHit ? group.items : group.items.filter((item) => matchesQuery(item.blob, query));
        if (!items.length) {
          return null;
        }
        return { ...group, items, providerHit };
      })
      .filter(Boolean);
  }

  async function persistQty(product) {
    const qty = productQtyEverywhere(product.id);
    const pending = solicitudes.find((row) => row.producto_id === product.id && row.estado === "pendiente" && row.is_active !== false);
    if (qty < 1) {
      if (pending) {
        await saveLocal("solicitudes_restock", { ...pending, cantidad_sugerida: 0, estado: "cancelada", is_active: false });
        solicitudes = solicitudes.filter((row) => row.id !== pending.id);
      }
      if (product.solicitar_restock) {
        const saved = await saveLocal("productos", { ...product, solicitar_restock: false });
        Object.assign(product, saved);
      }
      return;
    }
    if (pending) {
      const saved = await saveLocal("solicitudes_restock", { ...pending, cantidad_sugerida: qty, estado: "pendiente", is_active: true });
      Object.assign(pending, saved);
    } else {
      const saved = await saveLocal("solicitudes_restock", {
        producto_id: product.id,
        cantidad_sugerida: qty,
        notas: "Pedido desde sugerencia",
        estado: "pendiente",
        is_active: true,
      });
      solicitudes.push(saved);
    }
    if (!product.solicitar_restock) {
      const saved = await saveLocal("productos", { ...product, solicitar_restock: true });
      Object.assign(product, saved);
    }
  }

  async function flushPersists() {
    const pending = [...persistTimers.entries()];
    persistTimers.clear();
    for (const [productId, timer] of pending) {
      clearTimeout(timer);
      const item = groups.flatMap((group) => group.items).find((row) => row.product.id === productId);
      if (item) {
        await persistQty(item.product);
      }
    }
  }

  async function emitPedido(group) {
    await flushPersists();
    const lines = group.items.filter((item) => qtyOf(group.id, item.product.id) > 0);
    if (!lines.length) {
      status.textContent = "Indique una cantidad mayor que 0 para generar el pedido.";
      return;
    }
    const fechaIso = todayLocal();
    const fecha = formatDisplayDate(fechaIso);
    const provider = group.provider;
    const total = lines.reduce((sum, item) => sum + qtyOf(group.id, item.product.id), 0);
    downloadTablePdf({
      base: `pedido-${provider?.codigo_proveedor || "sin-proveedor"}`,
      title: "Pedido AMIRCARS",
      meta: [
        `Fecha de pedido: ${fecha}`,
        `Proveedor: ${providerLabel(provider)}`,
        provider?.contacto ? `Contacto: ${provider.contacto}` : "",
        provider?.telefono ? `Teléfono: ${provider.telefono}` : "",
        provider?.email ? `Correo: ${provider.email}` : "",
      ].filter(Boolean),
      headers: ["Código", "Producto", "Cantidad"],
      rows: lines.map((item) => [item.product.codigo || "—", item.product.descripcion, String(qtyOf(group.id, item.product.id))]),
      footer: [`Total a pedir: ${total}`],
    });
    status.textContent = `PDF del pedido a ${providerLabel(provider)} · ${fecha}.`;
  }

  function pedirButton(group) {
    const ask = h("button", { class: "btn small order-ask", type: "button" }, "Pedir");
    ask.dataset.group = group.id;
    ask.disabled = groupTotal(group) < 1;
    askButtons.push(ask);
    ask.addEventListener("click", async (event) => {
      event.stopPropagation();
      await flushPersists();
      if (groupTotal(group) < 1) {
        status.textContent = "Indique una cantidad mayor que 0 para generar el pedido.";
        return;
      }
      status.textContent = `Pedido a ${providerLabel(group.provider)} listo. Use Imprimir para el PDF.`;
    });
    return ask;
  }

  function printButton(group) {
    const print = h("button", { class: "btn small ghost order-ask", type: "button" }, "Imprimir");
    print.dataset.group = group.id;
    print.disabled = groupTotal(group) < 1;
    askButtons.push(print);
    print.addEventListener("click", async (event) => {
      event.stopPropagation();
      await emitPedido(group);
    });
    return print;
  }

  function schedulePersist(product) {
    const previous = persistTimers.get(product.id);
    if (previous) {
      clearTimeout(previous);
    }
    persistTimers.set(
      product.id,
      setTimeout(async () => {
        persistTimers.delete(product.id);
        try {
          await persistQty(product);
          const qty = productQtyEverywhere(product.id);
          status.textContent = qty > 0 ? `${product.descripcion}: ${qty} en el pedido.` : `${product.descripcion} no se pedirá.`;
        } catch (error) {
          status.textContent = error.message || "No se pudo guardar la cantidad.";
        }
      }, 280)
    );
  }

  function detailNodes(group) {
    return h(
      "div",
      { class: "supplier-detail" },
      h("div", { class: "supplier-detail-head" }, h("h3", {}, "Productos que hacen falta")),
      h(
        "div",
        { class: "table-wrap" },
        h(
          "table",
          { class: "data-table ops-table" },
          h("thead", {}, h("tr", {}, h("th", {}, "Producto"), h("th", {}, "Stock"), h("th", {}, "Mínimo"), h("th", {}, "Pedir"))),
          h(
            "tbody",
            {},
            ...group.items.map((item) => {
              const input = h("input", {
                class: "app-input order-qty",
                type: "number",
                min: "0",
                step: "1",
                "aria-label": `Cantidad a pedir de ${item.product.descripcion}`,
              });
              input.value = String(qtyOf(group.id, item.product.id));
              input.addEventListener("click", (event) => event.stopPropagation());
              input.addEventListener("input", () => {
                const qty = Math.max(0, Math.floor(num(input.value)));
                qtyByProduct.set(qtyKey(group.id, item.product.id), qty);
                updateTotals();
                schedulePersist(item.product);
              });
              return h(
                "tr",
                { class: num(item.product.stock) <= 0 ? "stock-zero" : "" },
                h("td", {}, productLabel(item.product)),
                h("td", {}, String(item.product.stock ?? 0)),
                h("td", {}, String(item.minimum)),
                h("td", {}, input)
              );
            })
          )
        )
      )
    );
  }

  function paint() {
    const visible = visibleGroups();
    const dictionary = [];
    const seen = new Set();
    groups.forEach((group) => {
      wordsOf(group.blob).forEach((word) => {
        if (!seen.has(word)) {
          seen.add(word);
          dictionary.push(word);
        }
      });
      group.items.forEach((item) => {
        wordsOf(item.blob).forEach((word) => {
          if (!seen.has(word)) {
            seen.add(word);
            dictionary.push(word);
          }
        });
      });
    });
    dictionary.sort((a, b) => a.localeCompare(b, "es"));
    paintChips(dictionary);
    totalEls.clear();
    askButtons.length = 0;
    const rows = [];
    visible.forEach((group) => {
      const productMatch = Boolean(query) && group.items.some((item) => matchesQuery(item.blob, query));
      const open = visible.length === 1 || (query ? productMatch || group.providerHit : expandedId === group.id);
      const totalCell = h("td", {}, String(groupTotal(group)));
      totalEls.set(group.id, totalCell);
      const tr = h(
        "tr",
        {
          class: `supplier-row${open ? " supplier-open" : ""}`,
          "aria-expanded": open ? "true" : "false",
        },
        h("td", {}, `${open ? "▾" : "▸"} ${providerLabel(group.provider)}`),
        h("td", {}, String(group.items.length)),
        totalCell,
        h("td", { class: "order-ask-cell" }, pedirButton(group), printButton(group))
      );
      tr.addEventListener("click", (event) => {
        if (event.target.closest("button, a, input, select, textarea")) {
          return;
        }
        expandedId = expandedId === group.id && visible.length !== 1 ? null : group.id;
        paint();
      });
      rows.push(tr);
      if (open) {
        rows.push(h("tr", { class: "supplier-detail-row" }, h("td", { colspan: "4" }, detailNodes(group))));
      }
    });
    listHost.replaceChildren(
      visible.length
        ? h(
            "table",
            { class: "data-table" },
            h("thead", {}, h("tr", {}, h("th", {}, "Proveedor"), h("th", {}, "Faltan"), h("th", {}, "A pedir"), h("th", {}, ""))),
            h("tbody", {}, ...rows)
          )
        : h("div", { class: "empty glass" }, query ? "Ningún proveedor o repuesto coincide con la búsqueda." : "Ningún repuesto está en el mínimo ni tiene re-stock pendiente.")
    );
    updateTotals();
  }

  async function refresh() {
    const token = ++refreshToken;
    await backfillSupplierLinks();
    const globalMin = await getConfig("stock_minimo_global", { cantidad: 1 });
    const productos = (await db.productos.toArray()).filter((row) => row.is_active !== false);
    const proveedores = await db.proveedores.toArray();
    const links = await db.producto_proveedores.toArray();
    const pending = await db.solicitudes_restock.filter((row) => row.estado === "pendiente" && row.is_active !== false).toArray();
    if (token !== refreshToken) {
      return;
    }
    solicitudes = pending;
    const byProvider = new Map();
    for (const product of productos) {
      const minimum = minimumOf(product, links, globalMin);
      const pendingRows = solicitudes.filter((row) => row.producto_id === product.id);
      const below = num(product.stock) <= minimum;
      if (!below && !product.solicitar_restock && !pendingRows.length) {
        continue;
      }
      const requested = pendingRows.reduce((sum, row) => sum + num(row.cantidad_sugerida), 0);
      const productProviders = providersOf(product, proveedores, links);
      for (const provider of productProviders) {
        const groupId = provider?.id || "sin-proveedor";
        if (!byProvider.has(groupId)) {
          byProvider.set(groupId, {
            id: groupId,
            provider,
            blob: providerBlob(provider),
            items: [],
          });
        }
        const key = qtyKey(groupId, product.id);
        if (!qtyByProduct.has(key)) {
          qtyByProduct.set(key, requested > 0 ? requested : 0);
        }
        byProvider.get(groupId).items.push({
          product,
          minimum,
          blob: productSearchBlob(product),
        });
      }
    }
    groups = [...byProvider.values()].sort((a, b) => providerLabel(a.provider).localeCompare(providerLabel(b.provider), "es"));
    groups.forEach((group) => {
      group.items.sort((a, b) => productLabel(a.product).localeCompare(productLabel(b.product), "es"));
    });
    paint();
  }

  searchInput.addEventListener("input", () => {
    query = searchInput.value.trim();
    paint();
  });

  root.replaceChildren(
    h("div", { class: "view-title" }, h("h2", {}, "Sugerencia de pedido")),
    h("p", { class: "muted" }, "El stock mínimo se ajusta en Proveedores. Aquí se pide la cantidad; 0 no entra al pedido."),
    h("div", { class: "hero-search" }, h("div", { class: "search-wrap" }, searchInput, chips)),
    summary,
    status,
    listHost
  );
  await refresh();
}
