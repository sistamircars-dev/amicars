"""Gunicorn production config for Koyeb. Never serves source files as static assets."""

import os

bind = f"0.0.0.0:{os.environ.get('PORT', '8000')}"
workers = int(os.environ.get("WEB_CONCURRENCY", "2"))
threads = int(os.environ.get("GUNICORN_THREADS", "4"))
worker_class = "gthread"
timeout = 120
graceful_timeout = 30
keepalive = 5
max_requests = 1000
max_requests_jitter = 50
accesslog = "-"
errorlog = "-"
loglevel = os.environ.get("LOG_LEVEL", "info")
preload_app = True
reload = False
forwarded_allow_ips = "*"
limit_request_line = 4094
limit_request_fields = 100
limit_request_field_size = 8190
capture_output = True
wsgi_app = "wsgi:app"
