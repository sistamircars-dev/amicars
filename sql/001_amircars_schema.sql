-- =============================================================================
-- AMIRCARS — Esquema PostgreSQL, RLS estricto y bitácora inmutable
-- Pegar COMPLETO en: Supabase Dashboard → SQL Editor → Run
-- Proyecto: https://lqhtbbkmkjoqyfzrofhh.supabase.co
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------------------------------
-- Funciones de utilidad
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_movimientos_inventario_inmutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'AMIRCARS: movimientos_inventario es inmutable. UPDATE y DELETE están prohibidos.'
    USING ERRCODE = 'P0001';
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_aplicar_stock_movimiento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  factor numeric(14,3);
BEGIN
  IF NEW.tipo = 'entrada' THEN
    factor := NEW.cantidad;
  ELSIF NEW.tipo IN ('salida', 'falla') THEN
    factor := -NEW.cantidad;
  ELSE
    RAISE EXCEPTION 'Tipo de movimiento inválido: %', NEW.tipo;
  END IF;

  UPDATE public.productos
     SET stock = stock + factor,
         updated_at = timezone('utc', now())
   WHERE id = NEW.producto_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto % no existe para el movimiento %', NEW.producto_id, NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- Tablas
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.categorias (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        text NOT NULL,
  descripcion   text,
  imagen_url    text,
  orden         integer NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at    timestamptz NOT NULL DEFAULT timezone('utc', now()),
  created_by    uuid REFERENCES auth.users (id)
);

CREATE TABLE IF NOT EXISTS public.subcategorias (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria_id  uuid NOT NULL REFERENCES public.categorias (id) ON DELETE RESTRICT,
  nombre        text NOT NULL,
  descripcion   text,
  orden         integer NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at    timestamptz NOT NULL DEFAULT timezone('utc', now()),
  created_by    uuid REFERENCES auth.users (id)
);

CREATE TABLE IF NOT EXISTS public.campos_personalizados (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subcategoria_id  uuid NOT NULL REFERENCES public.subcategorias (id) ON DELETE RESTRICT,
  nombre           text NOT NULL,
  tipo             text NOT NULL DEFAULT 'text'
                   CHECK (tipo IN ('text', 'number', 'select', 'boolean')),
  opciones         jsonb NOT NULL DEFAULT '[]'::jsonb,
  orden            integer NOT NULL DEFAULT 0,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at       timestamptz NOT NULL DEFAULT timezone('utc', now()),
  created_by       uuid REFERENCES auth.users (id)
);

CREATE TABLE IF NOT EXISTS public.proveedores (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_proveedor   text NOT NULL UNIQUE,
  razon_social       text NOT NULL,
  contacto           text,
  telefono           text,
  email              text,
  notas              text,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at         timestamptz NOT NULL DEFAULT timezone('utc', now()),
  created_by         uuid REFERENCES auth.users (id)
);

CREATE TABLE IF NOT EXISTS public.productos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria_id        uuid REFERENCES public.categorias (id) ON DELETE RESTRICT,
  subcategoria_id     uuid REFERENCES public.subcategorias (id) ON DELETE RESTRICT,
  codigo              text,
  descripcion         text NOT NULL,
  atributos           jsonb NOT NULL DEFAULT '{}'::jsonb,
  proveedor_id        uuid REFERENCES public.proveedores (id) ON DELETE SET NULL,
  stock               numeric(14,3) NOT NULL DEFAULT 0,
  stock_minimo        numeric(14,3),
  ref_entrada         numeric(14,4) NOT NULL DEFAULT 0,
  ref_venta           numeric(14,4) NOT NULL DEFAULT 0,
  solicitar_restock   boolean NOT NULL DEFAULT false,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
  created_by          uuid REFERENCES auth.users (id)
);

CREATE TABLE IF NOT EXISTS public.producto_imagenes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id           uuid NOT NULL REFERENCES public.productos (id) ON DELETE RESTRICT,
  cloudinary_url        text,
  cloudinary_public_id  text,
  alt_text              text,
  orden                 integer NOT NULL DEFAULT 0,
  is_cover              boolean NOT NULL DEFAULT false,
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at            timestamptz NOT NULL DEFAULT timezone('utc', now()),
  created_by            uuid REFERENCES auth.users (id)
);

CREATE TABLE IF NOT EXISTS public.producto_proveedores (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id           uuid NOT NULL REFERENCES public.productos (id) ON DELETE RESTRICT,
  proveedor_id          uuid NOT NULL REFERENCES public.proveedores (id) ON DELETE RESTRICT,
  codigo_sku            text,
  stock_minimo          numeric(14,3),
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at            timestamptz NOT NULL DEFAULT timezone('utc', now()),
  created_by            uuid REFERENCES auth.users (id),
  UNIQUE (producto_id, proveedor_id)
);

CREATE TABLE IF NOT EXISTS public.historico_ref (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id     uuid NOT NULL REFERENCES public.productos (id) ON DELETE RESTRICT,
  ref_entrada     numeric(14,4) NOT NULL,
  ref_venta       numeric(14,4) NOT NULL,
  vigente_desde   timestamptz NOT NULL DEFAULT timezone('utc', now()),
  vigente_hasta   timestamptz,
  movimiento_id   uuid,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at      timestamptz NOT NULL DEFAULT timezone('utc', now()),
  created_by      uuid REFERENCES auth.users (id)
);

CREATE TABLE IF NOT EXISTS public.tasas_bcv (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha         date NOT NULL UNIQUE,
  usd_ves       numeric(18,6) NOT NULL CHECK (usd_ves > 0),
  fuente        text NOT NULL DEFAULT 'bcv',
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at    timestamptz NOT NULL DEFAULT timezone('utc', now()),
  created_by    uuid REFERENCES auth.users (id)
);

CREATE TABLE IF NOT EXISTS public.configuracion_sistema (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave         text NOT NULL UNIQUE,
  valor         jsonb NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at    timestamptz NOT NULL DEFAULT timezone('utc', now()),
  created_by    uuid REFERENCES auth.users (id)
);

CREATE TABLE IF NOT EXISTS public.solicitudes_restock (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id         uuid NOT NULL REFERENCES public.productos (id) ON DELETE RESTRICT,
  cantidad_sugerida   numeric(14,3),
  notas               text,
  estado              text NOT NULL DEFAULT 'pendiente'
                      CHECK (estado IN ('pendiente', 'atendida', 'cancelada')),
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
  created_by          uuid REFERENCES auth.users (id)
);

CREATE TABLE IF NOT EXISTS public.preferencias_usuario (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,
  vista_inventario   text NOT NULL DEFAULT 'mosaico'
                     CHECK (vista_inventario IN ('tabla', 'mosaico')),
  columnas_tabla     jsonb NOT NULL DEFAULT '[]'::jsonb,
  campos_mosaico     jsonb NOT NULL DEFAULT '[]'::jsonb,
  filtros            jsonb NOT NULL DEFAULT '{}'::jsonb,
  sidebar_collapsed  boolean NOT NULL DEFAULT false,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at         timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.movimientos_inventario (
  id                   uuid PRIMARY KEY,
  tipo                 text NOT NULL CHECK (tipo IN ('entrada', 'salida', 'falla')),
  fecha                date NOT NULL,
  producto_id          uuid NOT NULL REFERENCES public.productos (id) ON DELETE RESTRICT,
  cantidad             numeric(14,3) NOT NULL CHECK (cantidad > 0),
  proveedor_id         uuid REFERENCES public.proveedores (id) ON DELETE RESTRICT,
  codigo_proveedor     text,
  nombre_proveedor     text,
  correlativo_salida   text,
  cliente_nombre       text,
  cliente_documento    text,
  motivo               text,
  ref_unitario         numeric(14,4),
  tasa_bcv             numeric(18,6),
  monto_bs             numeric(18,4),
  monto_ref            numeric(14,4),
  descripcion          text,
  caracteristicas      jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload              jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at           timestamptz NOT NULL DEFAULT timezone('utc', now()),
  created_by           uuid REFERENCES auth.users (id)
);

INSERT INTO public.configuracion_sistema (clave, valor)
VALUES
  ('stock_minimo_global', '{"cantidad": 1}'::jsonb),
  ('tasa_bcv_fuente', '{"url": "https://ve.dolarapi.com/v1/dolares/oficial"}'::jsonb)
ON CONFLICT (clave) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Índices
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_subcategorias_categoria ON public.subcategorias (categoria_id);
CREATE INDEX IF NOT EXISTS idx_campos_subcategoria ON public.campos_personalizados (subcategoria_id);
CREATE INDEX IF NOT EXISTS idx_productos_categoria ON public.productos (categoria_id);
CREATE INDEX IF NOT EXISTS idx_productos_subcategoria ON public.productos (subcategoria_id);
CREATE INDEX IF NOT EXISTS idx_productos_proveedor ON public.productos (proveedor_id);
CREATE INDEX IF NOT EXISTS idx_productos_updated_at ON public.productos (updated_at);
CREATE INDEX IF NOT EXISTS idx_productos_stock ON public.productos (stock);
CREATE INDEX IF NOT EXISTS idx_productos_descripcion ON public.productos USING gin (to_tsvector('spanish', coalesce(descripcion, '')));
CREATE INDEX IF NOT EXISTS idx_producto_imagenes_producto ON public.producto_imagenes (producto_id);
CREATE INDEX IF NOT EXISTS idx_historico_ref_producto ON public.historico_ref (producto_id, vigente_desde DESC);
CREATE INDEX IF NOT EXISTS idx_tasas_bcv_fecha ON public.tasas_bcv (fecha DESC);
CREATE INDEX IF NOT EXISTS idx_movimientos_fecha ON public.movimientos_inventario (fecha DESC);
CREATE INDEX IF NOT EXISTS idx_movimientos_producto ON public.movimientos_inventario (producto_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_tipo ON public.movimientos_inventario (tipo);
CREATE INDEX IF NOT EXISTS idx_movimientos_created_at ON public.movimientos_inventario (created_at);
CREATE INDEX IF NOT EXISTS idx_solicitudes_producto ON public.solicitudes_restock (producto_id);

-- -----------------------------------------------------------------------------
-- Triggers updated_at (todas las tablas mutables)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'categorias',
    'subcategorias',
    'campos_personalizados',
    'proveedores',
    'productos',
    'producto_imagenes',
    'producto_proveedores',
    'historico_ref',
    'tasas_bcv',
    'configuracion_sistema',
    'solicitudes_restock',
    'preferencias_usuario'
  ]
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_set_updated_at ON public.%I;
       CREATE TRIGGER trg_set_updated_at
       BEFORE UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();',
      t, t
    );
  END LOOP;
END;
$$;

DROP TRIGGER IF EXISTS trg_movimientos_inventario_inmutable ON public.movimientos_inventario;
CREATE TRIGGER trg_movimientos_inventario_inmutable
BEFORE UPDATE OR DELETE ON public.movimientos_inventario
FOR EACH ROW EXECUTE FUNCTION public.fn_movimientos_inventario_inmutable();

DROP TRIGGER IF EXISTS trg_movimientos_aplicar_stock ON public.movimientos_inventario;
CREATE TRIGGER trg_movimientos_aplicar_stock
AFTER INSERT ON public.movimientos_inventario
FOR EACH ROW EXECUTE FUNCTION public.fn_aplicar_stock_movimiento();

-- -----------------------------------------------------------------------------
-- Permisos: bloquear anon, habilitar authenticated
-- -----------------------------------------------------------------------------
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'categorias',
    'subcategorias',
    'campos_personalizados',
    'proveedores',
    'productos',
    'producto_imagenes',
    'producto_proveedores',
    'historico_ref',
    'tasas_bcv',
    'configuracion_sistema',
    'solicitudes_restock',
    'preferencias_usuario',
    'movimientos_inventario'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC;', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon;', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated;', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role;', t);
  END LOOP;
END;
$$;

REVOKE UPDATE, DELETE ON TABLE public.movimientos_inventario FROM authenticated;
GRANT SELECT, INSERT ON TABLE public.movimientos_inventario TO authenticated;

-- -----------------------------------------------------------------------------
-- RLS: sin políticas para anon = denegado. Solo authenticated.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'categorias',
    'subcategorias',
    'campos_personalizados',
    'proveedores',
    'productos',
    'producto_imagenes',
    'producto_proveedores',
    'historico_ref',
    'tasas_bcv',
    'configuracion_sistema',
    'solicitudes_restock',
    'preferencias_usuario',
    'movimientos_inventario'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', t);

    EXECUTE format('DROP POLICY IF EXISTS amircars_anon_deny ON public.%I;', t);
    EXECUTE format(
      'CREATE POLICY amircars_anon_deny ON public.%I
         FOR ALL TO anon
         USING (false)
         WITH CHECK (false);',
      t
    );

    EXECUTE format('DROP POLICY IF EXISTS amircars_auth_select ON public.%I;', t);
    EXECUTE format(
      'CREATE POLICY amircars_auth_select ON public.%I
         FOR SELECT TO authenticated
         USING (auth.role() = ''authenticated'');',
      t
    );

    EXECUTE format('DROP POLICY IF EXISTS amircars_auth_insert ON public.%I;', t);
    EXECUTE format(
      'CREATE POLICY amircars_auth_insert ON public.%I
         FOR INSERT TO authenticated
         WITH CHECK (auth.role() = ''authenticated'');',
      t
    );

    IF t <> 'movimientos_inventario' THEN
      EXECUTE format('DROP POLICY IF EXISTS amircars_auth_update ON public.%I;', t);
      EXECUTE format(
        'CREATE POLICY amircars_auth_update ON public.%I
           FOR UPDATE TO authenticated
           USING (auth.role() = ''authenticated'')
           WITH CHECK (auth.role() = ''authenticated'');',
        t
      );

      EXECUTE format('DROP POLICY IF EXISTS amircars_auth_delete ON public.%I;', t);
      EXECUTE format(
        'CREATE POLICY amircars_auth_delete ON public.%I
           FOR DELETE TO authenticated
           USING (auth.role() = ''authenticated'');',
        t
      );
    END IF;
  END LOOP;
END;
$$;

DROP POLICY IF EXISTS amircars_auth_update ON public.movimientos_inventario;
DROP POLICY IF EXISTS amircars_auth_delete ON public.movimientos_inventario;

DROP POLICY IF EXISTS amircars_auth_select ON public.preferencias_usuario;
DROP POLICY IF EXISTS amircars_auth_insert ON public.preferencias_usuario;
DROP POLICY IF EXISTS amircars_auth_update ON public.preferencias_usuario;
DROP POLICY IF EXISTS amircars_auth_delete ON public.preferencias_usuario;

CREATE POLICY amircars_auth_select ON public.preferencias_usuario
  FOR SELECT TO authenticated
  USING (auth.role() = 'authenticated' AND user_id = auth.uid());

CREATE POLICY amircars_auth_insert ON public.preferencias_usuario
  FOR INSERT TO authenticated
  WITH CHECK (auth.role() = 'authenticated' AND user_id = auth.uid());

CREATE POLICY amircars_auth_update ON public.preferencias_usuario
  FOR UPDATE TO authenticated
  USING (auth.role() = 'authenticated' AND user_id = auth.uid())
  WITH CHECK (auth.role() = 'authenticated' AND user_id = auth.uid());

CREATE POLICY amircars_auth_delete ON public.preferencias_usuario
  FOR DELETE TO authenticated
  USING (auth.role() = 'authenticated' AND user_id = auth.uid());

COMMIT;
