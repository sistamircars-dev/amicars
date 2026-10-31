# JD Parfum

Replica of the AmirCars inventory stack for **JD Parfum**, with a **public pre-login catalog** and shopping cart.

## Product shape

- **`/`** — public storefront (image, description, available qty, sale price REF) + localStorage cart + **Login**
- **`/login`** — Supabase Auth
- **`/panel`** — authenticated side-nav ops (inventory, entradas/salidas, sync, media)

## Stack

Flask + gunicorn · Supabase Auth/DB · Cloudinary · Dexie (offline panel) · Render

## Credentials (isolated)

Copy `.env.example` → `.env`. **Do not** reuse AmirCars live secrets.

Required: `FLASK_SECRET_KEY`, `SUPABASE_URL`, `SUPABASE_KEY`, Cloudinary (`CLOUDINARY_URL` or name/key/secret).

Optional: `SUPABASE_SERVICE_ROLE_KEY` for server-side public catalog reads. Prefer running `sql/006_public_catalog_anon.sql` on the **JD** Supabase project so the publishable key can SELECT active products/images.

## Brand assets

Shipped under `app/static/img/jdparfum/` (logo + luxury background) and source masters in `app/static/brand-source/`.

## Local run

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill JD-only values
gunicorn --config gunicorn.conf.py wsgi:app
```

## Public API

- `GET /api/catalog/products` — sanitized list (no `ref_entrada`, no suppliers)
- `GET /api/catalog/products/<id>` — sanitized detail

Sync and media upload remain login-protected.
