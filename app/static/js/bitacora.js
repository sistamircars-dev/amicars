import { loadContext, matchesFieldFilters, matchesQuery, productBlob } from "./catalog.js";
import { db } from "./db.js";
import { h } from "./dom.js";
import { downloadCsv, downloadPdf, downloadXlsx } from "./exportDocs.js";
import { mountFieldFilters } from "./filters.js";
import { formatDisplayDate } from "./movements.js";

const HEADERS = ["Fecha", "Tipo", "Cantidad", "Descripción", "Documento", "REF", "Bs", "Motivo"];
const TIPOS = { entrada: "Entrada", salida: "Salida", falla: "Falla" };

function invoiceBits(move) {
  const payload = move.payload && typeof move.payload === "object" ? move.payload : {};
  const factura = payload.numero_factura ? `Factura ${payload.numero_factura}` : "";
  const llegada = payload.fecha_llegada ? `Llegada ${formatDisplayDate(payload.fecha_llegada)}` : "";
  return [factura, llegada].filter(Boolean);
}

function documento(move) {
  if (move.tipo === "salida") {
    return [move.correlativo_salida, move.cliente_nombre, move.cliente_documento].filter(Boolean).join(" · ");
  }
  if (move.tipo === "entrada") {
    return [move.codigo_proveedor, move.nombre_proveedor, ...invoiceBits(move)].filter(Boolean).join(" · ");
  }
  return "";
}

function sheetRow(move) {
  return [
    move.fecha || "",
    TIPOS[move.tipo] || move.tipo || "",
    Number(move.cantidad ?? 0),
    move.descripcion || "",
    documento(move),
    move.monto_ref === null || move.monto_ref === undefined ? "" : Number(move.monto_ref),
    move.monto_bs === null || move.monto_bs === undefined ? "" : Number(move.monto_bs),
    move.motivo || "",
  ];
}

export async function renderBitacora(root) {
  const listHost = h("div");
  const filterHost = h("div");
  const queryInput = h("input", {
    class: "app-input",
    type: "search",
    placeholder: "Buscar en la bitácora",
    "aria-label": "Buscar en la bitácora",
  });
  let filters = { active: [], values: {} };
  let query = "";
  let sheetRows = [HEADERS];

  async function refresh() {
    const ctx = await loadContext();
    const moves = await db.movimientos_inventario.orderBy("fecha").reverse().toArray();
    const rows = moves.filter((move) => {
      const product = ctx.productos.get(move.producto_id);
      const attrs = { ...(product?.atributos || {}), ...(move.caracteristicas || {}) };
      if (!matchesFieldFilters(attrs, filters)) {
        return false;
      }
      const payload = move.payload && typeof move.payload === "object" ? move.payload : {};
      const llegada = payload.fecha_llegada ? formatDisplayDate(payload.fecha_llegada) : "";
      const blob = `${move.tipo || ""} ${move.fecha || ""} ${move.descripcion || ""} ${move.correlativo_salida || ""} ${move.cliente_nombre || ""} ${move.cliente_documento || ""} ${move.nombre_proveedor || ""} ${move.motivo || ""} ${payload.numero_factura || ""} ${llegada} ${product ? productBlob(product, ctx) : productBlob({ descripcion: move.descripcion || "", atributos: attrs }, ctx)}`.toLowerCase();
      return matchesQuery(blob, query);
    });
    sheetRows = [HEADERS, ...rows.map(sheetRow)];
    if (!rows.length) {
      listHost.replaceChildren(h("div", { class: "empty glass" }, "No hay movimientos para este filtro."));
      return;
    }
    listHost.replaceChildren(
      h(
        "div",
        { class: "table-wrap" },
        h(
          "table",
          { class: "data-table" },
          h("thead", {}, h("tr", {}, ...HEADERS.map((label) => h("th", {}, label)))),
          h(
            "tbody",
            {},
            ...rows.map((move) => {
              const cells = sheetRow(move).map((value) => h("td", {}, value === "" ? "" : String(value)));
              return h("tr", {}, ...cells);
            })
          )
        )
      )
    );
  }

  queryInput.addEventListener("input", () => {
    query = queryInput.value.trim();
    refresh();
  });
  root.replaceChildren(
    h("div", { class: "view-title" }, h("h2", {}, "Bitácora")),
    h("p", { class: "muted" }, "Los movimientos no se editan ni se borran. La descarga usa el filtro que está viendo y se genera en el navegador."),
    h(
      "div",
      { class: "toolbar" },
      h("button", { class: "btn small ghost", type: "button", onclick: () => downloadCsv("bitacora", sheetRows) }, "CSV"),
      h("button", { class: "btn small ghost", type: "button", onclick: () => downloadXlsx("bitacora", sheetRows) }, "Excel"),
      h("button", { class: "btn small ghost", type: "button", onclick: () => downloadPdf("bitacora", "Bitácora filtrada", sheetRows) }, "PDF")
    ),
    queryInput,
    filterHost,
    listHost
  );
  await mountFieldFilters(filterHost, {
    scope: "bitacora",
    onChange(next) {
      filters = next;
      return refresh();
    },
  });
}
