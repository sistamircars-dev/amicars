import { db } from "./db.js";

function norm(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export async function loadRegisteredClients() {
  const moves = await db.movimientos_inventario.filter((row) => row.tipo === "salida").toArray();
  const map = new Map();
  for (const move of moves) {
    const name = String(move.cliente_nombre || "").trim();
    const doc = String(move.cliente_documento || "").trim();
    if (!name && !doc) {
      continue;
    }
    const key = `${norm(name)}|${norm(doc)}`;
    if (!map.has(key)) {
      map.set(key, { id: key, name, doc });
    }
  }
  return [...map.values()]
    .sort((a, b) => a.name.localeCompare(b.name, "es"))
    .map((client) => ({
      value: client.id,
      name: client.name,
      doc: client.doc,
      label: client.doc ? `${client.name} · ${client.doc}` : client.name,
      search: `${client.name} ${client.doc}`.trim(),
    }));
}

export function clientComboOptions(clients, { docFirst = false } = {}) {
  return clients.map((client) => ({
    value: client.value,
    label: docFirst && client.doc ? `${client.doc} · ${client.name}` : client.label,
    search: client.search,
    name: client.name,
    doc: client.doc,
  }));
}
