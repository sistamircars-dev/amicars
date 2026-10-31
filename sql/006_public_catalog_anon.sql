-- JD Parfum — public catalog read for anon (sanitized columns only via API;
-- RLS still allows SELECT on active products/images for the publishable key).
-- Run in the JD Parfum Supabase project (never on AmirCars).

BEGIN;

GRANT USAGE ON SCHEMA public TO anon;

GRANT SELECT ON TABLE public.productos TO anon;
GRANT SELECT ON TABLE public.producto_imagenes TO anon;

DROP POLICY IF EXISTS jdparfum_anon_catalog_productos ON public.productos;
CREATE POLICY jdparfum_anon_catalog_productos ON public.productos
  FOR SELECT TO anon
  USING (is_active = true);

DROP POLICY IF EXISTS jdparfum_anon_catalog_imagenes ON public.producto_imagenes;
CREATE POLICY jdparfum_anon_catalog_imagenes ON public.producto_imagenes
  FOR SELECT TO anon
  USING (is_active = true);

-- Keep write paths locked for anon
DROP POLICY IF EXISTS jdparfum_anon_deny_write_productos ON public.productos;
CREATE POLICY jdparfum_anon_deny_write_productos ON public.productos
  FOR INSERT TO anon
  WITH CHECK (false);

DROP POLICY IF EXISTS jdparfum_anon_deny_update_productos ON public.productos;
CREATE POLICY jdparfum_anon_deny_update_productos ON public.productos
  FOR UPDATE TO anon
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS jdparfum_anon_deny_delete_productos ON public.productos;
CREATE POLICY jdparfum_anon_deny_delete_productos ON public.productos
  FOR DELETE TO anon
  USING (false);

COMMIT;
