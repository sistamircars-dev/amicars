import {
  addToCart,
  cartCount,
  cartTotal,
  clearCart,
  getCart,
  onCartChange,
  setQty,
} from "./cart.js";

const PLACEHOLDER = "/static/img/jdparfum/logo.png";

const grid = document.getElementById("catalog-grid");
const statusEl = document.getElementById("catalog-status");
const searchInput = document.getElementById("catalog-search");
const cartToggle = document.getElementById("cart-toggle");
const cartClose = document.getElementById("cart-close");
const cartDrawer = document.getElementById("cart-drawer");
const cartList = document.getElementById("cart-list");
const cartCountEl = document.getElementById("cart-count");
const cartTotalEl = document.getElementById("cart-total");
const cartClear = document.getElementById("cart-clear");

let products = [];

function money(value) {
  return Number(value || 0).toLocaleString("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function thumbUrl(url) {
  if (!url) {
    return PLACEHOLDER;
  }
  if (url.includes("res.cloudinary.com") && url.includes("/upload/") && !url.includes("w_400")) {
    return url.replace("/upload/", "/upload/f_auto,q_auto,w_400/");
  }
  return url;
}

function safeImg(src, alt) {
  const img = document.createElement("img");
  img.src = thumbUrl(src) || PLACEHOLDER;
  img.alt = alt || "JD Parfum";
  img.loading = "lazy";
  img.addEventListener("error", () => {
    if (img.dataset.fallback === "1") {
      return;
    }
    img.dataset.fallback = "1";
    img.src = PLACEHOLDER;
  });
  return img;
}

function renderCart() {
  const items = getCart();
  cartCountEl.textContent = String(cartCount());
  cartTotalEl.textContent = money(cartTotal());
  cartList.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "sf-cart-note";
    empty.textContent = "Su carrito está vacío.";
    cartList.append(empty);
    return;
  }
  items.forEach((item) => {
    const row = document.createElement("article");
    row.className = "sf-cart-item";
    const info = document.createElement("div");
    const title = document.createElement("h4");
    title.textContent = item.descripcion || "Producto";
    const price = document.createElement("p");
    price.textContent = `${money(item.ref_venta)} REF`;
    info.append(title, price);

    const qtyWrap = document.createElement("div");
    qtyWrap.className = "sf-qty";
    const minus = document.createElement("button");
    minus.type = "button";
    minus.textContent = "−";
    minus.addEventListener("click", () => setQty(item.id, Number(item.qty || 0) - 1));
    const qty = document.createElement("span");
    qty.textContent = String(item.qty || 0);
    const plus = document.createElement("button");
    plus.type = "button";
    plus.textContent = "+";
    plus.addEventListener("click", () => setQty(item.id, Number(item.qty || 0) + 1));
    qtyWrap.append(minus, qty, plus);

    row.append(safeImg(item.imagen_url, item.descripcion), info, qtyWrap);
    cartList.append(row);
  });
}

function openCart() {
  cartDrawer.hidden = false;
}

function closeCart() {
  cartDrawer.hidden = true;
}

function filteredProducts() {
  const q = (searchInput.value || "").trim().toLowerCase();
  if (!q) {
    return products;
  }
  return products.filter((item) => {
    const blob = `${item.descripcion || ""} ${item.codigo || ""}`.toLowerCase();
    return blob.includes(q);
  });
}

function renderGrid() {
  const list = filteredProducts();
  grid.replaceChildren();
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "sf-empty";
    empty.textContent = products.length
      ? "Ninguna fragancia coincide con la búsqueda."
      : "Aún no hay productos publicados en el catálogo.";
    grid.append(empty);
    return;
  }
  list.forEach((product, index) => {
    const card = document.createElement("article");
    card.className = "sf-card";
    card.style.animationDelay = `${Math.min(index, 12) * 40}ms`;
    const title = document.createElement("h3");
    title.textContent = product.descripcion || "Fragancia";
    const meta = document.createElement("div");
    meta.className = "sf-meta";
    const stock = document.createElement("span");
    stock.textContent = `Disp. ${Number(product.stock || 0)}`;
    const price = document.createElement("span");
    price.className = "sf-price";
    price.textContent = `${money(product.ref_venta)} REF`;
    meta.append(stock, price);
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "sf-btn";
    addBtn.textContent = "Agregar";
    addBtn.addEventListener("click", () => {
      addToCart(product, 1);
      openCart();
    });
    card.append(safeImg(product.imagen_url, product.descripcion), title, meta, addBtn);
    grid.append(card);
  });
}

async function loadCatalog() {
  statusEl.textContent = "Cargando catálogo…";
  try {
    const response = await fetch("/api/catalog/products", {
      headers: { Accept: "application/json" },
    });
    const data = await response.json();
    products = Array.isArray(data.products) ? data.products : [];
    if (!response.ok || data.ok === false) {
      statusEl.textContent = data.error || "No se pudo cargar el catálogo.";
    } else {
      statusEl.textContent = `${products.length} fragancia${products.length === 1 ? "" : "s"}`;
    }
  } catch {
    products = [];
    statusEl.textContent = "Sin conexión al catálogo.";
  }
  renderGrid();
}

cartToggle.addEventListener("click", openCart);
cartClose.addEventListener("click", closeCart);
cartDrawer.addEventListener("click", (event) => {
  if (event.target === cartDrawer) {
    closeCart();
  }
});
cartClear.addEventListener("click", () => clearCart());
searchInput.addEventListener("input", renderGrid);
onCartChange(renderCart);
renderCart();
loadCatalog();
