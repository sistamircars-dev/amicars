import { renderBulk } from "./bulk.js";
import { mountEntrada } from "./entradas.js";
import { coverFor, formatPair, loadContext, matchesFieldFilters, matchesQuery, num, productBlob, safeImg } from "./catalog.js";
import { downloadCsv, downloadPdf, downloadXlsx } from "./exportDocs.js";
import { h } from "./dom.js";
import { mountFieldFilters } from "./filters.js";
import { getRouteParams } from "./nav.js";
import { openProduct } from "./productDetail.js";
import { openProductForm } from "./productForm.js";
import { mountSearch } from "./searchBox.js";
import { getPrefs, savePrefs } from "./store.js";

const COLUMNS = [
  { id: "codigo", label: "Código" },
  { id: "descripcion", label: "Descripción" },
  { id: "proveedor", label: "Proveedor" },
  { id: "stock", label: "Stock" },
  { id: "costo", label: "Costo (REF/Bs)" },
  { id: "venta", label: "Precio de venta (REF/Bs)" },
];

const DEFAULT_MOSAIC = ["descripcion", "stock", "venta"];

function textOf(product, id, ctx) {
  const proveedor = ctx.proveedores.get(product.proveedor_id);
  if (id === "codigo") return product.codigo || "—";
  if (id === "descripcion") return product.descripcion;
  if (id === "proveedor") return proveedor ? proveedor.razon_social : "—";
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
        nombre: cat ? cat.nombre : "Sin categoría",
        inactive: Boolean(cat && cat.is_active === false),
        subs: new Map(),
      });
    }
    const bucket = cats.get(catId);
    const sub = ctx.subcategorias.get(product.subcategoria_id);
    const subId = sub ? sub.id : "";
    if (!bucket.subs.has(subId)) {
      bucket.subs.set(subId, { nombre: sub ? sub.nombre : "Sin subcategoría", products: [] });
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
  const category = h("select", { class: "app-select", "aria-label": "Categoría" }, h("option", { value: "" }, "Todas las categorías"));
  ctx.listas.categorias
    .slice()
    .sort((a, b) => Number(a.orden || 0) - Number(b.orden || 0) || a.nombre.localeCompare(b.nombre, "es"))
    .forEach((row) => category.append(h("option", { value: row.id }, row.nombre)));
  if (params.categoriaId) {
    category.value = params.categoriaId;
  }

  const campos = ctx.listas.campos.filter((field) => field.is_active !== false);
  const mosaicOptions = [
    { id: "codigo", label: "Código" },
    { id: "descripcion", label: "Descripción" },
    { id: "proveedor", label: "Proveedor" },
    { id: "stock", label: "Stock" },
    { id: "costo", label: "Costo" },
    { id: "venta", label: "Venta" },
    ...[...new Set(campos.map((field) => field.nombre))].map((name) => ({ id: `attr:${name}`, label: name })),
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

  COLUMNS.forEach((column) => {
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
    const visible = COLUMNS.filter((column) => !hiddenCols.has(column.id));
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

  const sheetHeaders = ["Código", "Descripción", "Categoría", "Proveedor", "Stock", "Costo REF", "Costo Bs", "Venta REF", "Venta Bs"];
  let sheetRows = [sheetHeaders];
  let ticket = 0;
  async function refresh() {
    const current = ++ticket;
    const view = await loadContext();
    if (current !== ticket) {
      return;
    }
    const products = view.listas.productos.filter((product) => {
      if (product.is_active === false) return false;
      if (category.value && product.categoria_id !== category.value) return false;
      if (!matchesQuery(productBlob(product, view), query)) return false;
      return matchesFieldFilters(product.atributos || {}, filters);
    });
    const rate = view.tasa ? num(view.tasa.usd_ves) : 0;
    sheetRows = [
      sheetHeaders,
      ...products.map((product) => [
        product.codigo || "",
        product.descripcion || "",
        view.categorias.get(product.categoria_id)?.nombre || "",
        view.proveedores.get(product.proveedor_id)?.razon_social || "",
        num(product.stock),
        num(product.ref_entrada),
        rate ? Number((num(product.ref_entrada) * rate).toFixed(2)) : "",
        num(product.ref_venta),
        rate ? Number((num(product.ref_venta) * rate).toFixed(2)) : "",
      ]),
    ];
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
          h("h3", {}, group.nombre),
          ...group.subs.map((sub) => h("div", { class: "inv-sub" }, h("h4", {}, sub.nombre), mode === "tabla" ? renderTable(sub.products, view) : renderMosaic(sub.products, view)))
        )
      )
    );
  }

  const colDetails = h("details", { class: "filter-box" }, h("summary", {}, "Columnas"), colBox);
  const mosaicDetails = h("details", { class: "filter-box" }, h("summary", {}, "Datos en la tarjeta"), mosaicBox);
  const toolbar = h(
    "div",
    { class: "toolbar" },
    tableBtn,
    mosaicBtn,
    category,
    h("button", { class: "btn small", type: "button", onclick: () => openProductForm().then((saved) => saved && refresh()) }, "Nuevo"),
    h("button", { class: "btn small ghost", type: "button", onclick: () => renderBulk(root, { onDone: () => renderInventory(root) }) }, "Carga masiva"),
    h("button", { class: "btn small ghost", type: "button", onclick: () => downloadCsv("inventario", sheetRows) }, "CSV"),
    h("button", { class: "btn small ghost", type: "button", onclick: () => downloadXlsx("inventario", sheetRows) }, "Excel"),
    h("button", { class: "btn small ghost", type: "button", onclick: () => downloadPdf("inventario", "Inventario filtrado", sheetRows) }, "PDF")
  );

  const entradaHost = h("section", { class: "entrada-panel", "aria-label": "Entrada de mercancía" });
  root.replaceChildren(
    h("div", { class: "view-title" }, h("h2", {}, "Inventario")),
    entradaHost,
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
  await mountFieldFilters(filterHost, {
    scope: "inventario",
    onChange(next) {
      filters = next;
      return refresh();
    },
  });
  await mountEntrada(entradaHost, { onSaved: refresh });
}
