import { controlForField, createCombo } from "./combo.js";
import { h } from "./dom.js";
import { newId } from "./db.js";

function blankLine() {
  return {
    key: newId(),
    producto_id: "",
    descripcion: "",
    cantidad: "1",
    ref_entrada: "",
    ref_venta: "",
    motivo: "",
    atributos: {},
  };
}

function productOptions(products) {
  return products
    .filter((product) => product.is_active !== false)
    .map((product) => ({
      value: product.id,
      label: `${product.codigo ? `${product.codigo} · ` : ""}${product.descripcion}`,
      search: `${product.codigo || ""} ${product.descripcion || ""} ${Object.values(product.atributos || {}).join(" ")}`,
    }));
}

function buildCard(line, index, products, mode, tasa, hooks) {
  const filter = h("input", { class: "app-input", placeholder: "Filtrar repuesto" });
  const select = h("select", { class: "app-select" });
  const refill = () => {
    const query = filter.value.trim().toLowerCase();
    const options = products.filter((product) => product.is_active !== false && `${product.codigo || ""} ${product.descripcion}`.toLowerCase().includes(query));
    select.replaceChildren(h("option", { value: "" }, "Seleccione un repuesto"));
    options.forEach((product) => select.append(h("option", { value: product.id }, `${product.codigo ? `${product.codigo} · ` : ""}${product.descripcion}`)));
    if (options.some((product) => product.id === line.producto_id)) {
      select.value = line.producto_id;
    }
  };
  refill();
  const cantidad = h("input", { class: "app-input", type: "number", min: "0", step: "1" });
  cantidad.value = line.cantidad;
  const costo = h("input", { class: "app-input", type: "number", min: "0", step: "0.01" });
  costo.value = line.ref_entrada;
  const venta = h("input", { class: "app-input", type: "number", min: "0", step: "0.01" });
  venta.value = line.ref_venta;
  const motivo = h("input", { class: "app-input", placeholder: "Motivo de la falla" });
  motivo.value = line.motivo;
  const preview = h("p", { class: "muted" }, "");
  const paint = () => {
    const product = products.find((item) => item.id === line.producto_id);
    const qty = Number(line.cantidad || 0);
    const rate = tasa ? Number(tasa.usd_ves) : 0;
    if (!product) {
      preview.textContent = "Elija el repuesto.";
      return;
    }
    if (mode === "entrada") {
      const ref = Number(line.ref_entrada || 0) * qty;
      preview.textContent = rate ? `Costo: ${ref.toFixed(2)} REF / ${(ref * rate).toFixed(2)} Bs. Stock ${product.stock}.` : `Costo: ${ref.toFixed(2)} REF. Stock ${product.stock}.`;
    } else if (mode === "salida") {
      const ref = Number(product.ref_venta || 0) * qty;
      preview.textContent = rate ? `Venta: ${ref.toFixed(2)} REF / ${(ref * rate).toFixed(2)} Bs. Disponible ${product.stock}.` : `Venta: ${ref.toFixed(2)} REF. Disponible ${product.stock}.`;
    } else {
      preview.textContent = `Disponible ${product.stock}. Esta baja no modifica las ventas.`;
    }
  };
  filter.addEventListener("input", refill);
  select.addEventListener("change", () => {
    const product = products.find((item) => item.id === select.value);
    line.producto_id = select.value;
    line.descripcion = product ? product.descripcion : "";
    line.ref_entrada = product ? String(product.ref_entrada ?? 0) : "";
    line.ref_venta = product ? String(product.ref_venta ?? 0) : "";
    costo.value = line.ref_entrada;
    venta.value = line.ref_venta;
    paint();
    hooks.onEdit();
  });
  cantidad.addEventListener("input", () => {
    line.cantidad = cantidad.value;
    paint();
    hooks.onEdit();
  });
  costo.addEventListener("input", () => {
    line.ref_entrada = costo.value;
    paint();
    hooks.onEdit();
  });
  venta.addEventListener("input", () => {
    line.ref_venta = venta.value;
    hooks.onEdit();
  });
  motivo.addEventListener("input", () => {
    line.motivo = motivo.value;
    hooks.onEdit();
  });
  const remove = h("button", { class: "btn small danger", type: "button" }, "Quitar");
  remove.addEventListener("click", hooks.onRemove);
  paint();
  return h(
    "article",
    { class: "glass bulk-row" },
    h("strong", {}, `Ítem ${index + 1}`),
    h("label", { class: "field-row" }, "Buscar", filter),
    h("label", { class: "field-row" }, "Repuesto", select),
    h("label", { class: "field-row" }, "Cantidad", cantidad),
    mode === "entrada" ? h("label", { class: "field-row" }, "Costo REF", costo) : null,
    mode === "entrada" ? h("label", { class: "field-row" }, "Venta REF", venta) : null,
    mode === "falla" ? h("label", { class: "field-row" }, "Motivo", motivo) : null,
    preview,
    remove
  );
}

function paintMoney(node, line, product, tasa) {
  if (!product) {
    node.replaceChildren("—");
    return;
  }
  const qty = Number(line.cantidad || 0);
  const ref = Number(line.ref_entrada || 0) * qty;
  const rate = tasa ? Number(tasa.usd_ves) : 0;
  if (!rate) {
    node.replaceChildren(`${ref.toFixed(2)} REF`, h("small", {}, `Bs pendiente · stock ${product.stock}`));
    return;
  }
  node.replaceChildren(`${(ref * rate).toFixed(2)} Bs`, h("small", {}, `${ref.toFixed(2)} REF · stock ${product.stock}`));
}

function mountEntradaTable(host, { products, tasa, fields, onChange, onRetireField, toolbarNodes = [] }) {
  let lines = [blankLine()];
  let currentTasa = tasa;
  let currentFields = fields || [];
  const board = h("div", { class: "ops-table-wrap" });
  const previews = new Map();
  const add = h("button", { class: "btn ghost", type: "button" }, "Añadir ítem");

  function emit() {
    onChange(
      lines
        .filter((line) => line.producto_id)
        .map((line) => ({
          producto_id: line.producto_id,
          descripcion: line.descripcion,
          cantidad: line.cantidad,
          ref_entrada: line.ref_entrada,
          ref_venta: line.ref_venta,
          motivo: line.motivo || "",
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
    paintMoney(node, line, product, currentTasa);
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
      const combo = createCombo({
        options: productOptions(products),
        value: line.producto_id,
        placeholder: "Buscar producto",
        emptyLabel: "Sin producto",
        ariaLabel: `Producto de la línea ${index + 1}`,
        onChange(id) {
          const product = products.find((item) => item.id === id);
          line.producto_id = id;
          line.descripcion = product ? product.descripcion : "";
          line.ref_entrada = product ? String(product.ref_entrada ?? 0) : "";
          line.ref_venta = product ? String(product.ref_venta ?? 0) : "";
          costo.value = line.ref_entrada;
          venta.value = line.ref_venta;
          paintPreview(line);
          emit();
        },
      });
      const cantidad = h("input", { class: "app-input", type: "number", min: "0", step: "1", "aria-label": "Cantidad" });
      cantidad.value = line.cantidad;
      const costo = h("input", { class: "app-input", type: "number", min: "0", step: "0.01", "aria-label": "Costo REF" });
      costo.value = line.ref_entrada;
      const venta = h("input", { class: "app-input", type: "number", min: "0", step: "0.01", "aria-label": "Venta REF" });
      venta.value = line.ref_venta;
      const preview = h("div", { class: "cell-bs" });
      previews.set(line.key, preview);
      cantidad.addEventListener("input", () => {
        line.cantidad = cantidad.value;
        paintPreview(line);
        emit();
      });
      costo.addEventListener("input", () => {
        line.ref_entrada = costo.value;
        paintPreview(line);
        emit();
      });
      venta.addEventListener("input", () => {
        line.ref_venta = venta.value;
        emit();
      });
      const remove = h("button", { class: "btn small danger", type: "button" }, "Quitar");
      remove.addEventListener("click", () => {
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
        h("td", {}, combo.element),
        h("td", {}, cantidad),
        h("td", {}, costo),
        h("td", {}, venta),
        h("td", {}, preview),
        ...fieldCells,
        h("td", {}, remove)
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
            h("th", {}, "Producto"),
            h("th", {}, "Cantidad"),
            h("th", {}, "Costo REF"),
            h("th", {}, "Venta REF"),
            h("th", {}, "Bs"),
            ...fieldHeaders,
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
      currentFields = next || [];
      render();
    },
  };
}

function mountCards(host, { products, mode, tasa, onChange, compact = false }) {
  let lines = [blankLine()];
  const board = h("div", { class: compact ? "ops-board" : "bulk-grid" });
  const add = h("button", { class: "btn ghost", type: "button" }, "Añadir ítem");

  function emit() {
    onChange(
      lines.filter((line) => line.producto_id),
      { count: lines.length }
    );
  }

  function render() {
    board.replaceChildren(
      ...lines.map((line, index) =>
        buildCard(line, index, products, mode, tasa, {
          onEdit: emit,
          onRemove() {
            lines = lines.filter((item) => item.key !== line.key);
            if (!lines.length) {
              lines = [blankLine()];
            }
            render();
          },
        })
      )
    );
    emit();
  }

  add.addEventListener("click", () => {
    lines.push(blankLine());
    render();
  });
  host.replaceChildren(add, board);
  render();
}

export function mountLines(host, options) {
  if (options.mode === "entrada") {
    return mountEntradaTable(host, options);
  }
  mountCards(host, options);
  return null;
}
