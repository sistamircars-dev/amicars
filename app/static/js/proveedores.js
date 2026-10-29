import { matchesQuery, requestRestock } from "./catalog.js";
import { db } from "./db.js";
import { h } from "./dom.js";
import {
  backfillSupplierLinks,
  editEntradaFactura,
  formatDisplayDate,
  groupEntradaFacturas,
  voidEntradaFactura,
} from "./movements.js?v=49";
import { createDateField } from "./dateField.js?v=34";
import { promptJustification } from "./promptJustification.js?v=49";
import { openProductForm } from "./productForm.js?v=53";
import { deactivateLocal, hardDeleteLocal, saveLocal } from "./repository.js";

function providerForm(existing) {
  const codigo = h("input", { class: "app-input", required: "required" });
  const razon = h("input", { class: "app-input", required: "required" });
  const contacto = h("input", { class: "app-input" });
  const telefono = h("input", { class: "app-input" });
  const email = h("input", { class: "app-input", type: "email" });
  const notas = h("textarea", { class: "app-input", rows: "2" });
  codigo.value = existing?.codigo_proveedor || "";
  razon.value = existing?.razon_social || "";
  contacto.value = existing?.contacto || "";
  telefono.value = existing?.telefono || "";
  email.value = existing?.email || "";
  notas.value = existing?.notas || "";
  return { codigo, razon, contacto, telefono, email, notas };
}

function supplierBlob(row, productos = [], links = []) {
  const ids = new Set();
  productos.filter((product) => product.proveedor_id === row.id).forEach((product) => ids.add(product.id));
  links.filter((link) => link.proveedor_id === row.id && link.is_active !== false).forEach((link) => ids.add(link.producto_id));
  const extras = productos
    .filter((product) => ids.has(product.id))
    .map((product) => `${product.codigo || ""} ${product.descripcion || ""}`);
  return [row.codigo_proveedor, row.razon_social, row.contacto, row.telefono, row.email, row.notas, ...extras]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function supplierWords(rows) {
  const bag = new Set();
  rows.forEach((row) => {
    supplierBlob(row)
      .split(/[^0-9a-záéíóúüñ]+/i)
      .forEach((word) => {
        if (word.length >= 3) {
          bag.add(word);
        }
      });
  });
  return [...bag].sort((a, b) => a.localeCompare(b, "es"));
}

function productLabel(product) {
  if (!product) {
    return "Repuesto";
  }
  return `${product.codigo ? `${product.codigo} · ` : ""}${product.descripcion}`;
}

export async function renderProveedores(root) {
  const status = h("p", { class: "muted" }, "");
  const formHost = h("div");
  const listHost = h("div", { class: "table-wrap" });
  const searchInput = h("input", {
    class: "app-input",
    type: "search",
    placeholder: "Buscar proveedor, producto, código o descripción…",
    autocomplete: "off",
    "aria-label": "Buscar proveedores",
  });
  const chips = h("div", { class: "word-chips" });
  let editing = null;
  let formOpen = false;
  let expandedId = null;
  let minsEditingId = null;
  let query = "";
  let refreshToken = 0;
  let supplierDetailTab = "productos";

  function paintChips(rows) {
    const dictionary = supplierWords(rows);
    const last = query.split(/\s+/).pop()?.toLowerCase() || "";
    const completions = last.length >= 2 ? dictionary.filter((word) => word.startsWith(last) && word !== last).slice(0, 6) : [];
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
          refresh();
        });
        return chip;
      })
    );
  }

  function linkedSet(row, productos, links) {
    const ids = new Set(productos.filter((product) => product.proveedor_id === row.id).map((product) => product.id));
    links.filter((link) => link.proveedor_id === row.id && link.is_active !== false).forEach((link) => ids.add(link.producto_id));
    return ids;
  }

  function lastOrderDate(product, moves) {
    const dates = moves
      .filter((move) => move.producto_id === product.id && (move.tipo === "entrada" || move.payload?.origen === "entrada"))
      .map((move) => move.fecha_llegada || move.payload?.fecha_llegada || move.fecha)
      .filter(Boolean)
      .sort()
      .reverse();
    return dates[0] ? formatDisplayDate(dates[0]) : "—";
  }

  function minimumOf(product, link) {
    if (product && product.stock_minimo !== null && product.stock_minimo !== undefined && product.stock_minimo !== "") {
      return product.stock_minimo;
    }
    if (link && link.stock_minimo !== null && link.stock_minimo !== undefined && link.stock_minimo !== "") {
      return link.stock_minimo;
    }
    return "—";
  }

  function openEditFactura(group) {
    const back = h("div", { class: "modal-back" });
    const box = h("div", { class: "glass modal wide" });
    const numero = h("input", { class: "app-input" });
    const llegada = createDateField({ value: group.fecha_llegada || group.fecha, ariaLabel: "Fecha de llegada" });
    const statusModal = h("p", { class: "muted" }, "");
    numero.value = group.numero_factura || "";
    const cancel = h("button", { class: "btn ghost", type: "button" }, "Cancelar");
    const save = h("button", { class: "btn", type: "button" }, "Guardar cambios");
    cancel.addEventListener("click", () => back.remove());
    back.addEventListener("click", (event) => {
      if (event.target === back) {
        back.remove();
      }
    });
    save.addEventListener("click", async () => {
      const just = await promptJustification("Editar factura", "Justifique el cambio de número o fecha de llegada.");
      if (!just) {
        return;
      }
      try {
        await editEntradaFactura(group.key, {
          numeroFactura: numero.value.trim(),
          fechaLlegada: llegada.value,
          justification: just,
        });
        status.textContent = "Factura actualizada.";
        back.remove();
        refresh();
      } catch (err) {
        statusModal.textContent = err.message || "No se pudo guardar.";
      }
    });
    box.append(
      h("h3", {}, "Editar factura"),
      h("p", { class: "muted" }, `${group.lineas.length} línea(s) · ${formatDisplayDate(group.fecha)}`),
      h("div", { class: "form-grid" }, h("label", { class: "field-row" }, "Número de factura", numero), h("label", { class: "field-row" }, "Fecha de llegada", llegada)),
      statusModal,
      h("div", { class: "modal-actions" }, cancel, save)
    );
    back.append(box);
    document.body.append(back);
    numero.focus();
  }

  function facturasTab(row, moves, allMoves, productos) {
    const groups = groupEntradaFacturas(moves, row.id, allMoves);
    if (!groups.length) {
      return h("p", { class: "muted" }, "No hay facturas de entrada registradas para este proveedor.");
    }
    const nodes = [];
    groups.forEach((group) => {
      const totalRef = group.lineas.reduce((sum, line) => sum + Number(line.monto_ref || 0), 0);
      const edit = h("button", { class: "btn small ghost", type: "button" }, "Editar");
      edit.addEventListener("click", (event) => {
        event.stopPropagation();
        openEditFactura(group);
      });
      const cancel = h("button", { class: "btn small danger", type: "button" }, "Anular");
      cancel.addEventListener("click", async (event) => {
        event.stopPropagation();
        const just = await promptJustification(`Anular factura ${group.numero_factura || ""}`.trim());
        if (!just) {
          return;
        }
        try {
          await voidEntradaFactura(group.key, just);
          status.textContent = "Factura anulada.";
          refresh();
        } catch (err) {
          status.textContent = err.message || "No se pudo anular.";
        }
      });
      nodes.push(
        h(
          "tr",
          {},
          h("td", {}, group.numero_factura || "—"),
          h("td", {}, formatDisplayDate(group.fecha_llegada)),
          h("td", {}, formatDisplayDate(group.fecha)),
          h("td", {}, String(group.lineas.length)),
          h("td", {}, totalRef.toFixed(2)),
          h("td", {}, edit, cancel)
        )
      );
      nodes.push(
        h(
          "tr",
          { class: "invoice-items-row" },
          h(
            "td",
            { colspan: "6" },
            h(
              "ul",
              { class: "invoice-item-list" },
              ...group.lineas.map((line) => {
                const product = productos.find((item) => item.id === line.producto_id);
                const code = product?.codigo || "";
                const name = line.descripcion || product?.descripcion || "Ítem";
                return h("li", {}, `${code ? `${code} · ` : ""}${name} · cant. ${line.cantidad} · ${Number(line.ref_unitario || 0).toFixed(2)} REF`);
              })
            )
          )
        )
      );
    });
    return h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        { class: "data-table" },
        h("thead", {}, h("tr", {}, h("th", {}, "Factura"), h("th", {}, "Llegada"), h("th", {}, "Fecha registro"), h("th", {}, "Ítems"), h("th", {}, "REF"), h("th", {}, ""))),
        h("tbody", {}, ...nodes)
      )
    );
  }

  function detailNodes(row, productos, links, moves, solicitudes, allMoves) {
    const rowLinks = links.filter((link) => link.proveedor_id === row.id && link.is_active !== false);
    const shown = new Map();
    productos
      .filter((product) => product.proveedor_id === row.id)
      .forEach((product) => shown.set(product.id, { product, link: null }));
    rowLinks.forEach((link) => {
      const product = productos.find((item) => item.id === link.producto_id) || shown.get(link.producto_id)?.product;
      shown.set(link.producto_id, { product, link });
    });
    moves
      .filter((move) => move.tipo === "entrada" && move.proveedor_id === row.id && move.producto_id)
      .forEach((move) => {
        if (shown.has(move.producto_id)) {
          return;
        }
        shown.set(move.producto_id, {
          product: productos.find((item) => item.id === move.producto_id) || null,
          link: null,
        });
      });
    const items = [...shown.values()];
    const editingMins = minsEditingId === row.id;
    const drafts = new Map();
    items.forEach(({ product, link }) => {
      if (product) {
        drafts.set(product.id, String(minimumOf(product, link) === "—" ? "" : minimumOf(product, link)));
      }
    });
    const saveMins = h("button", { class: "btn small", type: "button" }, "Guardar");
    saveMins.disabled = !editingMins;
    saveMins.addEventListener("click", async (event) => {
      event.stopPropagation();
      for (const { product, link } of items) {
        if (!product) {
          continue;
        }
        const raw = drafts.get(product.id);
        const stockMinimo = String(raw ?? "").trim() === "" ? null : Number(raw);
        await saveLocal("productos", { ...product, stock_minimo: stockMinimo });
        const existing = link || (await db.producto_proveedores.filter((item) => item.proveedor_id === row.id && item.producto_id === product.id).first());
        await saveLocal("producto_proveedores", {
          ...(existing || {}),
          producto_id: product.id,
          proveedor_id: row.id,
          stock_minimo: stockMinimo,
          is_active: true,
        });
      }
      minsEditingId = null;
      status.textContent = "Stock mínimo registrado.";
      refresh();
    });
    const tabProductos = h("button", { class: supplierDetailTab === "productos" ? "btn small" : "btn small ghost", type: "button" }, "Productos");
    const tabFacturas = h("button", { class: supplierDetailTab === "facturas" ? "btn small" : "btn small ghost", type: "button" }, "Histórico facturas");
    tabProductos.addEventListener("click", (event) => {
      event.stopPropagation();
      supplierDetailTab = "productos";
      refresh();
    });
    tabFacturas.addEventListener("click", (event) => {
      event.stopPropagation();
      supplierDetailTab = "facturas";
      refresh();
    });
    const productosPanel =
      items.length
        ? h(
            "div",
            { class: "table-wrap" },
            h(
              "table",
              { class: "data-table ops-table" },
              h(
                "thead",
                {},
                h(
                  "tr",
                  {},
                  h("th", {}, "Producto"),
                  h("th", {}, "Stock mínimo"),
                  h("th", {}, "Último pedido"),
                  h("th", {}, "Stock"),
                  h("th", {}, "")
                )
              ),
              h(
                "tbody",
                {},
                ...items.map(({ product, link }) => {
                  if (!product) {
                    return h("tr", {}, h("td", { colspan: "5" }, "Repuesto no encontrado"));
                  }
                  const pending = solicitudes.some((item) => item.producto_id === product.id) || product.solicitar_restock;
                  const editProduct = h("button", { class: "btn small ghost", type: "button", title: "Editar producto", "aria-label": "Editar producto" }, "✎");
                  editProduct.addEventListener("click", async (event) => {
                    event.stopPropagation();
                    if (await openProductForm(product)) {
                      refresh();
                    }
                  });
                  const minInput = h("input", {
                    class: "app-input order-qty",
                    type: "number",
                    min: "0",
                    step: "1",
                    "aria-label": `Stock mínimo de ${product.descripcion}`,
                  });
                  minInput.value = drafts.get(product.id) || "";
                  minInput.disabled = !editingMins;
                  minInput.addEventListener("click", (event) => event.stopPropagation());
                  minInput.addEventListener("input", () => {
                    drafts.set(product.id, minInput.value);
                  });
                  const ask = h("button", { class: "btn small ghost", type: "button" }, pending ? "En sugerencia" : "Enviar a pedido");
                  ask.disabled = pending;
                  ask.addEventListener("click", async (event) => {
                    event.stopPropagation();
                    await requestRestock(product, "Solicitud desde proveedores");
                    status.textContent = `${product.descripcion} pasó a sugerencia de pedido.`;
                    refresh();
                  });
                  return h(
                    "tr",
                    {},
                    h("td", {}, h("div", { class: "product-line-name" }, editProduct, productLabel(product))),
                    h("td", {}, minInput),
                    h("td", {}, lastOrderDate(product, moves)),
                    h("td", {}, String(product.stock ?? 0)),
                    h("td", {}, ask)
                  );
                })
              )
            )
          )
        : h("p", { class: "muted" }, "Todavía no hay productos cargados en facturas de este proveedor.");
    return h(
      "div",
      { class: "supplier-detail" },
      h("div", { class: "supplier-detail-head" }, h("div", { class: "supplier-tabs" }, tabProductos, tabFacturas), supplierDetailTab === "productos" ? saveMins : null),
      supplierDetailTab === "facturas" ? facturasTab(row, moves, allMoves, productos) : productosPanel
    );
  }

  function paintForm() {
    if (!formOpen) {
      formHost.replaceChildren();
      return;
    }
    const fields = providerForm(editing);
    const save = h("button", { class: "btn", type: "button" }, editing ? "Guardar proveedor" : "Crear proveedor");
    const cancel = h("button", { class: "btn ghost", type: "button" }, "Cancelar");
    cancel.addEventListener("click", () => {
      editing = null;
      formOpen = false;
      paintForm();
    });
    save.addEventListener("click", async () => {
      const codigo = fields.codigo.value.trim();
      const razon = fields.razon.value.trim();
      if (!codigo || !razon) {
        status.textContent = "El código y la razón social son obligatorios.";
        return;
      }
      const duplicated = await db.proveedores.filter((row) => (row.codigo_proveedor || "").toLowerCase() === codigo.toLowerCase() && row.id !== editing?.id).first();
      if (duplicated) {
        status.textContent = "Ese código de proveedor ya existe.";
        return;
      }
      const created = !editing;
      const saved = await saveLocal("proveedores", {
        ...(editing || {}),
        codigo_proveedor: codigo,
        razon_social: razon,
        contacto: fields.contacto.value.trim(),
        telefono: fields.telefono.value.trim(),
        email: fields.email.value.trim(),
        notas: fields.notas.value.trim(),
        is_active: editing ? editing.is_active !== false : true,
      });
      editing = saved;
      formOpen = true;
      expandedId = saved.id;
      status.textContent = created ? "Proveedor creado. Puede vincular los repuestos que le compra." : "Proveedor actualizado.";
      paintForm();
      refresh();
    });
    formHost.replaceChildren(
      h("div", { class: "form-grid" },
        h("label", { class: "field-row" }, "Código", fields.codigo),
        h("label", { class: "field-row" }, "Razón social", fields.razon),
        h("label", { class: "field-row" }, "Contacto", fields.contacto),
        h("label", { class: "field-row" }, "Teléfono", fields.telefono),
        h("label", { class: "field-row" }, "Correo", fields.email),
        h("label", { class: "field-row span-2" }, "Notas", fields.notas),
        h("div", { class: "toolbar" }, save, cancel)
      )
    );
  }

  async function refresh() {
    const token = ++refreshToken;
    await backfillSupplierLinks();
    const proveedores = (await db.proveedores.toArray()).sort((a, b) => a.razon_social.localeCompare(b.razon_social, "es"));
    const productos = await db.productos.toArray();
    const links = await db.producto_proveedores.toArray();
    const moves = await db.movimientos_inventario.toArray();
    const solicitudes = await db.solicitudes_restock.filter((row) => row.estado === "pendiente" && row.is_active !== false).toArray();
    if (token !== refreshToken) {
      return;
    }
    paintChips(proveedores);
    const visible = proveedores.filter((row) => matchesQuery(supplierBlob(row, productos, links), query));
    const rows = [];
    visible.forEach((row) => {
      const count = linkedSet(row, productos, links).size;
      const edit = h("button", { class: "btn small ghost", type: "button" }, "Editar datos");
      const mins = h("button", { class: "btn small ghost", type: "button" }, "Mínimos");
      const remove = h("button", { class: "btn small danger", type: "button" }, "Eliminar");
      edit.addEventListener("click", (event) => {
        event.stopPropagation();
        editing = row;
        formOpen = true;
        expandedId = row.id;
        paintForm();
        formHost.querySelector("input")?.focus();
      });
      mins.addEventListener("click", (event) => {
        event.stopPropagation();
        expandedId = row.id;
        minsEditingId = minsEditingId === row.id ? null : row.id;
        refresh();
      });
      remove.addEventListener("click", async (event) => {
        event.stopPropagation();
        if (count > 0) {
          await deactivateLocal("proveedores", row.id);
          status.textContent = `${row.razon_social} tiene productos vinculados y quedó inactivo.`;
        } else {
          await hardDeleteLocal("proveedores", row.id);
          status.textContent = `${row.razon_social} se eliminó.`;
          if (expandedId === row.id) {
            expandedId = null;
          }
        }
        if (editing && editing.id === row.id) {
          editing = null;
          formOpen = false;
          paintForm();
        }
        refresh();
      });
      const open = expandedId === row.id;
      const tr = h(
        "tr",
        {
          class: `${row.is_active === false ? "stock-zero " : ""}supplier-row${open ? " supplier-open" : ""}`,
          "aria-expanded": open ? "true" : "false",
        },
        h("td", {}, row.codigo_proveedor),
        h("td", {}, row.is_active === false ? `${row.razon_social} (inactivo)` : row.razon_social),
        h("td", {}, [row.contacto, row.telefono, row.email].filter(Boolean).join(" · ")),
        h("td", {}, String(count)),
        h("td", {}, edit, mins, remove)
      );
      tr.addEventListener("click", (event) => {
        if (event.target.closest("button, a, input, select, textarea")) {
          return;
        }
        const next = expandedId === row.id ? null : row.id;
        if (next !== expandedId) {
          supplierDetailTab = "productos";
        }
        expandedId = next;
        if (expandedId !== row.id) {
          minsEditingId = null;
        }
        refresh();
      });
      rows.push(tr);
      if (open) {
        rows.push(h("tr", { class: "supplier-detail-row" }, h("td", { colspan: "5" }, detailNodes(row, productos, links, moves, solicitudes, moves))));
      }
    });
    listHost.replaceChildren(
      visible.length
        ? h(
            "table",
            { class: "data-table" },
            h("thead", {}, h("tr", {}, h("th", {}, "Código"), h("th", {}, "Razón social"), h("th", {}, "Contacto"), h("th", {}, "Productos"), h("th", {}, ""))),
            h("tbody", {}, ...rows)
          )
        : h("div", { class: "empty glass" }, query ? "Ningún proveedor coincide con la búsqueda." : "No hay proveedores. Use Nuevo proveedor para crear uno.")
    );
  }

  searchInput.addEventListener("input", () => {
    query = searchInput.value.trim();
    refresh();
  });

  const newBtn = h("button", { class: "btn", type: "button" }, "Nuevo proveedor");
  newBtn.addEventListener("click", () => {
    editing = null;
    formOpen = true;
    paintForm();
    formHost.querySelector("input")?.focus();
  });

  root.replaceChildren(
    h("div", { class: "view-title" }, h("h2", {}, "Proveedores"), newBtn),
    h("div", { class: "hero-search" }, h("div", { class: "search-wrap" }, searchInput, chips)),
    formHost,
    status,
    listHost
  );
  paintForm();
  await refresh();
}
