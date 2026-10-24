import { createProduct, findByCodigo, loadContext, parseCatalogLines, updateProduct } from "./catalog.js";
import { controlForField, createCombo } from "./combo.js";
import { db, newId } from "./db.js";
import { h } from "./dom.js";
import { mountCampoEditor, retireCampo } from "./taxonomy.js";

function blankBulkRow() {
  return {
    key: newId(),
    producto_id: "",
    codigo: "",
    descripcion: "",
    ref_entrada: "",
    ref_venta: "",
    stock: "",
    atributos: {},
    files: [],
    previewUrls: [],
  };
}

function releasePreviews(row) {
  (row.previewUrls || []).forEach((url) => {
    try {
      URL.revokeObjectURL(url);
    } catch (err) {
      /* el objeto ya no existe */
    }
  });
  row.previewUrls = [];
}

function rememberFiles(row, fileList) {
  if (!row.previewUrls) {
    row.previewUrls = [];
  }
  [...fileList].forEach((file) => {
    row.files.push(file);
    row.previewUrls.push(URL.createObjectURL(file));
  });
}

function foldName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function mountTaxonomyCombos(ctx, { onContextChange } = {}) {
  let categoriaId = "";
  let subcategoriaId = "";
  let proveedorId = "";
  let ready = false;
  const categorias = ctx.listas.categorias.filter((row) => row.is_active !== false);
  const proveedores = ctx.listas.proveedores.filter((row) => row.is_active !== false);

  function subOptions() {
    return ctx.listas.subcategorias
      .filter((row) => row.categoria_id === categoriaId && row.is_active !== false)
      .map((row) => ({ value: row.id, label: row.nombre }));
  }

  const subCombo = createCombo({
    options: [],
    emptyLabel: "Sin subcategoría",
    placeholder: "Buscar subcategoría",
    ariaLabel: "Subcategoría",
    onChange(id) {
      subcategoriaId = id;
      if (ready && onContextChange) {
        onContextChange();
      }
    },
  });
  const catCombo = createCombo({
    options: categorias
      .slice()
      .sort((a, b) => Number(a.orden || 0) - Number(b.orden || 0) || a.nombre.localeCompare(b.nombre, "es"))
      .map((row) => ({ value: row.id, label: row.nombre })),
    emptyLabel: "Sin categoría",
    placeholder: "Buscar categoría",
    ariaLabel: "Categoría",
    onChange(id) {
      categoriaId = id;
      const options = subOptions();
      if (!options.some((opt) => opt.value === subcategoriaId)) {
        subcategoriaId = "";
      }
      subCombo.setOptions(options);
      subCombo.setValue(subcategoriaId, true);
      if (ready && onContextChange) {
        onContextChange();
      }
    },
  });
  const provCombo = createCombo({
    options: proveedores
      .slice()
      .sort((a, b) => String(a.razon_social || "").localeCompare(String(b.razon_social || ""), "es"))
      .map((row) => ({
        value: row.id,
        label: `${row.codigo_proveedor} · ${row.razon_social}`,
        search: [row.codigo_proveedor, row.razon_social, row.contacto, row.telefono, row.email].filter(Boolean).join(" "),
      })),
    emptyLabel: "Sin proveedor",
    placeholder: "Buscar proveedor",
    ariaLabel: "Proveedor",
    onChange(id) {
      proveedorId = id;
    },
  });
  subCombo.setOptions(subOptions());
  ready = true;
  return {
    categoriaId: () => categoriaId,
    subcategoriaId: () => subcategoriaId,
    proveedorId: () => proveedorId,
    cat: catCombo.element,
    sub: subCombo.element,
    prov: provCombo.element,
  };
}

export async function renderBulk(root, { onDone }) {
  const ctx = await loadContext();
  const paste = h("textarea", {
    class: "app-input",
    rows: "4",
    placeholder: "Código\tDescripción\tCosto REF\tVenta REF\tStock\tMarca",
  });
  const grid = h("div", { class: "ops-table-wrap" });
  const status = h("p", { class: "muted" }, "Cada fila es un producto. Las fotos se adjuntan en la columna de esa línea.");
  let rows = [blankBulkRow()];

  const taxonomy = mountTaxonomyCombos(ctx, { onContextChange: () => drawRows() });

  function camposForSub() {
    const selected = ctx.listas.campos
      .filter((field) => field.subcategoria_id === taxonomy.subcategoriaId() && field.is_active !== false)
      .sort((a, b) => Number(a.orden || 0) - Number(b.orden || 0) || a.nombre.localeCompare(b.nombre, "es"));
    const known = new Set(selected.map((field) => foldName(field.nombre)));
    const extras = [];
    rows.forEach((row) => {
      Object.keys(row.atributos || {}).forEach((name) => {
        const folded = foldName(name);
        if (!folded || known.has(folded)) {
          return;
        }
        known.add(folded);
        const match = ctx.listas.campos.find((field) => field.is_active !== false && foldName(field.nombre) === folded);
        extras.push(match || { id: `paste:${folded}`, nombre: name, tipo: "text", is_active: true, pasted: true });
      });
    });
    return [...selected, ...extras];
  }

  async function dropField(field) {
    try {
      const outcome = await retireCampo(field);
      if (outcome === "inactive") {
        field.is_active = false;
        status.textContent = "El campo se desactivó porque ya tiene datos.";
      } else {
        ctx.listas.campos = ctx.listas.campos.filter((item) => item.id !== field.id);
        status.textContent = "Campo quitado.";
      }
      drawRows();
    } catch (err) {
      status.textContent = err.message || "No se pudo quitar el campo.";
    }
  }

  function applyProduct(row, product) {
    row.producto_id = product.id;
    row.codigo = product.codigo || "";
    row.descripcion = product.descripcion || "";
    row.ref_entrada = product.ref_entrada === null || product.ref_entrada === undefined ? "" : String(product.ref_entrada);
    row.ref_venta = product.ref_venta === null || product.ref_venta === undefined ? "" : String(product.ref_venta);
    row.stock = product.stock === null || product.stock === undefined ? "" : String(product.stock);
    row.atributos = { ...(product.atributos || {}) };
    drawRows();
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

  function drawRows() {
    document.querySelectorAll("img.photo-hover").forEach((node) => node.remove());
    const products = ctx.listas.productos.filter((item) => item.is_active !== false);
    const codeOptions = products
      .filter((item) => String(item.codigo || "").trim())
      .map((item) => ({
        value: item.id,
        label: item.codigo,
        search: `${item.codigo || ""} ${item.descripcion || ""}`,
      }));
    const descOptions = products.map((item) => ({
      value: item.id,
      label: item.descripcion || "Sin descripción",
      search: `${item.codigo || ""} ${item.descripcion || ""}`,
    }));
    const campos = camposForSub();
    const head = h(
      "tr",
      {},
      h("th", {}, "Código"),
      h("th", {}, "Descripción"),
      h("th", {}, "Costo REF"),
      h("th", {}, "Venta REF"),
      h("th", {}, "Stock"),
      ...campos.map((field) => {
        if (field.pasted || field.subcategoria_id !== taxonomy.subcategoriaId()) {
          return h("th", {}, field.nombre);
        }
        const removeField = h("button", { class: "btn small ghost", type: "button", "aria-label": `Quitar ${field.nombre}` }, "×");
        removeField.addEventListener("click", () => dropField(field));
        return h("th", {}, h("div", { class: "th-field" }, field.nombre, removeField));
      }),
      h("th", {}, "Fotos"),
      h("th", { class: "col-remove" }, "")
    );
    const body = rows.map((row) => {
      if (!row.atributos) {
        row.atributos = {};
      }
      if (!row.files) {
        row.files = [];
      }
      if (!row.previewUrls) {
        row.previewUrls = [];
      }
      while (row.previewUrls.length < row.files.length) {
        row.previewUrls.push(URL.createObjectURL(row.files[row.previewUrls.length]));
      }
      const codeValue = codeOptions.some((opt) => opt.value === row.producto_id) ? row.producto_id : "";
      const codigo = createCombo({
        options: codeOptions,
        value: codeValue,
        text: row.codigo || "",
        freeText: true,
        placeholder: "Buscar código",
        ariaLabel: "Código",
        onChange(id) {
          const product = products.find((item) => item.id === id);
          if (product) {
            applyProduct(row, product);
          }
        },
        onText(text) {
          row.codigo = text;
          row.producto_id = "";
        },
      });
      const descripcion = createCombo({
        options: descOptions,
        value: row.producto_id || "",
        text: row.descripcion || "",
        freeText: true,
        placeholder: "Buscar descripción",
        ariaLabel: "Descripción",
        onChange(id) {
          const product = products.find((item) => item.id === id);
          if (product) {
            applyProduct(row, product);
          }
        },
        onText(text) {
          row.descripcion = text;
          row.producto_id = "";
        },
      });
      const refEntrada = h("input", { class: "app-input", type: "number", min: "0", step: "0.01", "aria-label": "Costo REF" });
      const refVenta = h("input", { class: "app-input", type: "number", min: "0", step: "0.01", "aria-label": "Venta REF" });
      const stock = h("input", { class: "app-input", type: "number", min: "0", step: "1", "aria-label": "Stock" });
      refEntrada.value = row.ref_entrada;
      refVenta.value = row.ref_venta;
      stock.value = row.stock;
      refEntrada.addEventListener("input", () => {
        row.ref_entrada = refEntrada.value;
      });
      refVenta.addEventListener("input", () => {
        row.ref_venta = refVenta.value;
      });
      stock.addEventListener("input", () => {
        row.stock = stock.value;
      });
      const caption = h("span", {}, row.files.length ? `Fotos (${row.files.length})` : "Fotos");
      const file = h("input", {
        class: "line-photo-input",
        type: "file",
        accept: "image/jpeg,image/png,image/webp",
        multiple: "multiple",
      });
      file.addEventListener("change", () => {
        rememberFiles(row, file.files);
        file.value = "";
        drawRows();
      });
      const thumbs = row.files.map((item, index) => {
        const url = row.previewUrls[index];
        const chip = h("span", { class: "photo-chip", title: item.name || "Foto" }, h("img", { class: "photo-mini", src: url, alt: item.name || "Foto" }));
        if (url) {
          bindThumb(chip, item, url);
        }
        return chip;
      });
      const photoBtn = h("div", { class: "photo-line" }, h("label", { class: "btn small ghost line-photo" }, caption, file), ...thumbs);
      const remove = h("button", { class: "btn small danger", type: "button" }, "Quitar");
      remove.addEventListener("click", () => {
        releasePreviews(row);
        rows = rows.filter((item) => item.key !== row.key);
        if (!rows.length) {
          rows = [blankBulkRow()];
        }
        drawRows();
      });
      return h(
        "tr",
        {},
        h("td", {}, codigo.element),
        h("td", {}, descripcion.element),
        h("td", {}, refEntrada),
        h("td", {}, refVenta),
        h("td", {}, stock),
        ...campos.map((field) =>
          h(
            "td",
            {},
            controlForField(field, row.atributos[field.nombre] || "", (value) => {
              row.atributos[field.nombre] = value;
            })
          )
        ),
        h("td", {}, photoBtn),
        h("td", {}, remove)
      );
    });
    grid.replaceChildren(h("table", { class: "data-table ops-table" }, h("thead", {}, head), h("tbody", {}, ...body)));
  }

  const editor = mountCampoEditor({
    getSubcategoriaId: () => taxonomy.subcategoriaId(),
    onResult(result) {
      if (!result.field || result.field.is_active === false) {
        status.textContent = result.error || "No se pudo crear el campo.";
        return;
      }
      if (!ctx.listas.campos.some((field) => field.id === result.field.id)) {
        ctx.listas.campos.push(result.field);
      }
      drawRows();
      status.textContent = result.ok ? "Columna añadida." : "Ese campo ya existe y quedó en la tabla.";
    },
  });
  const addCampo = h("button", { class: "btn ghost", type: "button" }, "Añadir campo");
  addCampo.addEventListener("click", () => {
    if (!taxonomy.subcategoriaId()) {
      status.textContent = "Elija la subcategoría antes de añadir un campo.";
      return;
    }
    editor.toggle();
  });
  const addLine = h("button", { class: "btn ghost", type: "button" }, "Añadir línea");
  addLine.addEventListener("click", () => {
    rows.push(blankBulkRow());
    drawRows();
  });

  function applyPaste(text) {
    const parsed = parseCatalogLines(text, ctx.listas.campos.filter((field) => field.is_active !== false)).map((row) => ({
      ...blankBulkRow(),
      ...row,
      key: newId(),
      producto_id: "",
      files: [],
      previewUrls: [],
      atributos: row.atributos || {},
    }));
    rows.forEach(releasePreviews);
    rows = parsed.length ? parsed : [blankBulkRow()];
    status.textContent = parsed.length
      ? `${parsed.length} filas listas para revisar.`
      : "No hay líneas con código o descripción.";
    drawRows();
  }

  const preview = h("button", { class: "btn ghost", type: "button" }, "Preparar líneas");
  preview.addEventListener("click", () => applyPaste(paste.value));
  paste.addEventListener("paste", (event) => {
    const text = event.clipboardData && event.clipboardData.getData("text/plain");
    if (!text || (!text.includes("\t") && !text.includes("|") && !text.includes(";"))) {
      return;
    }
    event.preventDefault();
    paste.value = text;
    applyPaste(text);
  });

  const save = h("button", { class: "btn", type: "button" }, "Guardar lote");
  save.addEventListener("click", async () => {
    if (!rows.some((row) => String(row.descripcion || "").trim())) {
      status.textContent = "Escriba al menos una descripción.";
      return;
    }
    save.disabled = true;
    let created = 0;
    let updated = 0;
    const notes = [];
    for (const row of rows) {
      const descripcion = String(row.descripcion || "").trim();
      if (!descripcion) {
        continue;
      }
      const input = {
        codigo: String(row.codigo || "").trim(),
        descripcion,
        ref_entrada: row.ref_entrada,
        ref_venta: row.ref_venta,
        stock: row.stock,
        atributos: row.atributos || {},
        categoria_id: taxonomy.categoriaId(),
        subcategoria_id: taxonomy.subcategoriaId(),
        proveedor_id: taxonomy.proveedorId(),
      };
      const files = row.files || [];
      const linked = row.producto_id ? await db.productos.get(row.producto_id) : null;
      const found = linked && linked.is_active !== false ? linked : await findByCodigo(input.codigo, taxonomy.subcategoriaId());
      if (found) {
        const result = await updateProduct(found, input, files);
        updated += 1;
        notes.push(...result.notes);
      } else {
        const result = await createProduct(input, files);
        created += 1;
        notes.push(...result.notes);
      }
    }
    status.textContent = `Creados: ${created}. Actualizados sin sumar stock: ${updated}. ${notes.join(" ")}`;
    save.disabled = false;
  });

  root.replaceChildren(
    h("div", { class: "view-title" }, h("h2", {}, "Carga masiva de catálogo"), h("button", { class: "btn ghost", type: "button", onclick: onDone }, "Volver")),
    h(
      "div",
      { class: "entrada-fields" },
      h("label", { class: "field-row" }, "Categoría", taxonomy.cat),
      h("label", { class: "field-row" }, "Subcategoría", taxonomy.sub),
      h("label", { class: "field-row" }, "Proveedor", taxonomy.prov)
    ),
    h("div", { class: "toolbar ops-toolbar" }, addLine, addCampo, save),
    editor.element,
    status,
    grid,
    h(
      "details",
      { class: "paste-box" },
      h("summary", {}, "Pegar listado"),
      h(
        "p",
        { class: "muted" },
        "Pegue una tabla de Excel. Si la primera fila trae encabezados (código, descripción, costo REF, venta REF, stock o un campo existente), se reconocen solos. Sin encabezados, el orden es código, descripción, costo REF, venta REF y stock. El listado con | sigue valiendo."
      ),
      paste,
      preview
    )
  );
  drawRows();
}
