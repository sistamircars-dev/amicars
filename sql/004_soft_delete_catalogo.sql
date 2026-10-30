-- Anular un proveedor/artículo/categoría no borra el registro:
-- Postgres convierte el DELETE en is_active = false y evita el 23503.
CREATE OR REPLACE FUNCTION public.fn_soft_delete_instead()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format(
    'UPDATE %I.%I SET is_active = false, updated_at = timezone(''utc'', now()) WHERE id = $1',
    TG_TABLE_SCHEMA,
    TG_TABLE_NAME
  )
  USING OLD.id;
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'proveedores',
    'productos',
    'categorias',
    'subcategorias'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_soft_delete_instead ON public.%I;', t);
    EXECUTE format(
      'CREATE TRIGGER trg_soft_delete_instead
       BEFORE DELETE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.fn_soft_delete_instead();',
      t
    );
  END LOOP;
END;
$$;
