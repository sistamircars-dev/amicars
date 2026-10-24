import { db } from "./db.js";
import { h } from "./dom.js";
import { registerFalla, todayLocal } from "./movements.js";
import { mountLines } from "./opsLines.js";

export async function renderFallas(root) {
  const productos = (await db.productos.toArray()).filter((row) => row.is_active !== false);
  const fecha = h("input", { class: "app-input", type: "date" });
  fecha.value = todayLocal();
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
  const save = h("button", { class: "btn", type: "button" }, "Registrar baja por falla");
  save.addEventListener("click", async () => {
    save.disabled = true;
    try {
      await registerFalla({ fecha: fecha.value, items });
      status.textContent = "La pieza salió del inventario activo y el motivo quedó en la bitácora.";
      items = [];
      mountLines(linesHost, {
        products: await db.productos.filter((row) => row.is_active !== false).toArray(),
        mode: "falla",
        tasa: null,
        onChange(next) {
          items = next;
        },
      });
    } catch (err) {
      status.textContent = err.message || "No se pudo registrar la baja.";
    } finally {
      save.disabled = false;
    }
  });
  root.replaceChildren(
    h("div", { class: "view-title" }, h("h2", {}, "Bajas por fallas")),
    h("p", { class: "muted" }, "Descuenta la pieza defectuosa sin mezclarla con las ventas. El movimiento no se puede editar ni borrar."),
    h("label", { class: "field-row" }, "Fecha", fecha),
    linesHost,
    save,
    status
  );
}
