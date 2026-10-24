import { matchesQuery } from "./catalog.js";
import { db } from "./db.js";
import { h } from "./dom.js";
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

function supplierBlob(row) {
  return [row.codigo_proveedor, row.razon_social, row.contacto, row.telefono, row.email, row.notas]
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
    placeholder: "Buscar proveedor, código, contacto…",
    autocomplete: "off",
    "aria-label": "Buscar proveedores",
  });
  const chips = h("div", { class: "word-chips" });
  let editing = null;
  let formOpen = false;
  let expandedId = null;
  let query = "";
  let refreshToken = 0;

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

  function detailNodes(row, productos, links) {
    const activeProducts = productos.filter((product) => product.is_active !== false);
    const rowLinks = links.filter((link) => link.proveedor_id === row.id && link.is_active !== false);
    const shown = new Map();
    productos
      .filter((product) => product.proveedor_id === row.id)
      .forEach((product) => shown.set(product.id, { product, link: null }));
    rowLinks.forEach((link) => {
      const product = productos.find((item) => item.id === link.producto_id) || shown.get(link.producto_id)?.product;
      shown.set(link.producto_id, { product, link });
    });
    const select = h("select", { class: "app-select" }, h("option", { value: "" }, "Seleccione un repuesto"));
    activeProducts.forEach((product) => select.append(h("option", { value: product.id }, productLabel(product))));
    const minimum = h("input", { class: "app-input", type: "number", min: "0", step: "1", placeholder: "Mínimo de este proveedor" });
    const linkBtn = h("button", { class: "btn small", type: "button" }, "Vincular");
    linkBtn.addEventListener("click", async () => {
      if (!select.value) {
        status.textContent = "Elija el repuesto que compra a este proveedor.";
        return;
      }
      const existing = await db.producto_proveedores.filter((item) => item.proveedor_id === row.id && item.producto_id === select.value).first();
      await saveLocal("producto_proveedores", {
        ...(existing || {}),
        producto_id: select.value,
        proveedor_id: row.id,
        stock_minimo: minimum.value.trim() === "" ? null : Number(minimum.value),
        is_active: true,
      });
      status.textContent = "Repuesto vinculado. Ese mínimo se usa si el producto no tiene uno propio.";
      refresh();
    });
    const items = [...shown.values()];
    return h(
      "div",
      { class: "supplier-detail" },
      h("h3", {}, "Productos vinculados"),
      items.length
        ? h(
            "ul",
            { class: "link-list" },
            ...items.map(({ product, link }) => {
              const unlink = link
                ? h("button", { class: "btn small ghost", type: "button" }, "Quitar vínculo")
                : null;
              if (unlink) {
                unlink.addEventListener("click", async () => {
                  await hardDeleteLocal("producto_proveedores", link.id);
                  status.textContent = "Vínculo eliminado.";
                  refresh();
                });
              }
              return h("li", {}, `${productLabel(product)} · mínimo ${link && link.stock_minimo != null ? link.stock_minimo : "—"}`, unlink);
            })
          )
        : h("p", { class: "muted" }, "Este proveedor todavía no tiene repuestos vinculados."),
      h("div", { class: "form-grid" }, h("label", { class: "field-row" }, "Repuesto", select), h("label", { class: "field-row" }, "Mínimo", minimum), linkBtn)
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
    const proveedores = (await db.proveedores.toArray()).sort((a, b) => a.razon_social.localeCompare(b.razon_social, "es"));
    const productos = await db.productos.toArray();
    const links = await db.producto_proveedores.toArray();
    if (token !== refreshToken) {
      return;
    }
    paintChips(proveedores);
    const visible = proveedores.filter((row) => matchesQuery(supplierBlob(row), query));
    const rows = [];
    visible.forEach((row) => {
      const count = linkedSet(row, productos, links).size;
      const edit = h("button", { class: "btn small ghost", type: "button" }, "Editar");
      const remove = h("button", { class: "btn small danger", type: "button" }, "Eliminar");
      edit.addEventListener("click", (event) => {
        event.stopPropagation();
        editing = row;
        formOpen = true;
        expandedId = row.id;
        paintForm();
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
        h("td", {}, edit, remove)
      );
      tr.addEventListener("click", (event) => {
        if (event.target.closest("button, a, input, select, textarea")) {
          return;
        }
        expandedId = expandedId === row.id ? null : row.id;
        refresh();
      });
      rows.push(tr);
      if (open) {
        rows.push(h("tr", { class: "supplier-detail-row" }, h("td", { colspan: "5" }, detailNodes(row, productos, links))));
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
