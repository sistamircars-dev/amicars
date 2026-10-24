import { coverFor, formatPair, loadContext, matchesFieldFilters, matchesQuery, productBlob, safeImg } from "./catalog.js?v=40";
import { db } from "./db.js";
import { downloadTablePdf, downloadXlsx } from "./exportDocs.js?v=40";
import { h } from "./dom.js";
import { formatDisplayDate, todayLocal } from "./movements.js?v=36";
import { mountFieldFilters } from "./filters.js";
import { getRouteParams } from "./nav.js";
import { openProduct } from "./productDetail.js?v=37";
import { openProductForm } from "./productForm.js?v=37";
import { mountSearch } from "./searchBox.js";
import { getPrefs, savePrefs } from "./store.js";

const COLUMNS = [
  { id: "codigo", label: "Código" },
  { id: "descripcion", label: "Descripción" },
  { id: "categoria", label: "Categoría" },
  { id: "proveedor", label: "Proveedor" },
  { id: "stock", label: "Stock" },
  { id: "costo", label: "Costo (REF/Bs)" },
  { id: "venta", label: "Precio de venta (REF/Bs)" },
];

const DEFAULT_MOSAIC = ["descripcion", "stock", "venta"];

function textOf(product, id, ctx) {
  const proveedor = ctx.proveedores.get(product.proveedor_id);
  if (id === "codigo") return product.codigo || "";
  if (id === "descripcion") return product.descripcion;
  if (id === "categoria") return ctx.categorias.get(product.categoria_id)?.nombre || "";
  if (id === "proveedor") return proveedor ? proveedor.razon_social : "";
  if (id === "stock") return String(product.stock ?? 0);
  if (id === "costo") return formatPair(product.ref_entrada, ctx.tasa);
  if (id === "venta") return formatPair(product.ref_venta, ctx.tasa);
  if (id.startsWith("attr:")) {
    const name = id.slice(5);
    const value = (product.atributos || {})[name];
    return value ? `${name}: ${value}` : "";
  }
  return "";
}

function groupProducts(ctx, products) {
  const cats = new Map();
  products.forEach((product) => {
    const cat = ctx.categorias.get(product.categoria_id);
    const catId = cat ? cat.id : "";
    if (!cats.has(catId)) {
      cats.set(catId, {
        nombre: cat ? cat.nombre : "",
        untitled: !cat,
        inactive: Boolean(cat && cat.is_active === false),
        subs: new Map(),
      });
    }
    const bucket = cats.get(catId);
    const sub = ctx.subcategorias.get(product.subcategoria_id);
    const subId = sub ? sub.id : "";
    if (!bucket.subs.has(subId)) {
      bucket.subs.set(subId, { nombre: sub ? sub.nombre : "", products: [] });
    }
    bucket.subs.get(subId).products.push(product);
  });
  return [...cats.values()].map((group) => ({ ...group, subs: [...group.subs.values()] }));
}

export async function renderInventory(root) {
  const prefs = await getPrefs();
  const hiddenCols = new Set(prefs.columnas_ocultas || []);
  let mosaic = prefs.mosaico_listo ? prefs.campos_mosaico || [] : DEFAULT_MOSAIC;
  let mode = prefs.vista_inventario === "tabla" ? "tabla" : "mosaico";
  let filters = { active: [], values: {} };
  let query = "";
  const params = getRouteParams();
  const ctx = await loadContext();

  const listHost = h("div", { class: "inv-list" });
  const filterHost = h("div");
  const searchHost = h("div", { class: "hero-search" });
  const category = h("select", { class: "app-select inv-filter", "aria-label": "Categoría" }, h("option", { value: "" }, "Todas las categorías"));
  ctx.listas.categorias
    .slice()
    .sort((a, b) => Number(a.orden || 0) - Number(b.orden || 0) || a.nombre.localeCompare(b.nombre, "es"))
    .forEach((row) => category.append(h("option", { value: row.id }, row.nombre)));
  if (params.categoriaId) {
    category.value = params.categoriaId;
  }
  const provider = h("select", { class: "app-select inv-filter", "aria-label": "Proveedor" }, h("option", { value: "" }, "Todos los proveedores"));
  ctx.listas.proveedores
    .filter((row) => row.is_active !== false)
    .slice()
    .sort((a, b) => a.razon_social.localeCompare(b.razon_social, "es"))
    .forEach((row) => provider.append(h("option", { value: row.id }, `${row.codigo_proveedor} · ${row.razon_social}`)));
  if (params.proveedorId) {
    provider.value = params.proveedorId;
  }

  const campos = ctx.listas.campos.filter((field) => field.is_active !== false);
  const extraColumns = [...new Set(campos.map((field) => field.nombre))].map((name) => ({ id: `attr:${name}`, label: name }));
  const allColumns = [...COLUMNS, ...extraColumns];
  const mosaicOptions = [
    { id: "codigo", label: "Código" },
    { id: "descripcion", label: "Descripción" },
    { id: "categoria", label: "Categoría" },
    { id: "proveedor", label: "Proveedor" },
    { id: "stock", label: "Stock" },
    { id: "costo", label: "Costo" },
    { id: "venta", label: "Venta" },
    ...extraColumns,
  ];

  const tableBtn = h("button", { class: mode === "tabla" ? "btn small" : "btn small ghost", type: "button" }, "Tabla");
  const mosaicBtn = h("button", { class: mode === "mosaico" ? "btn small" : "btn small ghost", type: "button" }, "Mosaico");
  const colBox = h("div", { class: "filter-checks" });
  const mosaicBox = h("div", { class: "filter-checks" });

  function paintModes() {
    tableBtn.className = mode === "tabla" ? "btn small" : "btn small ghost";
    mosaicBtn.className = mode === "mosaico" ? "btn small" : "btn small ghost";
    colBox.parentElement.hidden = mode !== "tabla";
    mosaicBox.parentElement.hidden = mode !== "mosaico";
  }

  allColumns.forEach((column) => {
    const box = h("input", { type: "checkbox" });
    box.checked = !hiddenCols.has(column.id);
    box.addEventListener("change", async () => {
      if (box.checked) hiddenCols.delete(column.id);
      else hiddenCols.add(column.id);
      await savePrefs({ columnas_ocultas: [...hiddenCols] });
      refresh();
    });
    colBox.append(h("label", { class: "check" }, box, column.label));
  });

  mosaicOptions.forEach((option) => {
    const box = h("input", { type: "checkbox" });
    box.checked = mosaic.includes(option.id);
    box.addEventListener("change", async () => {
      mosaic = [...mosaicBox.querySelectorAll("input")].filter((node) => node.checked).map((node) => node.dataset.id);
      await savePrefs({ campos_mosaico: mosaic, mosaico_listo: true });
      refresh();
    });
    box.dataset.id = option.id;
    mosaicBox.append(h("label", { class: "check" }, box, option.label));
  });

  async function setMode(next) {
    mode = next;
    await savePrefs({ vista_inventario: mode });
    paintModes();
    refresh();
  }
  tableBtn.addEventListener("click", () => setMode("tabla"));
  mosaicBtn.addEventListener("click", () => setMode("mosaico"));

  function renderTable(products, view) {
    const visible = allColumns.filter((column) => !hiddenCols.has(column.id));
    if (!visible.length) {
      return h("p", { class: "muted" }, "Active al menos una columna.");
    }
    const head = h("tr", {}, ...visible.map((column) => h("th", {}, column.label)), h("th", {}, ""));
    const body = products.map((product) => {
      const empty = Number(product.stock || 0) <= 0;
      const edit = h("button", { class: "btn small ghost", type: "button" }, "Editar");
      edit.addEventListener("click", async (event) => {
        event.stopPropagation();
        if (await openProductForm(product)) refresh();
      });
      const row = h(
        "tr",
        { class: empty ? "stock-zero" : "" },
        ...visible.map((column) => h("td", {}, textOf(product, column.id, view))),
        h("td", {}, edit)
      );
      row.addEventListener("click", () => openProduct(product.id));
      return row;
    });
    return h("div", { class: "table-wrap" }, h("table", { class: "data-table" }, h("thead", {}, head), h("tbody", {}, ...body)));
  }

  function renderMosaic(products, view) {
    return h(
      "div",
      { class: "mosaic" },
      ...products.map((product) => {
        const cover = coverFor(product.id, view);
        const img = safeImg(cover.src, product.descripcion, "mosaic-photo");
        const lines = mosaic.map((id) => textOf(product, id, view)).filter(Boolean);
        const edit = h("button", { class: "btn small ghost", type: "button" }, "Editar");
        edit.addEventListener("click", async (event) => {
          event.stopPropagation();
          if (await openProductForm(product)) refresh();
        });
        const card = h(
          "article",
          { class: Number(product.stock || 0) <= 0 ? "glass mosaic-card stock-zero" : "glass mosaic-card" },
          img,
          h("div", { class: "mosaic-meta" }, ...lines.map((line) => h("p", {}, line)), edit)
        );
        card.addEventListener("click", () => openProduct(product.id));
        return card;
      })
    );
  }

  let sheetRows = [[]];
  let listedProducts = [];
  let exportView = ctx;
  let ticket = 0;
  function exportColumns() {
    const visible = allColumns.filter((column) => !hiddenCols.has(column.id));
    return visible.length ? visible : allColumns;
  }
  function sheetFor(products, view) {
    const visible = exportColumns();
    return [
      visible.map((column) => column.label),
      ...products.map((product) => visible.map((column) => textOf(product, column.id, view))),
    ];
  }
  async function refresh() {
    const current = ++ticket;
    const view = await loadContext();
    if (current !== ticket) {
      return;
    }
    const linkedIds = new Set();
    if (provider.value) {
      (await db.producto_proveedores.toArray())
        .filter((link) => link.proveedor_id === provider.value && link.is_active !== false)
        .forEach((link) => linkedIds.add(link.producto_id));
    }
    const products = view.listas.productos.filter((product) => {
      if (product.is_active === false) return false;
      if (category.value && product.categoria_id !== category.value) return false;
      if (provider.value && product.proveedor_id !== provider.value && !linkedIds.has(product.id)) return false;
      if (!matchesQuery(productBlob(product, view), query)) return false;
      return matchesFieldFilters(product.atributos || {}, filters);
    });
    sheetRows = sheetFor(products, view);
    listedProducts = products;
    exportView = view;
    const groups = groupProducts(view, products);
    if (!groups.length) {
      listHost.replaceChildren(h("div", { class: "empty glass" }, "No hay repuestos para este filtro."));
      return;
    }
    listHost.replaceChildren(
      ...groups.map((group) =>
        h(
          "section",
          { class: group.inactive ? "inv-group inactive" : "inv-group" },
          group.untitled ? h("p", { class: "muted inv-untitled" }, "Sin categoría") : h("h3", {}, group.nombre),
          ...group.subs.map((sub) =>
            h(
              "div",
              { class: "inv-sub" },
              sub.nombre ? h("h4", {}, sub.nombre) : null,
              mode === "tabla" ? renderTable(sub.products, view) : renderMosaic(sub.products, view)
            )
          )
        )
      )
    );
  }

  function printInventoryPdf() {
    const provLabel = provider.selectedOptions[0]?.textContent || "";
    downloadTablePdf({
      base: "inventario",
      title: "Inventario AMIRCARS",
      meta: [`Fecha: ${formatDisplayDate(todayLocal())}`, provider.value ? `Proveedor: ${provLabel}` : ""].filter(Boolean),
      headers: ["Código", "Descripción", "Stock", "Stock real"],
      rows: listedProducts.map((product) => [product.codigo || "", product.descripcion || "", String(product.stock ?? 0), ""]),
      footer: [`Total: ${listedProducts.length} producto${listedProducts.length === 1 ? "" : "s"}`],
    });
  }

  const colDetails = h("details", { class: "filter-box" }, h("summary", {}, "Columnas"), colBox);
  const mosaicDetails = h("details", { class: "filter-box" }, h("summary", {}, "Datos en la tarjeta"), mosaicBox);
  const reports = h(
    "div",
    { class: "toolbar report-actions" },
    h("button", { class: "btn small ghost", type: "button", onclick: () => downloadXlsx("inventario", sheetRows) }, "Excel"),
    h("button", { class: "btn small ghost", type: "button", onclick: printInventoryPdf }, "PDF")
  );
  const toolbar = h("div", { class: "toolbar inv-toolbar" }, tableBtn, mosaicBtn, category, provider, reports);

  root.replaceChildren(
    h("div", { class: "view-title" }, h("h2", {}, "Inventario")),
    toolbar,
    colDetails,
    mosaicDetails,
    searchHost,
    filterHost,
    listHost
  );
  paintModes();
  mountSearch(searchHost, {
    onOpen: openProduct,
    onQuery(next) {
      query = next;
      refresh();
    },
  });
  category.addEventListener("change", refresh);
  provider.addEventListener("change", refresh);
  await mountFieldFilters(filterHost, {
    scope: "inventario",
    onChange(next) {
      filters = next;
      return refresh();
    },
  });
}
