import { db } from "./db.js";
import { h } from "./dom.js";
import { formatDisplayDate, formatRate, registerSalida, tasaFor, todayLocal } from "./movements.js";
import { mountLines } from "./opsLines.js";

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
  <img src="/static/img/amircars/logo.png" alt="AMIRCARS">
  <h1>AMIRCARS</h1>
  <p>Ticket ${ticketText(ticket.correlativo)}<br>Fecha ${ticketText(ticket.fecha)}</p>
  <p>Cliente: ${ticketText(ticket.cliente)}<br>Cédula/RIF: ${ticketText(ticket.documento || "—")}</p>
  <p>Tasa: ${ticket.tasa ? `${money(ticket.tasa)} Bs/USD` : "sin tasa"}</p>
  <table>
    <thead><tr><th>Cant.</th><th>Descripción</th><th>REF</th><th>Bs</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="right"><strong>Total ${money(totalRef)} REF</strong><br><strong>${ticket.tasa ? `${money(totalBs)} Bs` : "Bs pendiente de tasa"}</strong></p>
</body></html>`;
  document.getElementById("amircars-ticket")?.remove();
  const frame = document.createElement("iframe");
  frame.id = "amircars-ticket";
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

export async function renderSalidas(root) {
  const fecha = h("input", { class: "app-input", type: "date" });
  fecha.value = todayLocal();
  const cliente = h("input", { class: "app-input" });
  const documento = h("input", { class: "app-input", placeholder: "V-12345678 o J-12345678-9" });
  const status = h("p", { class: "muted" }, "");
  const linesHost = h("div");
  let items = [];
  let tasa = await tasaFor(fecha.value);
  let lastTicket = null;
  const rateLabel = h("p", { class: "muted" }, tasa ? `Tasa ${formatDisplayDate(tasa.fecha)}: ${formatRate(tasa.usd_ves)} Bs/USD` : "Sin tasa BCV guardada. El ticket igual imprime el REF.");

  async function paintLines() {
    const productos = (await db.productos.toArray()).filter((row) => row.is_active !== false);
    mountLines(linesHost, {
      products: productos,
      mode: "salida",
      tasa,
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
      lastTicket = await registerSalida({
        fecha: fecha.value,
        cliente: cliente.value.trim(),
        documento: documento.value.trim(),
        items,
        tasa,
      });
      status.textContent = `Salida ${lastTicket.correlativo} registrada.`;
      printTicket(lastTicket);
      cliente.value = "";
      documento.value = "";
      items = [];
      await paintLines();
    } catch (err) {
      status.textContent = err.message || "No se pudo registrar la salida.";
    } finally {
      save.disabled = false;
    }
  });

  root.replaceChildren(
    h("div", { class: "view-title" }, h("h2", {}, "Salidas")),
    h("p", { class: "muted" }, "El número de salida es correlativo. El ticket se imprime en el navegador y también funciona sin internet."),
    h("div", { class: "form-grid" }, h("label", { class: "field-row" }, "Fecha", fecha), h("label", { class: "field-row" }, "Cliente", cliente), h("label", { class: "field-row" }, "Cédula / RIF", documento)),
    rateLabel,
    linesHost,
    h("div", { class: "toolbar" }, save, printLast),
    status
  );
  paintLines();
}
