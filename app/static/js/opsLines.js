import { controlForField, createCombo } from "./combo.js";
import { h } from "./dom.js";
import { newId } from "./db.js";
import { openProductImage } from "./productDetail.js?v=38";

function blankLine() {
  return {
    key: newId(),
    producto_id: "",
    codigo: "",
    descripcion: "",
    cantidad: "1",
    ref_entrada: "",
    ref_venta: "",
    motivo: "",
    atributos: {},
    files: [],
    previewUrls: [],
  };
}

function releasePreviews(line) {
  (line.previewUrls || []).forEach((url) => URL.revokeObjectURL(url));
  line.previewUrls = [];
}

function rememberFiles(line, list) {
  Array.from(list || []).forEach((file) => {
    line.files.push(file);
    line.previewUrls.push(URL.createObjectURL(file));
  });
}

function bindThumb(chip, file, url) {
  const img = h("img", { class: "photo-hover", alt: file.name || "Foto", src: url });
  chip.addEventListener("pointerenter", () => {
    const rect = chip.getBoundingClientRect();
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - 184);
    const top = rect.top > 188 ? rect.top - 176 : rect.bottom + 8;
    img.style.left = `${left}px`;
    img.style.top = `${top}px`;
    document.body.append(img);
  });
  chip.addEventListener("pointerleave", () => img.remove());
}

function photoCell(line, onChange) {
  if (!line.files) {
    line.files = [];
  }
  if (!line.previewUrls) {
    line.previewUrls = [];
  }
  const caption = h("span", {}, line.files.length ? `Fotos (${line.files.length})` : "Fotos");
  const file = h("input", {
    class: "line-photo-input",
    type: "file",
    accept: "image/jpeg,image/png,image/webp",
    multiple: "multiple",
  });
  file.addEventListener("change", () => {
    rememberFiles(line, file.files);
    file.value = "";
    onChange();
  });
  const thumbs = line.files.map((item, index) => {
    const url = line.previewUrls[index];
    const img = h("img", { class: "photo-mini", src: url, alt: item.name || "Foto" });
    const chip = h("span", { class: "photo-chip", title: item.name || "Foto" }, img);
    if (url) {
      bindThumb(chip, item, url);
    }
    const remove = h("button", { class: "photo-chip-remove", type: "button", "aria-label": "Quitar foto" }, "×");
    remove.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (line.previewUrls[index]) {
        URL.revokeObjectURL(line.previewUrls[index]);
      }
      line.files.splice(index, 1);
      line.previewUrls.splice(index, 1);
      onChange();
    });
    return h("span", { class: "photo-chip-wrap" }, chip, remove);
  });
  return h("div", { class: "photo-line" }, h("label", { class: "btn small ghost line-photo" }, caption, file), ...thumbs);
}

function productOptions(products) {
  return products
    .filter((product) => product.is_active !== false)
    .map((product) => ({
      value: product.id,
      label: product.descripcion || "Producto",
      search: `${product.codigo || ""} ${product.descripcion || ""} ${Object.values(product.atributos || {}).join(" ")}`,
    }));
}

function codeOptions(products) {
  return products
    .filter((product) => product.is_active !== false && String(product.codigo || "").trim())
    .map((product) => ({
      value: product.id,
      label: String(product.codigo).trim(),
      search: `${product.codigo || ""} ${product.descripcion || ""}`,
    }));
}

function closeOpenCombos() {
  document.querySelectorAll(".combo-list").forEach((list) => {
    list.hidden = true;
  });
}

function paintMoney(node, line, product, tasa, mode) {
  if (!product) {
    node.replaceChildren("—");
    return;
  }
  if (mode === "falla") {
    node.replaceChildren(`Disponible ${product.stock}`);
    return;
  }
  const qty = Number(line.cantidad || 0);
  const unit = mode === "salida" ? Number(line.ref_venta || 0) : Number(line.ref_entrada || 0);
  const ref = unit * qty;
  const rate = tasa ? Number(tasa.usd_ves) : 0;
  const stockNote = mode === "salida" ? `disponible ${product.stock}` : `stock ${product.stock}`;
  if (!rate) {
    node.replaceChildren(`${ref.toFixed(2)} REF`, h("small", {}, `Bs pendiente · ${stockNote}`));
    return;
  }
  node.replaceChildren(`${(ref * rate).toFixed(2)} Bs`, h("small", {}, `${ref.toFixed(2)} REF · ${stockNote}`));
}

function lineFromProduct(product) {
  return {
    ...blankLine(),
    producto_id: product.id,
    codigo: product.codigo || "",
    descripcion: product.descripcion || "",
    ref_entrada: product ? String(product.ref_entrada ?? 0) : "",
    ref_venta: product ? String(product.ref_venta ?? 0) : "",
  };
}

function findByCode(products, codigo) {
  const wanted = String(codigo || "").trim().toLowerCase();
  if (!wanted) {
    return null;
  }
  return products.find((item) => String(item.codigo || "").trim().toLowerCase() === wanted) || null;
}

function mountEntradaTable(host, { products, tasa, fields, onChange, onRetireField, toolbarNodes = [], mode = "entrada", seedProductId = "" }) {
  const seeded = seedProductId ? products.find((item) => item.id === seedProductId) : null;
  let lines = seeded ? [lineFromProduct(seeded)] : [blankLine()];
  let currentTasa = tasa;
  let currentFields = fields || [];
  const board = h("div", { class: "ops-table-wrap" });
  const previews = new Map();
  const add = h("button", { class: "btn ghost", type: "button" }, "Añadir ítem");

  function emit() {
    onChange(
      lines
        .filter((line) => line.producto_id || (mode === "entrada" && (line.codigo || line.descripcion)))
        .map((line) => ({
          producto_id: line.producto_id,
          codigo: line.codigo || "",
          descripcion: line.descripcion,
          cantidad: line.cantidad,
          ref_entrada: line.ref_entrada,
          ref_venta: line.ref_venta,
          motivo: line.motivo || "",
          files: line.files || [],
          update_ref_venta: mode === "salida",
          atributos: currentFields.reduce((acc, field) => {
            acc[field.nombre] = (line.atributos || {})[field.nombre] || "";
            return acc;
          }, {}),
        })),
      { count: lines.length }
    );
  }

  function paintPreview(line) {
    const node = previews.get(line.key);
    if (!node) {
      return;
    }
    const product = products.find((item) => item.id === line.producto_id);
    paintMoney(node, line, product, currentTasa, mode);
  }

  function render() {
    previews.clear();
    const fieldHeaders = currentFields.map((field) => {
      const removeField = h("button", { class: "btn small ghost", type: "button", "aria-label": `Quitar ${field.nombre}` }, "×");
      removeField.addEventListener("click", () => {
        if (onRetireField) {
          onRetireField(field);
        }
      });
      return h("th", {}, h("div", { class: "th-field" }, field.nombre, removeField));
    });
    const rows = lines.map((line, index) => {
      if (!line.atributos) {
        line.atributos = {};
      }
      const viewPhoto = h("button", { class: "btn small ghost", type: "button", title: "Ver imagen del producto", "aria-label": "Ver imagen del producto" }, "Ver imagen");
      function syncPhoto() {
        viewPhoto.disabled = !line.producto_id && !(line.previewUrls || []).length;
      }
      function applyProduct(product, source) {
        if (!product) {
          line.producto_id = "";
          syncPhoto();
          paintPreview(line);
          emit();
          return;
        }
        line.producto_id = product.id;
        line.codigo = product.codigo || "";
        line.descripcion = product.descripcion || "";
        line.ref_entrada = String(product.ref_entrada ?? 0);
        line.ref_venta = String(product.ref_venta ?? 0);
        if (source !== "code" && codeCombo) {
          codeCombo.setValue(product.id, true);
        }
        if (source !== "name" && combo) {
          combo.setValue(product.id, true);
        }
        if (costo) {
          costo.value = line.ref_entrada;
        }
        if (venta) {
          venta.value = line.ref_venta;
        }
        syncPhoto();
        paintPreview(line);
        emit();
      }
      const codeCombo = createCombo({
        options: codeOptions(products),
        value: line.producto_id,
        placeholder: "Código",
        emptyLabel: "",
        ariaLabel: "Código",
        freeText: true,
        text: line.codigo || "",
        onText(value) {
          line.codigo = String(value || "").trim();
          const found = findByCode(products, line.codigo);
          if (found) {
            applyProduct(found, "code");
            return;
          }
          line.producto_id = "";
          syncPhoto();
          emit();
        },
        onChange(id) {
          const product = products.find((item) => item.id === id);
          if (product) {
            applyProduct(product, "code");
            return;
          }
          line.producto_id = "";
          syncPhoto();
          emit();
        },
      });
      codeCombo.element.classList.add("code-combo");
      const combo = createCombo({
        options: productOptions(products),
        value: line.producto_id,
        placeholder: "Buscar o escribir producto",
        emptyLabel: "Sin producto",
        ariaLabel: `Producto de la línea ${index + 1}`,
        freeText: mode === "entrada",
        text: line.descripcion || "",
        onText(value) {
          line.descripcion = String(value || "").trim();
          const wanted = line.descripcion.toLowerCase();
          const found = wanted
            ? products.find((item) => String(item.descripcion || "").trim().toLowerCase() === wanted)
            : null;
          if (found) {
            applyProduct(found, "name");
            return;
          }
          line.producto_id = "";
          syncPhoto();
          paintPreview(line);
          emit();
        },
        onChange(id) {
          const product = products.find((item) => item.id === id);
          if (product) {
            applyProduct(product, "name");
            return;
          }
          line.producto_id = "";
          syncPhoto();
          paintPreview(line);
          emit();
        },
      });
      const cantidad = h("input", { class: "app-input", type: "number", min: "0", step: "1", "aria-label": "Cantidad" });
      cantidad.value = line.cantidad;
      const costo = mode === "entrada" ? h("input", { class: "app-input", type: "number", min: "0", step: "0.01", "aria-label": "Costo REF" }) : null;
      if (costo) {
        costo.value = line.ref_entrada;
      }
      const venta = mode === "falla" ? null : h("input", { class: "app-input", type: "number", min: "0", step: "0.01", "aria-label": "Venta REF" });
      if (venta) {
        venta.value = line.ref_venta;
      }
      const motivo = mode === "falla" ? h("input", { class: "app-input", placeholder: "Motivo de la falla", "aria-label": "Motivo" }) : null;
      if (motivo) {
        motivo.value = line.motivo;
      }
      const preview = h("div", { class: "cell-bs" });
      previews.set(line.key, preview);
      cantidad.addEventListener("input", () => {
        line.cantidad = cantidad.value;
        paintPreview(line);
        emit();
      });
      if (costo) {
        costo.addEventListener("input", () => {
          line.ref_entrada = costo.value;
          paintPreview(line);
          emit();
        });
      }
      if (venta) {
        venta.addEventListener("input", () => {
          line.ref_venta = venta.value;
          paintPreview(line);
          emit();
        });
      }
      if (motivo) {
        motivo.addEventListener("input", () => {
          line.motivo = motivo.value;
          emit();
        });
      }
      syncPhoto();
      viewPhoto.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeOpenCombos();
        const extras = (line.previewUrls || []).filter(Boolean);
        if (!line.producto_id && !extras.length) {
          return;
        }
        try {
          await openProductImage(line.producto_id, extras);
        } catch (err) {
          viewPhoto.title = err.message || "No se pudo abrir la imagen.";
        }
      });
      const remove = h("button", { class: "btn small danger", type: "button" }, "Quitar");
      remove.addEventListener("click", () => {
        releasePreviews(line);
        lines = lines.filter((item) => item.key !== line.key);
        if (!lines.length) {
          lines = [blankLine()];
        }
        render();
      });
      const fieldCells = currentFields.map((field) =>
        h(
          "td",
          {},
          controlForField(field, line.atributos[field.nombre] || "", (value) => {
            line.atributos[field.nombre] = value;
            emit();
          })
        )
      );
      return h(
        "tr",
        {},
        h("td", {}, codeCombo.element),
        h("td", {}, combo.element),
        h("td", {}, cantidad),
        mode === "entrada" ? h("td", {}, costo) : null,
        mode === "falla" ? h("td", {}, motivo) : h("td", {}, venta),
        h("td", {}, preview),
        ...fieldCells,
        mode === "entrada" ? h("td", {}, photoCell(line, render)) : null,
        h("td", { class: "col-remove" }, h("div", { class: "line-actions" }, viewPhoto, remove))
      );
    });
    board.replaceChildren(
      h(
        "table",
        { class: "data-table ops-table" },
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            h("th", {}, "Código"),
            h("th", {}, "Producto"),
            h("th", {}, "Cantidad"),
            mode === "entrada" ? h("th", {}, "Costo REF") : null,
            h("th", {}, mode === "falla" ? "Motivo" : "Venta REF"),
            h("th", {}, mode === "falla" ? "Disponible" : "Bs"),
            ...fieldHeaders,
            mode === "entrada" ? h("th", {}, "Fotos") : null,
            h("th", { class: "col-remove" }, "")
          )
        ),
        h("tbody", {}, ...rows)
      )
    );
    lines.forEach(paintPreview);
    emit();
  }

  add.addEventListener("click", () => {
    lines.push(blankLine());
    render();
  });
  host.replaceChildren(h("div", { class: "toolbar ops-toolbar" }, add, ...toolbarNodes), board);
  render();
  return {
    setTasa(next) {
      currentTasa = next;
      lines.forEach(paintPreview);
    },
    setFields(next) {
      currentFields = Array.isArray(next) ? [...next] : [];
      render();
    },
  };
}

export function mountLines(host, options) {
  return mountEntradaTable(host, options);
}
