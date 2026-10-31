import { createCombo } from "./combo.js";
import { clientComboOptions, loadRegisteredClients } from "./clients.js?v=48";
import { createDateField } from "./dateField.js?v=34";
import { db } from "./db.js";
import { h } from "./dom.js";
import { buildSalidaTicket, formatDisplayDate, formatRate, listSalidaCorrelativos, registerSalida, tasaFor, todayLocal } from "./movements.js?v=49";
import { getRouteParams } from "./nav.js";
import { mountLines } from "./opsLines.js?v=48";

function ticketText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(value) {
  return Number(value || 0).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function printTicket(ticket) {
  const rows = ticket.lines
    .map(
      (line) => `<tr>
        <td>${money(line.cantidad)}</td>
        <td>${ticketText(line.descripcion)}</td>
        <td>${money(line.refUnit)}</td>
        <td>${line.montoBs === null ? "—" : money(line.montoBs)}</td>
      </tr>`
    )
    .join("");
  const totalRef = ticket.lines.reduce((sum, line) => sum + Number(line.montoRef || 0), 0);
  const totalBs = ticket.lines.reduce((sum, line) => sum + Number(line.montoBs || 0), 0);
  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>Ticket ${ticket.correlativo}</title>
<style>
  body { font-family: "Segoe UI", sans-serif; color: #111; width: 78mm; margin: 0 auto; }
  h1 { font-size: 16px; text-align: center; margin: 0.2rem 0; }
  img { display: block; width: 42mm; margin: 0 auto 0.4rem; }
  p, td, th { font-size: 12px; }
  table { width: 100%; border-collapse: collapse; }
  td, th { text-align: left; padding: 2px 0; border-bottom: 1px solid #ddd; }
  .right { text-align: right; }
</style></head><body>
  <img src="/static/img/jdparfum/logo.png" alt="JD Parfum">
  <h1>JD Parfum</h1>
  <p>Ticket ${ticketText(ticket.correlativo)}<br>Fecha ${ticketText(ticket.fecha)}</p>
  <p>Cliente: ${ticketText(ticket.cliente)}<br>Cédula/RIF: ${ticketText(ticket.documento || "—")}</p>
  <p>Tasa: ${ticket.tasa ? `${money(ticket.tasa)} Bs/USD` : "sin tasa"}</p>
  <table>
    <thead><tr><th>Cant.</th><th>Descripción</th><th>REF</th><th>Bs</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="right"><strong>Total ${money(totalRef)} REF</strong><br><strong>${ticket.tasa ? `${money(totalBs)} Bs` : "Bs pendiente de tasa"}</strong></p>
</body></html>`;
  document.getElementById("jdparfum-ticket")?.remove();
  const frame = document.createElement("iframe");
  frame.id = "jdparfum-ticket";
  frame.setAttribute("title", "Ticket de salida");
  frame.style.position = "fixed";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  document.body.append(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
  }, 300);
}

function findClient(clients, id) {
  return clients.find((row) => row.value === id) || null;
}

export async function renderSalidas(root) {
  const fecha = createDateField({ value: todayLocal(), ariaLabel: "Fecha" });
  const status = h("p", { class: "muted" }, "");
  const reprintStatus = h("p", { class: "muted" }, "");
  let correlativos = await listSalidaCorrelativos();
  const correlativoCombo = createCombo({
    options: correlativos.map((row) => ({
      value: row.correlativo,
      label: `${row.correlativo} · ${formatDisplayDate(row.fecha)} · ${row.cliente || "Cliente"}`,
      search: `${row.correlativo} ${row.cliente} ${row.fecha}`,
    })),
    placeholder: "Buscar ticket S-000001…",
    ariaLabel: "Ticket de salida",
  });
  const reprintBtn = h("button", { class: "btn ghost", type: "button" }, "Reimprimir ticket");
  reprintBtn.addEventListener("click", async () => {
    const picked = correlativoCombo.getValue() || correlativoCombo.input.value.trim();
    if (!picked) {
      reprintStatus.textContent = "Elija o escriba el número de salida.";
      return;
    }
    try {
      printTicket(await buildSalidaTicket(picked));
      reprintStatus.textContent = `Ticket ${picked} enviado a impresión.`;
    } catch (err) {
      reprintStatus.textContent = err.message || "No se pudo reimprimir.";
    }
  });
  const linesHost = h("div");
  let items = [];
  let tasa = await tasaFor(fecha.value);
  let lastTicket = null;
  let seedProductId = getRouteParams().productoId || "";
  const rateLabel = h("p", { class: "muted" }, tasa ? `Tasa ${formatDisplayDate(tasa.fecha)}: ${formatRate(tasa.usd_ves)} Bs/USD` : "Sin tasa BCV guardada. El ticket igual imprime el REF.");

  let clients = await loadRegisteredClients();
  let linking = false;

  function applyClient(id) {
    const client = findClient(clients, id);
    if (!client || linking) {
      return;
    }
    linking = true;
    clienteCombo.setValue(id, true);
    documentoCombo.setValue(id, true);
    linking = false;
  }

  const clienteCombo = createCombo({
    options: clientComboOptions(clients),
    placeholder: "Buscar cliente por nombre…",
    ariaLabel: "Cliente",
    freeText: true,
    onChange(id) {
      if (linking) {
        return;
      }
      if (id) {
        applyClient(id);
      }
    },
  });

  const documentoCombo = createCombo({
    options: clientComboOptions(clients, { docFirst: true }),
    placeholder: "Buscar por cédula o RIF…",
    ariaLabel: "Cédula o RIF",
    freeText: true,
    onChange(id) {
      if (linking) {
        return;
      }
      if (id) {
        applyClient(id);
      }
    },
  });

  async function paintLines() {
    const productos = (await db.productos.toArray()).filter((row) => row.is_active !== false);
    mountLines(linesHost, {
      products: productos,
      mode: "salida",
      tasa,
      seedProductId,
      onChange(next) {
        items = next;
      },
    });
  }

  fecha.addEventListener("change", async () => {
    tasa = await tasaFor(fecha.value);
    items = [];
    rateLabel.textContent = tasa ? `Tasa ${formatDisplayDate(tasa.fecha)}: ${formatRate(tasa.usd_ves)} Bs/USD` : "Sin tasa BCV guardada.";
    paintLines();
  });

  const printLast = h("button", { class: "btn ghost", type: "button" }, "Imprimir último ticket");
  printLast.addEventListener("click", () => {
    if (!lastTicket) {
      status.textContent = "Todavía no hay un ticket en esta sesión.";
      return;
    }
    printTicket(lastTicket);
  });
  const save = h("button", { class: "btn", type: "button" }, "Registrar salida e imprimir");
  save.addEventListener("click", async () => {
    save.disabled = true;
    try {
      const cliente = clienteCombo.input.value.trim();
      const documento = documentoCombo.input.value.trim();
      lastTicket = await registerSalida({
        fecha: fecha.value,
        cliente,
        documento,
        items,
        tasa,
      });
      status.textContent = `Salida ${lastTicket.correlativo} registrada.`;
      printTicket(lastTicket);
      correlativos = await listSalidaCorrelativos();
      correlativoCombo.setOptions(
        correlativos.map((row) => ({
          value: row.correlativo,
          label: `${row.correlativo} · ${formatDisplayDate(row.fecha)} · ${row.cliente || "Cliente"}`,
          search: `${row.correlativo} ${row.cliente} ${row.fecha}`,
        }))
      );
      clients = await loadRegisteredClients();
      const nameOpts = clientComboOptions(clients);
      clienteCombo.setOptions(nameOpts);
      documentoCombo.setOptions(clientComboOptions(clients, { docFirst: true }));
      clienteCombo.setValue("", true);
      documentoCombo.setValue("", true);
      clienteCombo.input.value = "";
      documentoCombo.input.value = "";
      items = [];
      seedProductId = "";
      await paintLines();
    } catch (err) {
      status.textContent = err.message || "No se pudo registrar la salida.";
    } finally {
      save.disabled = false;
    }
  });

  root.replaceChildren(
    h("div", { class: "view-title" }, h("h2", {}, "Salidas")),
    h("p", { class: "muted" }, "El número de salida es correlativo. Busque clientes ya registrados por nombre o documento."),
    h(
      "div",
      { class: "form-grid" },
      h("label", { class: "field-row" }, "Fecha", fecha),
      h("label", { class: "field-row" }, "Cliente", clienteCombo.element),
      h("label", { class: "field-row" }, "Cédula / RIF", documentoCombo.element)
    ),
    rateLabel,
    linesHost,
    h("div", { class: "toolbar" }, save, printLast),
    status,
    h("div", { class: "glass sheet-compact reprint-block" }, h("h3", {}, "Reimprimir ticket"), h("p", { class: "muted" }, "Busque una salida anterior activa (no anulada)."), correlativoCombo.element, h("div", { class: "toolbar" }, reprintBtn), reprintStatus)
  );
  paintLines();
}
