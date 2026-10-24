import { loadContext, matchesQuery, productBlob, wordsOf } from "./catalog.js";
import { createCombo } from "./combo.js";
import { db } from "./db.js";
import { h, openModal } from "./dom.js";
import { deactivateLocal, hardDeleteLocal, saveLocal } from "./repository.js";

let assignTarget = { categoriaId: "", subcategoriaId: "" };
let assignQuery = "";
const assignSelected = new Set();

async function hasRelated(kind, record) {
  const id = record.id;
  if (kind === "categorias") {
    const subs = await db.subcategorias.where("categoria_id").equals(id).count();
    const products = await db.productos.where("categoria_id").equals(id).count();
    return subs + products > 0;
  }
  if (kind === "subcategorias") {
    const campos = await db.campos_personalizados.where("subcategoria_id").equals(id).count();
    const products = await db.productos.where("subcategoria_id").equals(id).count();
    return campos + products > 0;
  }
  const products = await db.productos.toArray();
  return products.some((item) => {
    const attrs = item.atributos || {};
    return Object.prototype.hasOwnProperty.call(attrs, id) || Object.prototype.hasOwnProperty.call(attrs, record.nombre);
  });
}

export async function saveCampo({ subcategoriaId, nombre, tipo = "text", opciones = [], allowLoose = false }) {
  const clean = String(nombre || "").trim();
  if (!subcategoriaId) {
    if (!allowLoose) {
      return { ok: false, error: "Elija la subcategoría del campo." };
    }
    if (!clean) {
      return { ok: false, error: "Escriba el nombre del campo." };
    }
    const allowed = ["text", "number", "select", "boolean"];
    return {
      ok: true,
      field: {
        id: `local-${clean.toLowerCase()}`,
        nombre: clean,
        tipo: allowed.includes(tipo) ? tipo : "text",
        opciones: Array.isArray(opciones) ? opciones : [],
        is_active: true,
      },
    };
  }
  if (!clean) {
    return { ok: false, error: "Escriba el nombre del campo." };
  }
  const existing = await db.campos_personalizados
    .filter((row) => row.subcategoria_id === subcategoriaId && String(row.nombre || "").trim().toLowerCase() === clean.toLowerCase())
    .first();
  if (existing) {
    return {
      ok: false,
      field: existing,
      error: existing.is_active === false ? "Ese campo ya existe y está inactivo porque tiene datos." : "Ese campo ya existe.",
    };
  }
  const siblings = await db.campos_personalizados.where("subcategoria_id").equals(subcategoriaId).count();
  const allowed = ["text", "number", "select", "boolean"];
  const field = await saveLocal("campos_personalizados", {
    subcategoria_id: subcategoriaId,
    nombre: clean,
    tipo: allowed.includes(tipo) ? tipo : "text",
    opciones: Array.isArray(opciones) ? opciones : [],
    orden: siblings,
    is_active: true,
  });
  return { ok: true, field };
}

export async function promptCategoria() {
  const values = await openModal({
    title: "Nueva categoría",
    fields: [
      { name: "nombre", label: "Nombre", required: true },
      { name: "descripcion", label: "Descripción" },
    ],
  });
  if (!values || !values.nombre) {
    return null;
  }
  const siblings = await db.categorias.count();
  return saveLocal("categorias", {
    nombre: values.nombre,
    descripcion: values.descripcion || "",
    imagen_url: "",
    orden: siblings,
    is_active: true,
  });
}

export async function promptSubcategoria(categoria) {
  if (!categoria?.id) {
    throw new Error("Elija primero la categoría.");
  }
  const values = await openModal({
    title: `Subcategoría en ${categoria.nombre}`,
    fields: [
      { name: "nombre", label: "Nombre", required: true },
      { name: "descripcion", label: "Descripción" },
    ],
  });
  if (!values || !values.nombre) {
    return null;
  }
  const siblings = await db.subcategorias.where("categoria_id").equals(categoria.id).count();
  return saveLocal("subcategorias", {
    categoria_id: categoria.id,
    nombre: values.nombre,
    descripcion: values.descripcion || "",
    orden: siblings,
    is_active: true,
  });
}

export async function retireCampo(record) {
  const related = await hasRelated("campos_personalizados", record);
  if (related) {
    await deactivateLocal("campos_personalizados", record.id);
    return "inactive";
  }
  await hardDeleteLocal("campos_personalizados", record.id);
  return "deleted";
}

export function mountCampoEditor({ categorias = [], subcategorias = [], getSubcategoriaId, onResult }) {
  const nombre = h("input", { class: "app-input", placeholder: "Nombre del campo" });
  const opciones = h("input", { class: "app-input", placeholder: "Rojo, Azul, Verde" });
  const opcionesRow = h("label", { class: "field-row" }, "Opciones", opciones);
  opcionesRow.hidden = true;
  opcionesRow.style.display = "none";
  let categoriaId = "";
  let subId = "";
  let tipo = "text";
  const showTaxonomy = !getSubcategoriaId;
  const tipoCombo = createCombo({
    options: [
      { value: "text", label: "Texto" },
      { value: "number", label: "Número" },
      { value: "select", label: "Lista" },
      { value: "boolean", label: "Sí / No" },
    ],
    value: "text",
    placeholder: "Tipo",
    ariaLabel: "Tipo de campo",
    onChange(value) {
      tipo = value || "text";
      const showOptions = tipo === "select";
      opcionesRow.hidden = !showOptions;
      opcionesRow.style.display = showOptions ? "" : "none";
    },
  });

  function catName(id) {
    return categorias.find((row) => row.id === id)?.nombre || "";
  }

  function subOptions() {
    return subcategorias
      .filter((row) => row.is_active !== false && (!categoriaId || row.categoria_id === categoriaId))
      .slice()
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
      .map((row) => {
        const parent = catName(row.categoria_id);
        return {
          value: row.id,
          label: !categoriaId && parent ? `${parent} · ${row.nombre}` : row.nombre,
          search: `${parent} ${row.nombre}`,
        };
      });
  }

  const subCombo = showTaxonomy
    ? createCombo({
        options: subOptions(),
        emptyLabel: "Elija subcategoría",
        placeholder: "Buscar subcategoría",
        ariaLabel: "Subcategoría",
        onChange(value) {
          subId = value;
        },
      })
    : null;
  const catCombo = showTaxonomy
    ? createCombo({
        options: categorias
          .filter((row) => row.is_active !== false)
          .slice()
          .sort((a, b) => Number(a.orden || 0) - Number(b.orden || 0) || a.nombre.localeCompare(b.nombre, "es"))
          .map((row) => ({ value: row.id, label: row.nombre })),
        emptyLabel: "Todas",
        placeholder: "Buscar categoría",
        ariaLabel: "Categoría",
        onChange(value) {
          categoriaId = value;
          const options = subOptions();
          if (!options.some((opt) => opt.value === subId)) {
            subId = "";
          }
          subCombo.setOptions(options);
          subCombo.setValue(subId, true);
        },
      })
    : null;

  const save = h("button", { class: "btn small", type: "button" }, "Guardar campo");
  const cancel = h("button", { class: "btn small ghost", type: "button" }, "Cancelar");
  const fields = h(
    "div",
    { class: "form-grid" },
    catCombo ? h("label", { class: "field-row" }, "Categoría", catCombo.element) : null,
    subCombo ? h("label", { class: "field-row" }, "Subcategoría", subCombo.element) : null,
    h("label", { class: "field-row" }, "Nombre", nombre),
    h("label", { class: "field-row" }, "Tipo", tipoCombo.element),
    opcionesRow,
    h("div", { class: "toolbar span-2" }, save, cancel)
  );
  const box = h("div", { class: "campo-form", hidden: true }, fields);
  cancel.addEventListener("click", () => {
    box.hidden = true;
  });
  save.addEventListener("click", async () => {
    const parsed = opciones.value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    try {
      const result = await saveCampo({
        subcategoriaId: getSubcategoriaId ? getSubcategoriaId() : subId,
        nombre: nombre.value,
        tipo,
        opciones: tipo === "select" ? parsed : [],
        allowLoose: true,
      });
      const usable = result.field && result.field.is_active !== false;
      if (usable) {
        nombre.value = "";
        opciones.value = "";
        tipo = "text";
        tipoCombo.setValue("text", true);
        opcionesRow.hidden = true;
        opcionesRow.style.display = "none";
        box.hidden = true;
      }
      if (onResult) {
        onResult(result);
      }
    } catch (err) {
      if (onResult) {
        onResult({ ok: false, error: err.message || "No se pudo crear el campo." });
      }
    }
  });
  return {
    element: box,
    toggle() {
      box.hidden = !box.hidden;
      if (!box.hidden) {
        nombre.focus();
      }
    },
  };
}

async function removeNode(kind, record, onChange) {
  const related = await hasRelated(kind, record);
  if (related) {
    await deactivateLocal(kind, record.id);
  } else {
    await hardDeleteLocal(kind, record.id);
  }
  await onChange();
}

function actions(kind, record, extra, onChange) {
  const add =
    extra && extra.onClick
      ? h("button", { class: "btn small ghost", type: "button" }, extra.label || "Añadir")
      : null;
  if (add) {
    add.addEventListener("click", extra.onClick);
  }
  const edit = h("button", { class: "btn small ghost", type: "button" }, "Editar");
  edit.addEventListener("click", async () => {
    const values = await openModal({
      title: `Editar ${record.nombre}`,
      fields: extra && extra.editFields ? extra.editFields(record) : [{ name: "nombre", label: "Nombre", value: record.nombre, required: true }],
    });
    if (!values) {
      return;
    }
    await saveLocal(kind, { ...record, ...values });
    await onChange();
  });
  const del = h("button", { class: "btn small danger", type: "button" }, record.is_active ? "Eliminar" : "Quitar");
  del.addEventListener("click", () => removeNode(kind, record, onChange));
  return h("div", { class: "acc-actions" }, add, edit, del);
}

export async function renderTaxonomy(root) {
  const ctx = await loadContext();
  const categorias = ctx.listas.categorias
    .slice()
    .sort((a, b) => Number(a.orden || 0) - Number(b.orden || 0) || String(a.nombre || "").localeCompare(String(b.nombre || ""), "es"));

  if (assignTarget.categoriaId && !ctx.categorias.has(assignTarget.categoriaId)) {
    assignTarget = { categoriaId: "", subcategoriaId: "" };
  }
  if (assignTarget.subcategoriaId) {
    const currentSub = ctx.subcategorias.get(assignTarget.subcategoriaId);
    if (!currentSub || currentSub.categoria_id !== assignTarget.categoriaId) {
      assignTarget = { categoriaId: assignTarget.categoriaId, subcategoriaId: "" };
    }
  }

  const pool = ctx.listas.productos.filter((product) => {
    if (product.is_active === false) {
      return false;
    }
    if (!product.categoria_id) {
      return true;
    }
    return !ctx.categorias.has(product.categoria_id);
  });
  const poolIds = new Set(pool.map((product) => product.id));
  [...assignSelected].forEach((id) => {
    if (!poolIds.has(id)) {
      assignSelected.delete(id);
    }
  });

  async function redraw() {
    await renderTaxonomy(root);
  }

  function subsOf(catId) {
    return ctx.listas.subcategorias
      .filter((item) => item.categoria_id === catId)
      .sort((a, b) => Number(a.orden || 0) - Number(b.orden || 0) || String(a.nombre || "").localeCompare(String(b.nombre || ""), "es"));
  }

  function targetName() {
    const cat = ctx.categorias.get(assignTarget.categoriaId);
    if (!cat) {
      return "";
    }
    const catLabel = `${cat.nombre}${cat.is_active === false ? " (inactiva)" : ""}`;
    const sub = assignTarget.subcategoriaId ? ctx.subcategorias.get(assignTarget.subcategoriaId) : null;
    if (!sub) {
      return catLabel;
    }
    return `${catLabel} · ${sub.nombre}${sub.is_active === false ? " (inactiva)" : ""}`;
  }

  async function addCategory() {
    const saved = await promptCategoria();
    if (!saved) {
      return;
    }
    assignTarget = { categoriaId: saved.id, subcategoriaId: "" };
    await redraw();
  }

  async function addSubcategory(cat) {
    const saved = await promptSubcategoria(cat);
    if (!saved) {
      return;
    }
    assignTarget = { categoriaId: cat.id, subcategoriaId: saved.id };
    await redraw();
  }

  async function editRecord(kind, record) {
    const values = await openModal({
      title: `Editar ${record.nombre}`,
      fields: [
        { name: "nombre", label: "Nombre", value: record.nombre, required: true },
        { name: "descripcion", label: "Descripción", value: record.descripcion || "" },
      ],
    });
    if (!values) {
      return;
    }
    await saveLocal(kind, { ...record, ...values });
    await redraw();
  }

  function tool(label, title, onClick, danger = false) {
    const button = h(
      "button",
      { class: danger ? "btn small danger cat-plus" : "btn small ghost cat-plus", type: "button", title, "aria-label": title },
      label
    );
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  function schemeRow(record, { indent = false, onAdd } = {}) {
    const kind = indent ? "subcategorias" : "categorias";
    const active = indent
      ? assignTarget.subcategoriaId === record.id
      : assignTarget.categoriaId === record.id && !assignTarget.subcategoriaId;
    const select = h(
      "button",
      { class: `cat-node${indent ? " sub" : ""}${active ? " active" : ""}`, type: "button" },
      `${record.nombre}${record.is_active === false ? " (inactiva)" : ""}`
    );
    select.addEventListener("click", () => {
      if (active) {
        assignTarget = { categoriaId: "", subcategoriaId: "" };
      } else {
        assignTarget = indent
          ? { categoriaId: record.categoria_id, subcategoriaId: record.id }
          : { categoriaId: record.id, subcategoriaId: "" };
      }
      paintRail();
      paintList();
    });
    return h(
      "div",
      { class: record.is_active === false ? "cat-node-row inactive" : "cat-node-row" },
      select,
      h(
        "div",
        { class: "cat-tools" },
        onAdd ? tool("+", "Añadir subcategoría", () => onAdd(record)) : null,
        tool("✎", "Editar", () => editRecord(kind, record)),
        tool("×", record.is_active === false ? "Quitar" : "Desactivar", () => removeNode(kind, record, redraw), true)
      )
    );
  }

  const railList = h("div", { class: "cat-scheme" });
  function paintRail() {
    const nodes = [];
    if (!categorias.length) {
      nodes.push(h("p", { class: "muted" }, "Aún no hay categorías."));
    }
    categorias.forEach((cat) => {
      nodes.push(schemeRow(cat, { onAdd: addSubcategory }));
      subsOf(cat.id).forEach((sub) => nodes.push(schemeRow(sub, { indent: true })));
    });
    railList.replaceChildren(...nodes);
  }

  const search = h("input", {
    class: "app-input",
    type: "search",
    value: assignQuery,
    placeholder: "Filtrar por código, descripción, marca, medida…",
    autocomplete: "off",
    "aria-label": "Filtro de productos sin categoría",
  });
  const chips = h("div", { class: "word-chips" });
  const listHost = h("div");
  const status = h("p", { class: "muted" }, "");
  const assignBtn = h("button", { class: "btn", type: "button" }, "Asignar");

  function filteredProducts() {
    return pool.filter((product) => matchesQuery(productBlob(product, ctx), assignQuery));
  }

  function paintList() {
    const filtered = filteredProducts();
    const last = assignQuery.split(/\s+/).pop()?.toLowerCase() || "";
    const bag = new Set();
    pool.forEach((product) => wordsOf(productBlob(product, ctx)).forEach((word) => bag.add(word)));
    const completions =
      last.length >= 2
        ? [...bag]
            .filter((word) => word.startsWith(last) && word !== last)
            .sort((a, b) => a.localeCompare(b, "es"))
            .slice(0, 6)
        : [];
    chips.replaceChildren(
      ...completions.map((word) => {
        const chip = h("button", { class: "word-chip", type: "button" }, word);
        chip.addEventListener("click", () => {
          const bits = assignQuery.split(/\s+/).filter(Boolean);
          bits.pop();
          bits.push(word);
          assignQuery = `${bits.join(" ")} `;
          search.value = assignQuery;
          paintList();
          search.focus();
        });
        return chip;
      })
    );

    const name = targetName();
    const chosen = filtered.filter((product) => assignSelected.has(product.id)).length;
    assignBtn.disabled = !name || chosen === 0;
    assignBtn.textContent = name ? `Asignar a ${name}` : "Asignar";
    status.textContent = pool.length
      ? `${filtered.length} de ${pool.length} sin categoría. ${chosen ? `${chosen} marcado(s).` : "Marque uno por uno o todos los filtrados."}`
      : "No hay productos sin categoría.";

    if (!filtered.length) {
      listHost.replaceChildren(
        h("div", { class: "empty glass" }, pool.length ? "Ningún producto coincide con el filtro." : "Todos los productos ya tienen categoría.")
      );
      return;
    }

    const master = h("input", { type: "checkbox", "aria-label": "Marcar los productos filtrados" });
    master.checked = filtered.every((product) => assignSelected.has(product.id));
    master.indeterminate = !master.checked && filtered.some((product) => assignSelected.has(product.id));
    master.addEventListener("change", () => {
      filtered.forEach((product) => {
        if (master.checked) {
          assignSelected.add(product.id);
        } else {
          assignSelected.delete(product.id);
        }
      });
      paintList();
    });

    const body = filtered.map((product) => {
      const box = h("input", { type: "checkbox", "aria-label": `Marcar ${product.descripcion || "producto"}` });
      box.checked = assignSelected.has(product.id);
      box.addEventListener("change", () => {
        if (box.checked) {
          assignSelected.add(product.id);
        } else {
          assignSelected.delete(product.id);
        }
        paintList();
      });
      return h("tr", {}, h("td", {}, box), h("td", {}, product.codigo || "—"), h("td", {}, product.descripcion || "—"), h("td", {}, String(product.stock ?? 0)));
    });
    listHost.replaceChildren(
      h(
        "div",
        { class: "table-wrap" },
        h(
          "table",
          { class: "data-table assign-table" },
          h("thead", {}, h("tr", {}, h("th", { title: "Todos los filtrados" }, master), h("th", {}, "Código"), h("th", {}, "Descripción"), h("th", {}, "Stock"))),
          h("tbody", {}, ...body)
        )
      )
    );
  }

  search.addEventListener("input", () => {
    assignQuery = search.value;
    paintList();
  });
  assignBtn.addEventListener("click", async () => {
    if (!ctx.categorias.has(assignTarget.categoriaId)) {
      status.textContent = "Toque una categoría o subcategoría en el esquema.";
      return;
    }
    const ids = pool
      .filter((product) => assignSelected.has(product.id) && matchesQuery(productBlob(product, ctx), assignQuery))
      .map((product) => product.id);
    if (!ids.length) {
      status.textContent = "Marque al menos un producto.";
      return;
    }
    assignBtn.disabled = true;
    try {
      for (const id of ids) {
        const product = await db.productos.get(id);
        if (!product) {
          continue;
        }
        await saveLocal("productos", {
          ...product,
          categoria_id: assignTarget.categoriaId,
          subcategoria_id: assignTarget.subcategoriaId || null,
        });
        assignSelected.delete(id);
      }
      await redraw();
    } catch (err) {
      status.textContent = err.message || "No se pudo asignar.";
      assignBtn.disabled = false;
    }
  });

  root.replaceChildren(
    h(
      "div",
      { class: "cat-layout" },
      h(
        "aside",
        { class: "glass cat-rail", "aria-label": "Esquema de categorías" },
        h("div", { class: "cat-rail-head" }, h("strong", {}, "Esquema"), tool("+", "Añadir categoría", addCategory)),
        railList
      ),
      h(
        "section",
        { class: "cat-work" },
        h("div", { class: "view-title" }, h("h2", {}, "Categorías")),
        h("p", { class: "muted" }, "Toque el destino en el esquema y asigne los productos que todavía no tienen categoría. En cada fila puede editar o desactivar."),
        search,
        chips,
        h("div", { class: "toolbar" }, assignBtn),
        status,
        listHost
      )
    )
  );
  paintRail();
  paintList();
}
