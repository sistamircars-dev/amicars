-- El stock se calcula en el cliente (offline-first). El trigger remoto
-- lo volvía a aplicar al insertar movimientos y desfasaba la nube.
DROP TRIGGER IF EXISTS trg_movimientos_aplicar_stock ON public.movimientos_inventario;
