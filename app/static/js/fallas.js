import { createDateField } from "./dateField.js?v=34";
import { db } from "./db.js";
import { h } from "./dom.js";
import { downloadTablePdf } from "./exportDocs.js?v=40";
import { formatDisplayDate, registerFalla, todayLocal } from "./movements.js";
import { mountLines } from "./opsLines.js?v=40";

export async function renderFallas(root) {
  const productos = (await db.productos.toArray()).filter((row) => row.is_active !== false);
  const fecha = createDateField({ value: todayLocal(), ariaLabel: "Fecha" });
  const status = h("p", { class: "muted" }, "");
  const linesHost = h("div");
  let items = [];
  mountLines(linesHost, {
    products: productos,
    mode: "falla",
    tasa: null,
    onChange(next) {
      items = next;
    },
  });

  function printFallaPdf(lines) {
    const fechaTxt = formatDisplayDate(fecha.value) || fecha.value;
    const total = lines.reduce((sum, item) => sum + Number(item.cantidad || 0), 0);
    downloadTablePdf({
      base: "fallas",
      title: "Baja por falla AMIRCARS",
      meta: [`Fecha: ${fechaTxt}`],
      headers: ["Código", "Producto", "Cantidad", "Motivo"],
      rows: lines.map((item) => {
        const product = productos.find((row) => row.id === item.producto_id);
        return [
          product?.codigo || "—",
          item.descripcion || product?.descripcion || "—",
          String(item.cantidad),
          item.motivo || "—",
        ];
      }),
      footer: [`Total: ${total}`],
    });
    return fechaTxt;
  }

  async function resetLines() {
    items = [];
    mountLines(linesHost, {
      products: await db.productos.filter((row) => row.is_active !== false).toArray(),
      mode: "falla",
      tasa: null,
      onChange(next) {
        items = next;
      },
    });
  }

  async function submit(withPdf) {
    const lines = items.filter((item) => item.producto_id && Number(item.cantidad) > 0);
    save.disabled = true;
    printSave.disabled = true;
    try {
      await registerFalla({ fecha: fecha.value, items: lines });
      let extra = "";
      if (withPdf) {
        extra = ` PDF · ${printFallaPdf(lines)}.`;
      }
      status.textContent = `La pieza salió del inventario activo y el motivo quedó en la bitácora.${extra}`;
      await resetLines();
    } catch (err) {
      status.textContent = err.message || "No se pudo registrar la baja.";
    } finally {
      save.disabled = false;
      printSave.disabled = false;
    }
  }

  const save = h("button", { class: "btn", type: "button" }, "Registrar");
  const printSave = h("button", { class: "btn ghost", type: "button" }, "Registrar e imprimir");
  save.addEventListener("click", () => submit(false));
  printSave.addEventListener("click", () => submit(true));

  root.replaceChildren(
    h("div", { class: "view-title" }, h("h2", {}, "Bajas por fallas")),
    h("p", { class: "muted" }, "Descuenta la pieza defectuosa sin mezclarla con las ventas. El movimiento no se puede editar ni borrar."),
    h("label", { class: "field-row" }, "Fecha", fecha),
    linesHost,
    h("div", { class: "toolbar" }, save, printSave),
    status
  );
}
