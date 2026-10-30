-- Reactiva fotos que ya están en Cloudinary si el artículo sigue activo.
-- No toca fotos de artículos anulados.
UPDATE producto_imagenes AS i
SET
  is_active = true,
  updated_at = timezone('utc', now())
FROM productos AS p
WHERE p.id = i.producto_id
  AND p.is_active IS DISTINCT FROM false
  AND coalesce(i.cloudinary_url, i.cloudinary_public_id, '') <> ''
  AND i.is_active IS DISTINCT FROM true;
