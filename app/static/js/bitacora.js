import { loadContext, matchesFieldFilters, matchesQuery, productBlob } from "./catalog.js";
import { db } from "./db.js";
import { h } from "./dom.js";
import { downloadCsv, downloadPdf, downloadXlsx } from "./exportDocs.js";
import { mountFieldFilters } from "./filters.js";
import {
  buildSalidaTicket,
  entradaLoteKey,
  formatDisplayDate,
  isMoveVoided,
  movePayload,
  voidEntradaFactura,
  voidSalidaTicket,
} from "./movements.js?v=49";
import { promptJustification } from "./promptJustification.js?v=49";
import { printTicket } from "./salidas.js?v=49";

const HEADERS = ["Fecha", "Tipo", "Cantidad", "Descripción", "Documento", "REF", "Bs", "Motivo", "Acciones"];
const TIPOS = { entrada: "Entrada", salida: "Salida", falla: "Falla" };

function invoiceBits(move) {
  const payload = movePayload(move);
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
  const payload = movePayload(move);
  if (payload.origen === "anulacion") {
    return payload.correlativo_anulado ? `Anula ${payload.correlativo_anulado}` : "Anulación";
  }
  return "";
}

function tipoLabel(move, allMoves) {
  if (isMoveVoided(move, allMoves)) {
    return "Anulado";
  }
  const payload = movePayload(move);
  if (payload.origen === "anulacion") {
    return payload.anula_tipo === "entrada" ? "Anulación entrada" : "Anulación salida";
  }
  return TIPOS[move.tipo] || move.tipo || "";
}

function sheetRow(move, allMoves) {
  return [
    move.fecha || "",
    tipoLabel(move, allMoves),
    Number(move.cantidad ?? 0),
    move.descripcion || "",
    documento(move),
    move.monto_ref === null || move.monto_ref === undefined ? "" : Number(move.monto_ref),
    move.monto_bs === null || move.monto_bs === undefined ? "" : Number(move.monto_bs),
    move.motivo || movePayload(move).justificacion_anulacion || "",
    "",
  ];
}

export async function renderBitacora(root) {
  const listHost = h("div");
  const filterHost = h("div");
  const status = h("p", { class: "muted" }, "");
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
    const allMoves = await db.movimientos_inventario.orderBy("fecha").reverse().toArray();
    const rows = allMoves.filter((move) => {
      const product = ctx.productos.get(move.producto_id);
      const attrs = { ...(product?.atributos || {}), ...(move.caracteristicas || {}) };
      if (!matchesFieldFilters(attrs, filters)) {
        return false;
      }
      const payload = movePayload(move);
      const llegada = payload.fecha_llegada ? formatDisplayDate(payload.fecha_llegada) : "";
      const blob = `${move.tipo || ""} ${move.fecha || ""} ${move.descripcion || ""} ${move.correlativo_salida || ""} ${move.cliente_nombre || ""} ${move.cliente_documento || ""} ${move.nombre_proveedor || ""} ${move.motivo || ""} ${payload.numero_factura || ""} ${llegada} ${payload.justificacion_anulacion || ""} ${product ? productBlob(product, ctx) : productBlob({ descripcion: move.descripcion || "", atributos: attrs }, ctx)}`.toLowerCase();
      return matchesQuery(blob, query);
    });
    sheetRows = [HEADERS, ...rows.map((move) => sheetRow(move, allMoves))];
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
              const voided = isMoveVoided(move, allMoves);
              const payload = movePayload(move);
              const actions = h("td", { class: "bitacora-actions" });
              if (!voided && move.tipo === "salida" && move.correlativo_salida) {
                const reprint = h("button", { class: "btn small ghost", type: "button" }, "Ticket");
                reprint.addEventListener("click", async () => {
                  try {
                    printTicket(await buildSalidaTicket(move.correlativo_salida));
                  } catch (err) {
                    status.textContent = err.message || "No se pudo reimprimir.";
                  }
                });
                const cancel = h("button", { class: "btn small danger", type: "button" }, "Anular");
                cancel.addEventListener("click", async () => {
                  const just = await promptJustification(`Anular salida ${move.correlativo_salida}`);
                  if (!just) {
                    return;
                  }
                  try {
                    await voidSalidaTicket(move.correlativo_salida, just);
                    status.textContent = `Salida ${move.correlativo_salida} anulada.`;
                    refresh();
                  } catch (err) {
                    status.textContent = err.message || "No se pudo anular.";
                  }
                });
                actions.append(reprint, cancel);
              } else if (!voided && move.tipo === "entrada" && payload.origen !== "anulacion") {
                const cancel = h("button", { class: "btn small danger", type: "button" }, "Anular factura");
                cancel.addEventListener("click", async () => {
                  const key = entradaLoteKey(move);
                  const factura = payload.numero_factura || "sin número";
                  const just = await promptJustification(`Anular factura ${factura}`);
                  if (!just) {
                    return;
                  }
                  try {
                    await voidEntradaFactura(key, just);
                    status.textContent = "Factura de entrada anulada.";
                    refresh();
                  } catch (err) {
                    status.textContent = err.message || "No se pudo anular.";
                  }
                });
                actions.append(cancel);
              }
              const cells = sheetRow(move, allMoves)
                .slice(0, -1)
                .map((value) => h("td", {}, value === "" ? "" : String(value)));
              cells.push(actions);
              return h("tr", { class: voided ? "move-voided" : "" }, ...cells);
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
    h(
      "p",
      { class: "muted" },
      "Puede anular entradas o salidas con justificación (revierte stock). Reimprima tickets de salida activos. Las ediciones de factura están en Proveedores."
    ),
    h(
      "div",
      { class: "toolbar" },
      h("button", { class: "btn small ghost", type: "button", onclick: () => downloadCsv("bitacora", sheetRows) }, "CSV"),
      h("button", { class: "btn small ghost", type: "button", onclick: () => downloadXlsx("bitacora", sheetRows) }, "Excel"),
      h("button", { class: "btn small ghost", type: "button", onclick: () => downloadPdf("bitacora", "Bitácora filtrada", sheetRows) }, "PDF")
    ),
    queryInput,
    filterHost,
    status,
    listHost
  );
  await mountFieldFilters(filterHost, {
    scope: "bitacora",
    onChange(next) {
      filters = next;
      return refresh();
    },
  });
  await refresh();
}
