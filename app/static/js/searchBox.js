import { catalogWords, loadContext, matchesQuery, productBlob, requestRestock } from "./catalog.js";
import { h } from "./dom.js";

function labelOf(product, ctx) {
  const code = product.codigo ? `${product.codigo} · ` : "";
  const cat = ctx.categorias.get(product.categoria_id)?.nombre;
  return `${code}${product.descripcion}${cat ? ` · ${cat}` : ""}`;
}

export function mountSearch(container, { onOpen, onQuery } = {}) {
  const input = h("input", {
    class: "app-input",
    type: "search",
    placeholder: "Buscar repuesto, código, marca, medida…",
    autocomplete: "off",
    "aria-label": "Buscador predictivo del catálogo",
  });
  const words = h("div", { class: "word-chips" });
  const list = h("div", { class: "suggest-list glass", hidden: true });
  const wrap = h("div", { class: "search-wrap" }, input, words, list);
  container.replaceChildren(wrap);

  let timer = null;
  const close = () => {
    list.hidden = true;
  };

  async function render() {
    const query = input.value.trim();
    if (onQuery) {
      onQuery(query);
    }
    const ctx = await loadContext();
    const dictionary = catalogWords(ctx);
    const last = query.split(/\s+/).pop()?.toLowerCase() || "";
    const completions = last.length >= 2 ? dictionary.filter((word) => word.startsWith(last) && word !== last).slice(0, 6) : [];
    words.replaceChildren(
      ...completions.map((word) => {
        const chip = h("button", { class: "word-chip", type: "button" }, word);
        chip.addEventListener("click", () => {
          const bits = query.split(/\s+/);
          bits.pop();
          bits.push(word);
          input.value = `${bits.join(" ")} `;
          input.focus();
          render();
        });
        return chip;
      })
    );

    if (!query) {
      close();
      return;
    }
    const ranked = ctx.listas.productos
      .filter((product) => product.is_active !== false)
      .map((product) => ({ product, blob: productBlob(product, ctx) }))
      .filter((item) => matchesQuery(item.blob, query))
      .sort((a, b) => {
        const as = a.product.descripcion.toLowerCase().startsWith(query.toLowerCase()) ? 0 : 1;
        const bs = b.product.descripcion.toLowerCase().startsWith(query.toLowerCase()) ? 0 : 1;
        return as - bs || a.product.descripcion.localeCompare(b.product.descripcion, "es");
      })
      .slice(0, 12);

    if (!ranked.length) {
      list.hidden = false;
      list.replaceChildren(h("div", { class: "suggest-empty-note" }, "Sin coincidencias en el catálogo."));
      return;
    }

    list.hidden = false;
    list.replaceChildren(
      ...ranked.map(({ product }) => {
        const empty = numStock(product) <= 0;
        const text = h("span", { class: "suggest-text" }, labelOf(product, ctx));
        const row = h("div", { class: empty ? "suggest-row suggest-open suggest-empty" : "suggest-row suggest-open" }, text);
        if (onOpen) {
          row.addEventListener("click", () => {
            close();
            onOpen(product.id);
          });
        }
        if (empty) {
          const done = product.solicitar_restock === true;
          const button = h("button", { class: "btn small", type: "button" }, done ? "Re-stock solicitado" : "Solicitar Re-stock");
          button.disabled = done;
          button.addEventListener("click", async (event) => {
            event.stopPropagation();
            await requestRestock(product);
            button.textContent = "Re-stock solicitado";
            button.disabled = true;
          });
          row.append(button);
        }
        return row;
      })
    );
  }

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(render, 80);
  });
  input.addEventListener("focus", render);
  const onDoc = (event) => {
    if (!container.isConnected) {
      document.removeEventListener("pointerdown", onDoc);
      return;
    }
    if (!wrap.contains(event.target)) {
      close();
    }
  };
  document.addEventListener("pointerdown", onDoc);
  return input;
}

function numStock(product) {
  const value = Number(product.stock || 0);
  return Number.isFinite(value) ? value : 0;
}
