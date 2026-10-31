const STORAGE_KEY = "jdparfum_cart_v1";

function readCart() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCart(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent("jdparfum:cart", { detail: items }));
  return items;
}

export function getCart() {
  return readCart();
}

export function cartCount() {
  return readCart().reduce((sum, item) => sum + Number(item.qty || 0), 0);
}

export function cartTotal() {
  return readCart().reduce((sum, item) => sum + Number(item.ref_venta || 0) * Number(item.qty || 0), 0);
}

export function addToCart(product, qty = 1) {
  const items = readCart();
  const id = String(product.id);
  const existing = items.find((item) => item.id === id);
  const nextQty = Math.max(1, Number(qty) || 1);
  if (existing) {
    existing.qty = Number(existing.qty || 0) + nextQty;
  } else {
    items.push({
      id,
      descripcion: product.descripcion || "",
      ref_venta: Number(product.ref_venta || 0),
      imagen_url: product.imagen_url || "",
      stock: Number(product.stock || 0),
      qty: nextQty,
    });
  }
  return writeCart(items);
}

export function setQty(productId, qty) {
  const id = String(productId);
  let items = readCart();
  const next = Math.max(0, Number(qty) || 0);
  if (next <= 0) {
    items = items.filter((item) => item.id !== id);
  } else {
    items = items.map((item) => (item.id === id ? { ...item, qty: next } : item));
  }
  return writeCart(items);
}

export function clearCart() {
  return writeCart([]);
}

export function onCartChange(handler) {
  const listener = (event) => handler(event.detail || readCart());
  window.addEventListener("jdparfum:cart", listener);
  return () => window.removeEventListener("jdparfum:cart", listener);
}
