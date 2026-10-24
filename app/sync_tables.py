from __future__ import annotations

TABLE_ORDER = (
    "categorias",
    "subcategorias",
    "campos_personalizados",
    "proveedores",
    "productos",
    "producto_proveedores",
    "producto_imagenes",
    "historico_ref",
    "tasas_bcv",
    "configuracion_sistema",
    "solicitudes_restock",
    "preferencias_usuario",
    "movimientos_inventario",
)

IMMUTABLE_TABLES = frozenset({"movimientos_inventario"})

STRIP_ON_PUSH: dict[str, frozenset[str]] = {}

COLUMNS: dict[str, frozenset[str]] = {
    "categorias": frozenset(
        {"id", "nombre", "descripcion", "imagen_url", "orden", "is_active", "created_at", "updated_at", "created_by"}
    ),
    "subcategorias": frozenset(
        {
            "id",
            "categoria_id",
            "nombre",
            "descripcion",
            "orden",
            "is_active",
            "created_at",
            "updated_at",
            "created_by",
        }
    ),
    "campos_personalizados": frozenset(
        {
            "id",
            "subcategoria_id",
            "nombre",
            "tipo",
            "opciones",
            "orden",
            "is_active",
            "created_at",
            "updated_at",
            "created_by",
        }
    ),
    "proveedores": frozenset(
        {
            "id",
            "codigo_proveedor",
            "razon_social",
            "contacto",
            "telefono",
            "email",
            "notas",
            "is_active",
            "created_at",
            "updated_at",
            "created_by",
        }
    ),
    "productos": frozenset(
        {
            "id",
            "categoria_id",
            "subcategoria_id",
            "codigo",
            "descripcion",
            "atributos",
            "proveedor_id",
            "stock",
            "stock_minimo",
            "ref_entrada",
            "ref_venta",
            "solicitar_restock",
            "is_active",
            "created_at",
            "updated_at",
            "created_by",
        }
    ),
    "producto_imagenes": frozenset(
        {
            "id",
            "producto_id",
            "cloudinary_url",
            "cloudinary_public_id",
            "alt_text",
            "orden",
            "is_cover",
            "is_active",
            "created_at",
            "updated_at",
            "created_by",
        }
    ),
    "producto_proveedores": frozenset(
        {
            "id",
            "producto_id",
            "proveedor_id",
            "codigo_sku",
            "stock_minimo",
            "is_active",
            "created_at",
            "updated_at",
            "created_by",
        }
    ),
    "historico_ref": frozenset(
        {
            "id",
            "producto_id",
            "ref_entrada",
            "ref_venta",
            "vigente_desde",
            "vigente_hasta",
            "movimiento_id",
            "is_active",
            "created_at",
            "updated_at",
            "created_by",
        }
    ),
    "tasas_bcv": frozenset(
        {"id", "fecha", "usd_ves", "fuente", "is_active", "created_at", "updated_at", "created_by"}
    ),
    "configuracion_sistema": frozenset(
        {"id", "clave", "valor", "is_active", "created_at", "updated_at", "created_by"}
    ),
    "solicitudes_restock": frozenset(
        {
            "id",
            "producto_id",
            "cantidad_sugerida",
            "notas",
            "estado",
            "is_active",
            "created_at",
            "updated_at",
            "created_by",
        }
    ),
    "preferencias_usuario": frozenset(
        {
            "id",
            "user_id",
            "vista_inventario",
            "columnas_tabla",
            "campos_mosaico",
            "filtros",
            "sidebar_collapsed",
            "is_active",
            "created_at",
            "updated_at",
        }
    ),
    "movimientos_inventario": frozenset(
        {
            "id",
            "tipo",
            "fecha",
            "producto_id",
            "cantidad",
            "proveedor_id",
            "codigo_proveedor",
            "nombre_proveedor",
            "correlativo_salida",
            "cliente_nombre",
            "cliente_documento",
            "motivo",
            "ref_unitario",
            "tasa_bcv",
            "monto_bs",
            "monto_ref",
            "descripcion",
            "caracteristicas",
            "payload",
            "is_active",
            "created_at",
            "updated_at",
            "created_by",
        }
    ),
}
