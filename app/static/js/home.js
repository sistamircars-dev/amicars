import { coverFor, loadContext, PLACEHOLDER, safeImg } from "./catalog.js";
import { h } from "./dom.js";
import { go } from "./nav.js";
import { openProduct } from "./productDetail.js";
import { mountSearch } from "./searchBox.js";

export async function renderHome(root) {
  const ctx = await loadContext();
  const searchHost = h("div", { class: "hero-search" });
  const cats = ctx.listas.categorias
    .filter((row) => row.is_active !== false)
    .sort((a, b) => Number(a.orden || 0) - Number(b.orden || 0) || a.nombre.localeCompare(b.nombre, "es"));
  const grid = h("div", { class: "float-grid" });
  cats.forEach((cat, index) => {
    const sample = ctx.listas.productos.find((product) => product.categoria_id === cat.id && product.is_active !== false);
    const photo = sample ? coverFor(sample.id, ctx) : { src: cat.imagen_url || PLACEHOLDER };
    const img = safeImg(photo.src || cat.imagen_url || PLACEHOLDER, cat.nombre, "float-photo");
    img.style.animationDelay = `${index * 0.18}s`;
    const card = h(
      "button",
      { class: "glass float-card", type: "button" },
      h("span", { class: "float-frame" }, img),
      h("span", { class: "float-caption", title: cat.nombre }, cat.nombre)
    );
    card.addEventListener("click", () => go("inventario", { categoriaId: cat.id }));
    grid.append(card);
  });
  root.replaceChildren(
    h("div", { class: "view-title" }, h("h2", {}, "Catálogo")),
    h("p", { class: "muted" }, "Sin stock, el ítem se ve en gris claro y la ficha se puede abrir."),
    searchHost,
    cats.length ? grid : h("div", { class: "empty glass" }, "Cree categorías para ver las miniaturas flotantes.")
  );
  mountSearch(searchHost, { onOpen: (id) => openProduct(id) });
}
