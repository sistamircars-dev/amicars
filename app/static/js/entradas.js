import { attachPhotos } from "./catalog.js";
import { createCombo } from "./combo.js";
import { db } from "./db.js";
import { h } from "./dom.js";
import { formatDisplayDate, formatRate, registerEntrada, tasaFor, todayLocal } from "./movements.js";
import { mountLines } from "./opsLines.js";
import { saveLocal } from "./repository.js";
import { mountCampoEditor, retireCampo } from "./taxonomy.js";

function rateText(tasa, withPending) {
  if (!tasa) {
    return withPending
      ? "No hay tasa BCV guardada para esta fecha. Los montos en Bs quedarán pendientes."
      : "No hay tasa BCV guardada para esta fecha.";
  }
  return `Tasa ${formatDisplayDate(tasa.fecha)}: ${formatRate(tasa.usd_ves)} Bs/USD`;
}

function providerOptions(rows) {
  return rows
    .filter((row) => row.is_active !== false)
    .slice()
    .sort((a, b) => String(a.razon_social || "").localeCompare(String(b.razon_social || ""), "es"))
    .map((row) => ({
      value: row.id,
      label: `${row.codigo_proveedor} · ${row.razon_social}`,
      search: [row.codigo_proveedor, row.razon_social, row.contacto, row.telefono, row.email].filter(Boolean).join(" "),
    }));
}

export async function mountEntrada(host, { onSaved } = {}) {
  const proveedores = (await db.proveedores.toArray()).filter((row) => row.is_active !== false);
  const categorias = await db.categorias.toArray();
  const subcategorias = await db.subcategorias.toArray();
  const llegada = h("input", { class: "app-input", type: "date", lang: "es" });
  llegada.value = todayLocal();
  const llegadaText = h("span", { class: "date-readout" }, formatDisplayDate(llegada.value));
  const numero = h("input", { class: "app-input", autocomplete: "off", placeholder: "Ej. 000123" });
  let proveedorId = "";
  const proveedorCombo = createCombo({
    options: providerOptions(proveedores),
    placeholder: "Buscar proveedor",
    emptyLabel: "Sin proveedor",
    ariaLabel: "Proveedor",
    onChange(id) {
      proveedorId = id;
    },
  });
  const codigo = h("input", { class: "app-input" });
  const razon = h("input", { class: "app-input" });
  const contacto = h("input", { class: "app-input" });
  const telefono = h("input", { class: "app-input" });
  const email = h("input", { class: "app-input", type: "email" });
  const notas = h("textarea", { class: "app-input", rows: "2" });
  const extra = h(
    "div",
    { class: "supplier-extra", hidden: true },
    h(
      "div",
      { class: "form-grid" },
      h("label", { class: "field-row" }, "Código", codigo),
      h("label", { class: "field-row" }, "Razón social", razon),
      h("label", { class: "field-row" }, "Contacto", contacto),
      h("label", { class: "field-row" }, "Teléfono", telefono),
      h("label", { class: "field-row" }, "Correo", email),
      h("label", { class: "field-row span-2" }, "Notas", notas)
    )
  );
  const photo = h("input", {
    class: "app-input",
    type: "file",
    accept: "image/jpeg,image/png,image/webp",
  });
  const photoWrap = h("label", { class: "field-row entrada-photo span-2" }, "Foto del producto (opcional)", photo);
  const status = h("p", { class: "muted" }, "");
  const linesHost = h("div");
  let items = [];
  let lineCount = 1;
  let extraFields = [];
  let linesApi = null;
  let tasa = await tasaFor(llegada.value);
  const rateLabel = h("p", { class: "muted" }, rateText(tasa, true));

  function syncPhoto(count) {
    lineCount = count;
    const single = count === 1;
    photoWrap.hidden = !single;
    photoWrap.style.display = single ? "" : "none";
    if (!single) {
      photo.value = "";
    }
  }

  async function paintLines() {
    const productos = (await db.productos.toArray()).filter((row) => row.is_active !== false);
    linesApi = mountLines(linesHost, {
      products: productos,
      mode: "entrada",
      tasa,
      fields: extraFields,
      toolbarNodes: [addCampo],
      onRetireField: dropField,
      onChange(next, meta) {
        items = next;
        syncPhoto(meta && meta.count ? meta.count : 1);
      },
    });
  }

  const editor = mountCampoEditor({
    categorias,
    subcategorias,
    onResult(result) {
      if (!result.field || result.field.is_active === false) {
        status.textContent = result.error || "No se pudo crear el campo.";
        return;
      }
      if (!extraFields.some((field) => field.id === result.field.id)) {
        extraFields.push(result.field);
      }
      if (linesApi) {
        linesApi.setFields(extraFields);
      }
      status.textContent = result.ok ? "Campo añadido a la tabla." : "Ese campo ya existe. La columna quedó en la tabla.";
    },
  });
  const addCampo = h("button", { class: "btn ghost", type: "button" }, "Añadir campo");
  addCampo.addEventListener("click", () => editor.toggle());

  async function dropField(field) {
    try {
      const outcome = await retireCampo(field);
      extraFields = extraFields.filter((item) => item.id !== field.id);
      if (linesApi) {
        linesApi.setFields(extraFields);
      }
      status.textContent = outcome === "inactive" ? "El campo se desactivó porque ya tiene datos." : "Campo quitado.";
    } catch (err) {
      status.textContent = err.message || "No se pudo quitar el campo.";
    }
  }

  llegada.addEventListener("change", async () => {
    llegadaText.textContent = llegada.value ? formatDisplayDate(llegada.value) : "";
    tasa = await tasaFor(llegada.value);
    rateLabel.textContent = rateText(tasa, false);
    if (linesApi) {
      linesApi.setTasa(tasa);
    }
  });

  const nuevo = h("button", { class: "btn ghost", type: "button" }, "Nuevo");
  nuevo.addEventListener("click", () => {
    extra.hidden = !extra.hidden;
    nuevo.textContent = extra.hidden ? "Nuevo" : "Cerrar";
    if (!extra.hidden) {
      codigo.focus();
    }
  });
  const cancelSupplier = h("button", { class: "btn ghost", type: "button" }, "Cancelar");
  cancelSupplier.addEventListener("click", () => {
    extra.hidden = true;
    nuevo.textContent = "Nuevo";
  });
  const saveSupplier = h("button", { class: "btn small", type: "button" }, "Guardar proveedor");
  saveSupplier.addEventListener("click", async () => {
    const code = codigo.value.trim();
    const social = razon.value.trim();
    if (!code || !social) {
      status.textContent = "El código y la razón social son obligatorios.";
      return;
    }
    const duplicated = await db.proveedores.filter((row) => (row.codigo_proveedor || "").toLowerCase() === code.toLowerCase()).first();
    if (duplicated) {
      status.textContent = "Ese código de proveedor ya existe.";
      return;
    }
    const saved = await saveLocal("proveedores", {
      codigo_proveedor: code,
      razon_social: social,
      contacto: contacto.value.trim(),
      telefono: telefono.value.trim(),
      email: email.value.trim(),
      notas: notas.value.trim(),
      is_active: true,
    });
    proveedores.push(saved);
    proveedorId = saved.id;
    proveedorCombo.setOptions(providerOptions(proveedores));
    proveedorCombo.setValue(saved.id, true);
    codigo.value = "";
    razon.value = "";
    contacto.value = "";
    telefono.value = "";
    email.value = "";
    notas.value = "";
    extra.hidden = true;
    nuevo.textContent = "Nuevo";
    status.textContent = "Proveedor creado y seleccionado.";
  });
  extra.querySelector(".form-grid").append(h("div", { class: "toolbar span-2" }, saveSupplier, cancelSupplier));

  const save = h("button", { class: "btn", type: "button" }, "Registrar entrada");
  save.addEventListener("click", async () => {
    save.disabled = true;
    try {
      if (!llegada.value) {
        throw new Error("Indique la fecha de llegada.");
      }
      const chosen = proveedores.find((row) => row.id === proveedorId) || null;
      const savedItems = items.slice();
      const file = lineCount === 1 && photo.files && photo.files[0] ? photo.files[0] : null;
      await registerEntrada({
        fecha: llegada.value,
        proveedor: chosen,
        items: savedItems,
        tasa,
        numeroFactura: numero.value.trim(),
        fechaLlegada: llegada.value,
      });
      let photoNote = "";
      if (file && savedItems.length === 1) {
        const notes = await attachPhotos(savedItems[0].producto_id, [file]);
        photoNote = notes.length ? ` ${notes.join(" ")}` : " Foto adjunta al producto.";
      }
      status.textContent = `Entrada registrada. El REF vigente quedó actualizado y el anterior pasó al histórico.${photoNote}`;
      if (onSaved) {
        await onSaved();
      }
      items = [];
      numero.value = "";
      photo.value = "";
      llegada.value = todayLocal();
      llegadaText.textContent = formatDisplayDate(llegada.value);
      tasa = await tasaFor(llegada.value);
      rateLabel.textContent = rateText(tasa, true);
      await paintLines();
    } catch (err) {
      status.textContent = err.message || "No se pudo registrar la entrada.";
    } finally {
      save.disabled = false;
    }
  });

  host.replaceChildren(
    h(
      "div",
      { class: "sheet-compact" },
      h("h3", {}, "Entrada de mercancía"),
      h("p", { class: "muted" }, "Al ingresar mercancía se sustituyen el costo y el precio REF, y los valores anteriores quedan en el histórico."),
      h(
        "div",
        { class: "entrada-fields" },
        h("label", { class: "field-row" }, "Número de factura", numero),
        h("label", { class: "field-row" }, "Fecha de llegada de la factura", llegada, llegadaText),
        h("div", { class: "field-row" }, h("span", {}, "Proveedor"), h("div", { class: "proveedor-line" }, proveedorCombo.element, nuevo)),
        extra,
        photoWrap
      ),
      rateLabel,
      editor.element,
      linesHost,
      h("div", { class: "toolbar" }, save),
      status
    )
  );
  paintLines();
}
