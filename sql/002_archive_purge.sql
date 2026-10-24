-- AMIRCARS — Purga de histórico ya archivado en disco local
-- Permite DELETE de movimientos solo cuando el RPC de archivo lo autoriza.

CREATE OR REPLACE FUNCTION public.fn_movimientos_inventario_inmutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('amircars.allow_archive_purge', true) = 'on' AND TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'AMIRCARS: movimientos_inventario es inmutable. UPDATE y DELETE están prohibidos.'
    USING ERRCODE = 'P0001';
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_amircars_purge_archivados(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item jsonb;
  tbl text;
  rid uuid;
  affected integer := 0;
  deleted_moves integer := 0;
  deleted_other integer := 0;
  skipped integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMIRCARS: purga no autorizada' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('amircars.allow_archive_purge', 'on', true);

  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
  LOOP
    tbl := item->>'table';
    BEGIN
      rid := (item->>'id')::uuid;
    EXCEPTION
      WHEN others THEN
        skipped := skipped + 1;
        CONTINUE;
    END;

    IF tbl = 'movimientos_inventario' THEN
      DELETE FROM public.movimientos_inventario WHERE id = rid;
      GET DIAGNOSTICS affected = ROW_COUNT;
      deleted_moves := deleted_moves + affected;
    ELSIF tbl IN ('historico_ref', 'solicitudes_restock', 'producto_imagenes', 'tasas_bcv') THEN
      EXECUTE format('DELETE FROM public.%I WHERE id = $1', tbl) USING rid;
      GET DIAGNOSTICS affected = ROW_COUNT;
      deleted_other := deleted_other + affected;
    ELSE
      skipped := skipped + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'movimientos', deleted_moves,
    'otros', deleted_other,
    'omitidos', skipped
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_amircars_purge_archivados(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_amircars_purge_archivados(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_amircars_purge_archivados(jsonb) TO service_role;
