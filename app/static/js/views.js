import { renderBitacora } from "./bitacora.js";
import { renderConfig } from "./bcvView.js";
import { renderFallas } from "./fallas.js";
import { renderInventory } from "./inventory.js";
import { renderPedidos } from "./pedidos.js";
import { renderProveedores } from "./proveedores.js";
import { renderSalidas } from "./salidas.js";
import { renderTaxonomy } from "./taxonomy.js";

export const VIEWS = {
  inventario: { label: "Inventario", render: renderInventory },
  categorias: { label: "Categorías", render: renderTaxonomy },
  salidas: { label: "Salidas", render: renderSalidas },
  fallas: { label: "Fallas", render: renderFallas },
  proveedores: { label: "Proveedores", render: renderProveedores },
  bitacora: { label: "Bitácora", render: renderBitacora },
  pedidos: { label: "Sugerencia de pedido", render: renderPedidos },
  configuracion: { label: "Configuración", render: renderConfig },
};
