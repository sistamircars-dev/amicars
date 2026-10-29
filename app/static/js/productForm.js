import { createProduct, deleteProduct, galleryFor, loadContext, removeProductImage, safeImg, updateProduct } from "./catalog.js";
import { h } from "./dom.js";
import { promptCategoria, promptSubcategoria } from "./taxonomy.js?v=37";

export function dynamicFields(campos, values = {}) {
  const box = h("div", { class: "dynamic-fields" });
  campos
    .filter((field) => field.is_active !== false)
    .sort((a, b) => Number(a.orden || 0) - Number(b.orden || 0))
    .forEach((field) => {
      const current = values[field.nombre] ?? "";
      let control;
      if (field.tipo === "boolean") {
        control = h("select", { class: "app-select", "data-attr": field.nombre }, h("option", { value: "" }, "—"), h("option", { value: "Sí" }, "Sí"), h("option", { value: "No" }, "No"));
        control.value = current || "";
      } else if (field.tipo === "select" && Array.isArray(field.opciones) && field.opciones.length) {
        control = h("select", { class: "app-select", "data-attr": field.nombre }, h("option", { value: "" }, "—"));
        field.opciones.forEach((item) => {
          const value = typeof item === "string" ? item : item.value || item.label || "";
          control.append(h("option", { value }, value));
        });
        control.value = current || "";
      } else {
        control = h("input", {
          class: "app-input",
          type: field.tipo === "number" ? "number" : "text",
          step: field.tipo === "number" ? "any" : undefined,
          "data-attr": field.nombre,
        });
        control.value = current === null || current === undefined ? "" : String(current);
      }
      box.append(h("label", { class: "field-row" }, h("span", {}, field.nombre), control));
    });
  return box;
}

export function readDynamic(container) {
  const attrs = {};
  container.querySelectorAll("[data-attr]").forEach((node) => {
    attrs[node.dataset.attr] = node.value.trim();
  });
  return attrs;
}

export function openProductForm(existing = null) {
  return new Promise((resolve) => {
    const back = h("div", { class: "modal-back" });
    const box = h("div", { class: "glass modal wide" });
    const status = h("p", { class: "muted" }, "");
    let ctx = null;
    let saving = false;
    let removingPhoto = false;

    const catSelect = h("select", { class: "app-select" });
    const subSelect = h("select", { class: "app-select" });
    const provSelect = h("select", { class: "app-select" });
    const codigo = h("input", { class: "app-input" });
    const descripcion = h("textarea", { class: "app-input", rows: "3" });
    const refEntrada = h("input", { class: "app-input", type: "number", step: "0.01", min: "0" });
    const refVenta = h("input", { class: "app-input", type: "number", step: "0.01", min: "0" });
    const stock = h("input", { class: "app-input", type: "number", step: "1", min: "0" });
    const stockMin = h("input", { class: "app-input", type: "number", step: "1", min: "0" });
    const files = h("input", { class: "app-input", type: "file", accept: "image/jpeg,image/png,image/webp", multiple: "multiple" });
    const existingPhotos = h("div", { class: "photo-line form-photo-list" });
    const fieldHost = h("div");

    function paintExistingPhotos() {
      if (!existing || !ctx) {
        existingPhotos.replaceChildren();
        existingPhotos.hidden = true;
        return;
      }
      const photos = galleryFor(existing.id, ctx);
      if (!photos.length) {
        existingPhotos.replaceChildren();
        existingPhotos.hidden = true;
        return;
      }
      existingPhotos.hidden = false;
      existingPhotos.replaceChildren(
        h("span", { class: "muted" }, "Fotos actuales (pulse × para quitar):"),
        ...photos.map((photo) => {
          const img = safeImg(photo.src, photo.alt || existing.descripcion, "photo-mini");
          const remove = h("button", { class: "photo-chip-remove", type: "button", "aria-label": "Quitar foto" }, "×");
          remove.addEventListener("click", async () => {
            if (saving || removingPhoto) {
              return;
            }
            removingPhoto = true;
            try {
              await removeProductImage(photo.id, existing.id);
              ctx = await loadContext();
              paintExistingPhotos();
              status.textContent = "Foto quitada. Se sincronizará con la nube al subir cambios.";
            } catch (err) {
              status.textContent = err.message || "No se pudo quitar la foto.";
            } finally {
              removingPhoto = false;
            }
          });
          return h("span", { class: "photo-chip-wrap" }, h("span", { class: "photo-chip" }, img), remove);
        })
      );
    }

    codigo.value = existing?.codigo || "";
    descripcion.value = existing?.descripcion || "";
    refEntrada.value = existing ? String(existing.ref_entrada ?? 0) : "";
    refVenta.value = existing ? String(existing.ref_venta ?? 0) : "";
    stock.value = "0";
    stockMin.value = existing && existing.stock_minimo !== null && existing.stock_minimo !== undefined ? String(existing.stock_minimo) : "";

    function fieldsForSub() {
      if (!ctx) {
        return [];
      }
      return ctx.listas.campos.filter((field) => field.subcategoria_id === subSelect.value);
    }

    function fillCats() {
      catSelect.replaceChildren(h("option", { value: "" }, "Sin categoría"));
      ctx.listas.categorias
        .filter((row) => row.is_active !== false || row.id === existing?.categoria_id)
        .forEach((row) => catSelect.append(h("option", { value: row.id }, row.nombre)));
    }

    function refillSubs() {
      const current = existing && subSelect.value === "" ? existing.subcategoria_id : subSelect.value;
      subSelect.replaceChildren(h("option", { value: "" }, "Sin subcategoría"));
      ctx.listas.subcategorias
        .filter((row) => row.categoria_id === catSelect.value && row.is_active !== false)
        .forEach((row) => subSelect.append(h("option", { value: row.id }, row.nombre)));
      subSelect.value = current || "";
      const typed = readDynamic(fieldHost);
      const seed = Object.keys(typed).length ? typed : existing?.atributos || {};
      fieldHost.replaceChildren(dynamicFields(fieldsForSub(), seed));
    }

    async function reloadTaxonomy(categoriaId, subcategoriaId) {
      ctx = await loadContext();
      fillCats();
      catSelect.value = categoriaId || "";
      refillSubs();
      if (subcategoriaId) {
        subSelect.value = subcategoriaId;
        fieldHost.replaceChildren(dynamicFields(fieldsForSub(), readDynamic(fieldHost)));
      }
    }

    function plusButton(title, onClick) {
      const button = h("button", { class: "btn small ghost cat-plus", type: "button", title, "aria-label": title }, "+");
      button.addEventListener("click", onClick);
      return button;
    }

    const addCat = plusButton("Nueva categoría", async () => {
      try {
        const saved = await promptCategoria();
        if (!saved) {
          return;
        }
        await reloadTaxonomy(saved.id, "");
        status.textContent = `Categoría ${saved.nombre} creada. Queda en el panel Categorías.`;
      } catch (err) {
        status.textContent = err.message || "No se pudo crear la categoría.";
      }
    });

    const addSub = plusButton("Nueva subcategoría", async () => {
      const cat = ctx?.listas.categorias.find((row) => row.id === catSelect.value);
      if (!cat) {
        status.textContent = "Elija primero la categoría.";
        return;
      }
      try {
        const saved = await promptSubcategoria(cat);
        if (!saved) {
          return;
        }
        await reloadTaxonomy(cat.id, saved.id);
        status.textContent = `Subcategoría ${saved.nombre} creada en ${cat.nombre}. Queda en el panel Categorías.`;
      } catch (err) {
        status.textContent = err.message || "No se pudo crear la subcategoría.";
      }
    });

    function close(result) {
      back.remove();
      resolve(result);
    }

    const save = h("button", { class: "btn", type: "button" }, existing ? "Guardar ficha" : "Crear producto");
    const cancel = h("button", { class: "btn ghost", type: "button" }, "Cancelar");
    const remove = existing ? h("button", { class: "btn danger", type: "button" }, "Eliminar artículo") : null;
    cancel.addEventListener("click", () => close(null));
    if (remove) {
      remove.addEventListener("click", async () => {
        if (saving) {
          return;
        }
        saving = true;
        remove.disabled = true;
        save.disabled = true;
        try {
          const deleted = await deleteProduct(existing);
          if (!deleted) {
            saving = false;
            remove.disabled = false;
            save.disabled = false;
            return;
          }
          close(deleted);
        } catch (err) {
          status.textContent = err.message || "No se pudo eliminar el artículo.";
          saving = false;
          remove.disabled = false;
          save.disabled = false;
        }
      });
    }
    save.addEventListener("click", async () => {
      if (saving) {
        return;
      }
      if (!descripcion.value.trim()) {
        status.textContent = "La descripción es obligatoria.";
        return;
      }
      saving = true;
      save.disabled = true;
      try {
        const input = {
          categoria_id: catSelect.value,
          subcategoria_id: subSelect.value,
          proveedor_id: provSelect.value,
          codigo: codigo.value.trim(),
          descripcion: descripcion.value.trim(),
          atributos: readDynamic(fieldHost),
          ref_entrada: refEntrada.value,
          ref_venta: refVenta.value,
          stock: existing ? existing.stock : stock.value,
          stock_minimo: stockMin.value,
        };
        const result = existing ? await updateProduct(existing, input, [...files.files]) : await createProduct(input, [...files.files]);
        status.textContent = result.notes.length ? result.notes.join(" ") : "Ficha guardada en el catálogo local.";
        close(result.product);
      } catch (err) {
        status.textContent = err.message || "No se pudo guardar la ficha.";
        saving = false;
        save.disabled = false;
      }
    });

    loadContext().then((loaded) => {
      ctx = loaded;
      fillCats();
      catSelect.value = existing?.categoria_id || "";
      provSelect.replaceChildren(h("option", { value: "" }, "Sin proveedor"));
      ctx.listas.proveedores
        .filter((row) => row.is_active !== false || row.id === existing?.proveedor_id)
        .forEach((row) => provSelect.append(h("option", { value: row.id }, `${row.codigo_proveedor} · ${row.razon_social}`)));
      provSelect.value = existing?.proveedor_id || "";
      refillSubs();
      paintExistingPhotos();
    });

    catSelect.addEventListener("change", refillSubs);
    subSelect.addEventListener("change", () => {
      fieldHost.replaceChildren(dynamicFields(fieldsForSub(), readDynamic(fieldHost)));
    });

    const grid = h(
      "div",
      { class: "form-grid" },
      h("label", { class: "field-row" }, "Categoría", h("div", { class: "field-plus" }, catSelect, addCat)),
      h("label", { class: "field-row" }, "Subcategoría", h("div", { class: "field-plus" }, subSelect, addSub)),
      h("label", { class: "field-row" }, "Proveedor", provSelect),
      h("label", { class: "field-row" }, "Código", codigo),
      h("label", { class: "field-row span-2" }, "Descripción", descripcion),
      h("label", { class: "field-row" }, "Costo REF", refEntrada),
      h("label", { class: "field-row" }, "Precio venta REF", refVenta),
      existing ? h("p", { class: "muted" }, `Stock actual: ${existing.stock}. Las entradas de mercancía se registran en Entradas.`) : h("label", { class: "field-row" }, "Stock inicial", stock),
      h("label", { class: "field-row" }, "Stock mínimo", stockMin),
      h("label", { class: "field-row span-2" }, "Fotos opcionales (JPEG, PNG o WEBP, máx. 5MB)", existingPhotos, files),
      fieldHost
    );

    box.append(h("h3", {}, existing ? "Editar ficha" : "Nuevo producto"), grid, status, h("div", { class: "modal-actions" }, cancel, remove, save));
    back.append(box);
    document.body.append(back);
    descripcion.focus();
  });
}
